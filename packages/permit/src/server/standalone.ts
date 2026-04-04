import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MoltPermit, MoltPermitConfig } from '../index.js';
import { ActionRequest } from '../engine/types.js';

export interface ServerConfig extends MoltPermitConfig {
  port?: number;
  host?: string;
  apiKey?: string;
  rateLimit?: { maxRequests?: number; windowMs?: number };
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

class RateLimiter {
  private windows: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 60000,
  ) {}

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now > entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }

    if (entry.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: this.maxRequests - entry.count, resetAt: entry.resetAt };
  }
}

function createApiKeyMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health check
    if (req.path === '/health') {
      next();
      return;
    }

    const headerKey = req.headers['x-api-key'] as string | undefined;
    const authHeader = req.headers.authorization;
    let bearerKey: string | undefined;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        bearerKey = parts[1];
      }
    }

    if ((headerKey && safeCompare(headerKey, apiKey)) || (bearerKey && safeCompare(bearerKey, apiKey))) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required via X-API-Key header or Authorization: Bearer <key>',
    });
  };
}

export function createServer(permit: MoltPermit, config?: { port?: number; host?: string; apiKey?: string; rateLimit?: { maxRequests?: number; windowMs?: number } }) {
  const app = express();
  app.use(express.json());

  // Apply API key auth if configured
  if (config?.apiKey) {
    app.use(createApiKeyMiddleware(config.apiKey));
  }

  // Apply rate limiting
  const rateLimiter = new RateLimiter(
    config?.rateLimit?.maxRequests ?? 100,
    config?.rateLimit?.windowMs ?? 60000,
  );
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/health') {
      next();
      return;
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const result = rateLimiter.check(clientIp);

    res.setHeader('X-RateLimit-Limit', config?.rateLimit?.maxRequests ?? 100);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retryAfter,
      });
      return;
    }

    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Evaluate a policy
  app.post('/evaluate', async (req, res) => {
    try {
      const actionRequest = req.body as ActionRequest;
      if (!actionRequest.agent?.id || !actionRequest.action?.type) {
        res.status(400).json({ error: 'Invalid request: agent.id and action.type are required' });
        return;
      }

      const decision = await permit.evaluate(actionRequest);
      res.json(decision);
    } catch (err) {
      res.status(500).json({
        error: 'Evaluation failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Onboard an agent via MoltCaptcha
  app.post('/onboard', async (req, res) => {
    try {
      const { difficulty, agentInfo, challengeSolution } = req.body as {
        difficulty?: string;
        agentInfo: { name: string; description?: string };
        challengeSolution?: { challengeId: string; solution: string };
      };

      if (challengeSolution) {
        const result = await permit.registerAgent(
          challengeSolution.challengeId,
          challengeSolution.solution,
          agentInfo,
        );
        res.json(result);
      } else {
        const challenge = await permit.getChallenge(difficulty);
        res.json(challenge);
      }
    } catch (err) {
      res.status(500).json({
        error: 'Onboarding failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Query audit logs
  app.get('/logs', (req, res) => {
    try {
      const query = {
        agentId: req.query.agent as string | undefined,
        decision: req.query.decision as 'allow' | 'deny' | undefined,
        since: req.query.since as string | undefined,
        until: req.query.until as string | undefined,
        actionType: req.query.actionType as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const logs = permit.queryLogs(query);
      res.json(logs);
    } catch (err) {
      res.status(500).json({
        error: 'Log query failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Check budget for an agent
  app.get('/budget/:agentId', (req, res) => {
    try {
      const usage = permit.getBudgetUsage(req.params.agentId);
      res.json(usage);
    } catch (err) {
      res.status(500).json({
        error: 'Budget query failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Reload policies
  app.post('/reload', (_req, res) => {
    try {
      permit.reloadPolicies();
      res.json({ success: true, policyCount: permit.getPolicyCount() });
    } catch (err) {
      res.status(500).json({
        error: 'Reload failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Rollback a reversible action
  app.post('/rollback/:auditId', async (req, res) => {
    try {
      const result = await permit.rollback(req.params.auditId);
      res.json({ ...result, auditId: req.params.auditId, status: 'rolled_back' });
    } catch (err) {
      res.status(500).json({
        error: 'Rollback failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  const port = config?.port || 3001;
  const host = config?.host || '0.0.0.0';

  return {
    app,
    start: () => {
      return app.listen(port, host, () => {
        console.log(`MoltPermit server listening on ${host}:${port}`);
      });
    },
  };
}
