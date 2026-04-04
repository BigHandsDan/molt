import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';
import { PolicyContext } from '../src/policy/types.js';
import { TrustTier } from '../src/contracts/schema.js';

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    agentTrustTier: TrustTier.INTERNAL_TRUSTED,
    capability: 'test',
    requiredTools: [],
    agentAllowedTools: [],
    approvalRequired: false,
    agentCapabilities: ['test'],
    ...overrides,
  };
}

describe('PolicyEngine — Advanced Conditions', () => {
  it('should deny when required tools are not in toolsAllowed', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'only-search',
        effect: 'deny',
        priority: 100,
        conditions: {
          toolsAllowed: ['web_search'],
        },
        description: 'Only web_search allowed',
      },
    ]);
    const decision = engine.evaluate(makeContext({ requiredTools: ['code_exec'] }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleId).toBe('only-search');
  });

  it('should not deny when required tools are within toolsAllowed', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'only-search',
        effect: 'deny',
        priority: 200,
        conditions: {
          toolsAllowed: ['web_search', 'read_only'],
        },
        description: 'Only search tools',
      },
      {
        ruleId: 'fallback-allow',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.INTERNAL_TRUSTED],
        },
        description: 'Allow trusted',
      },
    ]);
    const decision = engine.evaluate(makeContext({ requiredTools: ['web_search'] }));
    expect(decision.allowed).toBe(true);
  });

  it('should deny when specific tools are blocked', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'block-exec',
        effect: 'deny',
        priority: 200,
        conditions: {
          toolsBlocked: ['code_exec', 'file_write'],
        },
        description: 'Block dangerous tools',
      },
    ]);
    const decision = engine.evaluate(makeContext({ requiredTools: ['code_exec'] }));
    expect(decision.allowed).toBe(false);
  });

  it('should deny when token budget is exceeded', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'budget-limit',
        effect: 'deny',
        priority: 200,
        conditions: {
          maxTokenBudget: 1000,
        },
        description: 'Token budget exceeded',
      },
    ]);
    const decision = engine.evaluate(makeContext({ tokenBudget: 2000 }));
    expect(decision.allowed).toBe(false);
  });

  it('should allow when token budget is within limit', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'budget-limit',
        effect: 'deny',
        priority: 200,
        conditions: {
          maxTokenBudget: 5000,
        },
        description: 'Token budget exceeded',
      },
      {
        ruleId: 'allow-all',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.INTERNAL_TRUSTED],
        },
        description: 'Allow trusted',
      },
    ]);
    const decision = engine.evaluate(makeContext({ tokenBudget: 3000 }));
    expect(decision.allowed).toBe(true);
  });

  it('should skip budget check when context has no tokenBudget', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'budget-limit',
        effect: 'deny',
        priority: 200,
        conditions: {
          trustTierIn: [TrustTier.INTERNAL_TRUSTED],
          maxTokenBudget: 100,
        },
        description: 'Budget limit',
      },
      {
        ruleId: 'allow-trusted',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.INTERNAL_TRUSTED],
        },
        description: 'Allow trusted',
      },
    ]);
    // No tokenBudget in context → deny rule's budget check can't trigger
    const decision = engine.evaluate(makeContext());
    expect(decision.allowed).toBe(true);
  });

  it('should handle time window deny rule (outside hours)', () => {
    // Use a time window that's guaranteed to NOT include current time
    const now = new Date();
    const impossibleStart = `${(now.getUTCHours() + 2) % 24}:00`;
    const impossibleEnd = `${(now.getUTCHours() + 3) % 24}:00`;

    const engine = new PolicyEngine([
      {
        ruleId: 'time-restricted',
        effect: 'deny',
        priority: 200,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
          timeWindowStart: impossibleStart,
          timeWindowEnd: impossibleEnd,
        },
        description: 'Only during business hours',
      },
      {
        ruleId: 'allow-external',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
        },
        description: 'Allow external',
      },
    ]);
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.EXTERNAL_PARTNER }));
    // We're outside the tiny window, so deny rule fires
    expect(decision.allowed).toBe(false);
  });

  it('should allow within time window', () => {
    // Use a window that includes current time
    const now = new Date();
    const h = now.getUTCHours();
    const windowStart = `${h}:00`;
    const windowEnd = `${(h + 2) % 24}:00`;

    const engine = new PolicyEngine([
      {
        ruleId: 'time-restricted',
        effect: 'deny',
        priority: 200,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
          timeWindowStart: windowStart,
          timeWindowEnd: windowEnd,
        },
        description: 'Only during window',
      },
      {
        ruleId: 'allow-external',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
        },
        description: 'Allow external',
      },
    ]);
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.EXTERNAL_PARTNER }));
    // We're inside the window, so deny rule doesn't fire, allow rule fires
    expect(decision.allowed).toBe(true);
  });

  it('should handle combined tool restrictions and trust tier', () => {
    const engine = new PolicyEngine([
      {
        ruleId: 'external-block-exec',
        effect: 'deny',
        priority: 200,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
          toolsBlocked: ['code_exec'],
        },
        description: 'External cannot use code_exec',
      },
      {
        ruleId: 'allow-external',
        effect: 'allow',
        priority: 100,
        conditions: {
          trustTierIn: [TrustTier.EXTERNAL_PARTNER],
        },
        description: 'Allow external',
      },
    ]);
    // External with code_exec → denied
    expect(
      engine.evaluate(
        makeContext({ agentTrustTier: TrustTier.EXTERNAL_PARTNER, requiredTools: ['code_exec'] })
      ).allowed
    ).toBe(false);
    // External without code_exec → allowed
    expect(
      engine.evaluate(
        makeContext({ agentTrustTier: TrustTier.EXTERNAL_PARTNER, requiredTools: ['web_search'] })
      ).allowed
    ).toBe(true);
  });
});
