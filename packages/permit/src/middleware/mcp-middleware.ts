import type { Request, Response, NextFunction } from 'express';
import { ActionRequest, PolicyDecision } from '../engine/types.js';

export interface ToolCallInterceptor {
  /**
   * Evaluate whether a tool call should be allowed.
   * Works with any transport — call this before executing the tool.
   */
  interceptToolCall(params: {
    agentId: string;
    verificationTier?: string;
    toolName: string;
    toolArguments: Record<string, unknown>;
    environment?: 'production' | 'staging' | 'development';
  }): Promise<{ allowed: boolean; decision: any; credential?: any }>;
}

export function createToolCallInterceptor(options: {
  evaluate: (request: ActionRequest) => Promise<PolicyDecision>;
}): ToolCallInterceptor {
  return {
    async interceptToolCall(params) {
      const request: ActionRequest = {
        agent: {
          id: params.agentId,
          verificationTier: (params.verificationTier || 'unverified') as ActionRequest['agent']['verificationTier'],
        },
        action: {
          type: 'tools/call',
          resource: params.toolName,
          parameters: params.toolArguments,
        },
        context: {
          timestamp: new Date().toISOString(),
          environment: params.environment || 'production',
        },
      };

      const decision = await options.evaluate(request);
      return {
        allowed: decision.decision === 'allow',
        decision,
        credential: decision.scopedCredential,
      };
    },
  };
}

export interface McpMiddlewareOptions {
  evaluate: (request: ActionRequest) => Promise<{ decision: string; reasons: string[]; auditId: string }>;
  verifyToken?: (token: string) => Promise<{ agentId: string; verificationTier?: string } | null>;
  extractAgentId?: (req: Request) => string | null;
  extractAction?: (req: Request) => { type: string; resource: string; parameters: Record<string, unknown> } | null;
  defaultEnvironment?: 'production' | 'staging' | 'development';
}

let tokenVerificationWarned = false;

export function createMcpMiddleware(options: McpMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let agentId: string | null = null;
    let verificationTier: string = 'unverified';

    if (options.extractAgentId) {
      agentId = options.extractAgentId(req);
    } else {
      const rawToken = extractAgentIdFromHeader(req);

      if (rawToken && options.verifyToken) {
        const verified = await options.verifyToken(rawToken);
        if (!verified) {
          res.status(401).json({
            error: 'Invalid token',
            message: 'Bearer token verification failed',
          });
          return;
        }
        agentId = verified.agentId;
        if (verified.verificationTier) {
          verificationTier = verified.verificationTier;
        }
      } else if (rawToken) {
        if (!tokenVerificationWarned) {
          console.warn('[moltpermit] WARNING: Token verification is disabled. Raw Bearer token used as agent ID.');
          tokenVerificationWarned = true;
        }
        agentId = rawToken;
      }
    }

    if (!agentId) {
      res.status(401).json({
        error: 'Missing agent identity',
        message: 'Authorization header with Bearer token required',
      });
      return;
    }

    const action = options.extractAction
      ? options.extractAction(req)
      : extractActionFromRequest(req);

    if (!action) {
      next();
      return;
    }

    const actionRequest: ActionRequest = {
      agent: {
        id: agentId,
        verificationTier: verificationTier as ActionRequest['agent']['verificationTier'],
      },
      action: {
        type: action.type,
        resource: action.resource,
        parameters: action.parameters,
      },
      context: {
        timestamp: new Date().toISOString(),
        environment: options.defaultEnvironment || 'production',
      },
    };

    try {
      const decision = await options.evaluate(actionRequest);

      if (decision.decision === 'deny') {
        res.status(403).json({
          error: 'Action denied by policy',
          decision: decision.decision,
          reasons: decision.reasons,
          auditId: decision.auditId,
        });
        return;
      }

      // Attach decision to request for downstream handlers
      (req as unknown as Record<string, unknown>).policyDecision = decision;
      next();
    } catch (err) {
      res.status(500).json({
        error: 'Policy evaluation failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };
}

function extractAgentIdFromHeader(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

function extractActionFromRequest(
  req: Request,
): { type: string; resource: string; parameters: Record<string, unknown> } | null {
  const body = req.body as Record<string, unknown> | undefined;

  // MCP tool call format
  if (body && body.method === 'tools/call') {
    const params = body.params as Record<string, unknown> | undefined;
    return {
      type: `tools/call`,
      resource: (params?.name as string) || 'unknown',
      parameters: (params?.arguments as Record<string, unknown>) || {},
    };
  }

  // Generic request mapping
  if (body && body.action) {
    const action = body.action as Record<string, unknown>;
    return {
      type: (action.type as string) || req.method.toLowerCase(),
      resource: (action.resource as string) || req.path,
      parameters: (action.parameters as Record<string, unknown>) || {},
    };
  }

  return null;
}
