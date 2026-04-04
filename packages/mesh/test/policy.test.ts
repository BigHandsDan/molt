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

describe('PolicyEngine', () => {
  it('should allow internal trusted agents by default', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.INTERNAL_TRUSTED }));
    expect(decision.allowed).toBe(true);
  });

  it('should allow internal restricted agents for non-approval contracts', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(
      makeContext({
        agentTrustTier: TrustTier.INTERNAL_RESTRICTED,
        approvalRequired: false,
      })
    );
    expect(decision.allowed).toBe(true);
  });

  it('should deny internal restricted agents for approval-required contracts', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(
      makeContext({
        agentTrustTier: TrustTier.INTERNAL_RESTRICTED,
        approvalRequired: true,
      })
    );
    expect(decision.allowed).toBe(false);
  });

  it('should deny public vendors by default', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR }));
    expect(decision.allowed).toBe(false);
  });

  it('should allow external partners for their capabilities', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.EXTERNAL_PARTNER }));
    expect(decision.allowed).toBe(true);
  });

  it('should include timestamps in decisions', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext());
    expect(decision.timestamp).toBeDefined();
    expect(new Date(decision.timestamp).getTime()).not.toBeNaN();
  });

  it('should include rule ID in decisions', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate(makeContext());
    expect(decision.ruleId).toBeDefined();
    expect(decision.ruleId.length).toBeGreaterThan(0);
  });

  it('should support custom rules', () => {
    const engine = new PolicyEngine([]);
    engine.addRule({
      ruleId: 'custom-allow',
      effect: 'allow',
      priority: 100,
      conditions: {
        capabilityIn: ['special'],
      },
      description: 'Allow special capability',
    });
    const decision = engine.evaluate(makeContext({ capability: 'special' }));
    expect(decision.allowed).toBe(true);
    expect(decision.ruleId).toBe('custom-allow');
  });

  it('should respect priority ordering', () => {
    const engine = new PolicyEngine([]);
    engine.addRule({
      ruleId: 'low-allow',
      effect: 'allow',
      priority: 10,
      conditions: { trustTierIn: [TrustTier.PUBLIC_VENDOR] },
      description: 'Low priority allow',
    });
    engine.addRule({
      ruleId: 'high-deny',
      effect: 'deny',
      priority: 100,
      conditions: { trustTierIn: [TrustTier.PUBLIC_VENDOR] },
      description: 'High priority deny',
    });
    const decision = engine.evaluate(makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleId).toBe('high-deny');
  });

  it('should deny by default when no rules match', () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate(makeContext());
    expect(decision.allowed).toBe(false);
    expect(decision.ruleId).toBe('default-implicit-deny');
  });

  it('should return rules list', () => {
    const engine = new PolicyEngine();
    const rules = engine.getRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});
