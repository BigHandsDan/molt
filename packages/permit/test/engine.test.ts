import { describe, it, expect } from 'vitest';
import { CedarEngine, parseCedarPolicies } from '../src/engine/cedar-engine';
import { ActionRequest } from '../src/engine/types';

function makeRequest(overrides: {
  agentId?: string;
  verificationTier?: string;
  reputationScore?: number;
  actionType?: string;
  resource?: string;
  parameters?: Record<string, unknown>;
}): ActionRequest {
  return {
    agent: {
      id: overrides.agentId || 'agent-1',
      verificationTier: (overrides.verificationTier || 'unverified') as ActionRequest['agent']['verificationTier'],
      reputationScore: overrides.reputationScore,
    },
    action: {
      type: overrides.actionType || 'read',
      resource: overrides.resource || 'data',
      parameters: overrides.parameters || {},
    },
    context: {
      timestamp: new Date().toISOString(),
      environment: 'development',
    },
  };
}

describe('CedarEngine', () => {
  describe('parseCedarPolicies', () => {
    it('should parse a simple permit policy', () => {
      const policies = parseCedarPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);
      expect(policies).toHaveLength(1);
      expect(policies[0].effect).toBe('permit');
      expect(policies[0].actionType).toContain('read');
    });

    it('should parse a forbid policy with conditions', () => {
      const policies = parseCedarPolicies(`
        forbid(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "unverified"
        };
      `);
      expect(policies).toHaveLength(1);
      expect(policies[0].effect).toBe('forbid');
      expect(policies[0].conditions).toHaveLength(1);
      expect(policies[0].conditions[0].alternatives).toHaveLength(1);
      expect(policies[0].conditions[0].alternatives[0].field).toBe('principal.verificationTier');
      expect(policies[0].conditions[0].alternatives[0].value).toBe('unverified');
    });

    it('should parse multiple policies', () => {
      const policies = parseCedarPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );

        forbid(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "unverified"
        };
      `);
      expect(policies).toHaveLength(2);
    });

    it('should parse conditions with numeric comparisons', () => {
      const policies = parseCedarPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"admin",
          resource
        )
        when {
          principal.reputationScore >= 4
        };
      `);
      expect(policies).toHaveLength(1);
      expect(policies[0].conditions[0].alternatives[0].operator).toBe('>=');
      expect(policies[0].conditions[0].alternatives[0].value).toBe(4);
    });

    it('should handle comments', () => {
      const policies = parseCedarPolicies(`
        // This is a comment
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);
      expect(policies).toHaveLength(1);
    });
  });

  describe('evaluate', () => {
    it('should allow when a permit policy matches', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);

      const result = engine.evaluate(makeRequest({ actionType: 'read' }));
      expect(result.decision).toBe('allow');
      expect(result.matchedPolicies.length).toBeGreaterThan(0);
    });

    it('should deny when no permit policy matches (default deny)', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);

      const result = engine.evaluate(makeRequest({ actionType: 'write' }));
      expect(result.decision).toBe('deny');
      expect(result.reasons).toContain('No matching permit policy found (default deny)');
    });

    it('should deny when a forbid policy matches even if permit also matches', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        );

        forbid(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "unverified"
        };
      `);

      const result = engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'unverified' }),
      );
      expect(result.decision).toBe('deny');
    });

    it('should allow verified agents to write', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "moltcaptcha"
        };
      `);

      const result = engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'moltcaptcha' }),
      );
      expect(result.decision).toBe('allow');
    });

    it('should enforce reputation score requirements', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"admin",
          resource
        )
        when {
          principal.verificationTier == "reputation" &&
          principal.reputationScore >= 4
        };
      `);

      // Agent with score 5 should be allowed
      const result1 = engine.evaluate(
        makeRequest({ actionType: 'admin', verificationTier: 'reputation', reputationScore: 5 }),
      );
      expect(result1.decision).toBe('allow');

      // Agent with score 3 should be denied
      const result2 = engine.evaluate(
        makeRequest({ actionType: 'admin', verificationTier: 'reputation', reputationScore: 3 }),
      );
      expect(result2.decision).toBe('deny');
    });

    it('should handle resource-level conditions', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        forbid(
          principal is Agent,
          action == MoltPermit::Action::"delete",
          resource
        )
        when {
          resource.sensitivity == "high" &&
          principal.verificationTier != "reputation"
        };

        permit(
          principal is Agent,
          action == MoltPermit::Action::"delete",
          resource
        );
      `);

      // Non-reputation agent deleting high-sensitivity resource should be denied
      const result1 = engine.evaluate(
        makeRequest({
          actionType: 'delete',
          verificationTier: 'blockchain',
          parameters: { sensitivity: 'high' },
        }),
      );
      expect(result1.decision).toBe('deny');

      // Reputation agent can delete high-sensitivity resource
      const result2 = engine.evaluate(
        makeRequest({
          actionType: 'delete',
          verificationTier: 'reputation',
          parameters: { sensitivity: 'high' },
        }),
      );
      expect(result2.decision).toBe('allow');
    });
  });

  describe('OR conditions (||)', () => {
    it('should parse OR conditions into a single ConditionGroup with multiple alternatives', () => {
      const policies = parseCedarPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "moltcaptcha" ||
          principal.verificationTier == "blockchain" ||
          principal.verificationTier == "reputation"
        };
      `);
      expect(policies).toHaveLength(1);
      expect(policies[0].conditions).toHaveLength(1);
      expect(policies[0].conditions[0].alternatives).toHaveLength(3);
      expect(policies[0].conditions[0].alternatives[0].value).toBe('moltcaptcha');
      expect(policies[0].conditions[0].alternatives[1].value).toBe('blockchain');
      expect(policies[0].conditions[0].alternatives[2].value).toBe('reputation');
    });

    it('should allow any OR alternative to satisfy the condition', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "moltcaptcha" ||
          principal.verificationTier == "blockchain" ||
          principal.verificationTier == "reputation"
        };
      `);

      // moltcaptcha should match
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'moltcaptcha' }),
      ).decision).toBe('allow');

      // blockchain should match
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'blockchain' }),
      ).decision).toBe('allow');

      // reputation should match
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'reputation' }),
      ).decision).toBe('allow');

      // unverified should NOT match
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'unverified' }),
      ).decision).toBe('deny');
    });

    it('should handle mixed AND and OR conditions', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"execute",
          resource
        )
        when {
          principal.verificationTier == "blockchain" ||
          principal.verificationTier == "reputation"
        };
      `);

      expect(engine.evaluate(
        makeRequest({ actionType: 'execute', verificationTier: 'blockchain' }),
      ).decision).toBe('allow');

      expect(engine.evaluate(
        makeRequest({ actionType: 'execute', verificationTier: 'reputation' }),
      ).decision).toBe('allow');

      expect(engine.evaluate(
        makeRequest({ actionType: 'execute', verificationTier: 'moltcaptcha' }),
      ).decision).toBe('deny');
    });

    it('should correctly evaluate AND of OR groups', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"admin",
          resource
        )
        when {
          principal.verificationTier == "reputation" &&
          principal.reputationScore >= 4
        };
      `);

      // Both AND groups must pass
      expect(engine.evaluate(
        makeRequest({ actionType: 'admin', verificationTier: 'reputation', reputationScore: 5 }),
      ).decision).toBe('allow');

      // First AND group fails
      expect(engine.evaluate(
        makeRequest({ actionType: 'admin', verificationTier: 'blockchain', reputationScore: 5 }),
      ).decision).toBe('deny');

      // Second AND group fails
      expect(engine.evaluate(
        makeRequest({ actionType: 'admin', verificationTier: 'reputation', reputationScore: 2 }),
      ).decision).toBe('deny');
    });

    it('should handle the default.cedar write policy correctly', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "moltcaptcha" ||
          principal.verificationTier == "blockchain" ||
          principal.verificationTier == "reputation"
        };

        forbid(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "unverified"
        };
      `);

      // Unverified should be denied (by forbid policy)
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'unverified' }),
      ).decision).toBe('deny');

      // Verified tiers should be allowed
      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'moltcaptcha' }),
      ).decision).toBe('allow');

      expect(engine.evaluate(
        makeRequest({ actionType: 'write', verificationTier: 'blockchain' }),
      ).decision).toBe('allow');
    });
  });

  describe('addPolicies', () => {
    it('should add policies incrementally', () => {
      const engine = new CedarEngine();
      engine.loadPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);

      engine.addPolicies(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"write",
          resource
        )
        when {
          principal.verificationTier == "moltcaptcha"
        };
      `);

      expect(engine.getPolicies()).toHaveLength(2);
    });
  });

  describe('validate', () => {
    it('should validate correct policy syntax', () => {
      const engine = new CedarEngine();
      const result = engine.validate(`
        permit(
          principal is Agent,
          action == MoltPermit::Action::"read",
          resource
        );
      `);
      expect(result.valid).toBe(true);
    });

    it('should reject empty policy input', () => {
      const engine = new CedarEngine();
      const result = engine.validate('');
      expect(result.valid).toBe(false);
    });
  });
});
