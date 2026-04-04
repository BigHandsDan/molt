import { describe, it, expect, vi } from 'vitest';
import { createToolCallInterceptor } from '../src/middleware/mcp-middleware';
import { PolicyDecision } from '../src/engine/types';

function makeDecision(decision: 'allow' | 'deny', extra?: Partial<PolicyDecision>): PolicyDecision {
  return {
    decision,
    reasons: [decision === 'allow' ? 'Allowed by policy' : 'Denied by policy'],
    matchedPolicies: ['policy_0'],
    auditId: 'audit-1',
    ...extra,
  };
}

describe('ToolCallInterceptor', () => {
  it('should return allowed=true when evaluate returns allow', async () => {
    const evaluate = vi.fn().mockResolvedValue(makeDecision('allow', {
      scopedCredential: { token: 'tok', expiresAt: '2099-01-01', scopes: ['tools/call'], restrictions: {} },
    }));

    const interceptor = createToolCallInterceptor({ evaluate });

    const result = await interceptor.interceptToolCall({
      agentId: 'agent-1',
      toolName: 'weather',
      toolArguments: { city: 'NYC' },
    });

    expect(result.allowed).toBe(true);
    expect(result.decision.decision).toBe('allow');
    expect(result.credential).toBeDefined();
  });

  it('should return allowed=false when evaluate returns deny', async () => {
    const evaluate = vi.fn().mockResolvedValue(makeDecision('deny'));

    const interceptor = createToolCallInterceptor({ evaluate });

    const result = await interceptor.interceptToolCall({
      agentId: 'agent-1',
      toolName: 'dangerous_tool',
      toolArguments: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.decision).toBe('deny');
    expect(result.credential).toBeUndefined();
  });

  it('should pass correct action request to evaluate', async () => {
    const evaluate = vi.fn().mockResolvedValue(makeDecision('allow'));

    const interceptor = createToolCallInterceptor({ evaluate });

    await interceptor.interceptToolCall({
      agentId: 'agent-42',
      verificationTier: 'moltcaptcha',
      toolName: 'calculator',
      toolArguments: { expr: '2+2' },
      environment: 'staging',
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          id: 'agent-42',
          verificationTier: 'moltcaptcha',
        }),
        action: expect.objectContaining({
          type: 'tools/call',
          resource: 'calculator',
          parameters: { expr: '2+2' },
        }),
        context: expect.objectContaining({
          environment: 'staging',
        }),
      }),
    );
  });

  it('should default to unverified tier and production environment', async () => {
    const evaluate = vi.fn().mockResolvedValue(makeDecision('allow'));

    const interceptor = createToolCallInterceptor({ evaluate });

    await interceptor.interceptToolCall({
      agentId: 'agent-1',
      toolName: 'tool',
      toolArguments: {},
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          verificationTier: 'unverified',
        }),
        context: expect.objectContaining({
          environment: 'production',
        }),
      }),
    );
  });
});
