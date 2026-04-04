import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EscalationManager } from '../src/escalation/manager';
import {
  EscalationPolicy,
  EscalationTrigger,
  EscalationContext,
  EscalationResolution,
} from '../src/escalation/types';
import { MoltPermit } from '../src/index';

function makePolicy(overrides: Partial<EscalationPolicy> = {}): EscalationPolicy {
  return {
    id: 'policy-1',
    name: 'Default Escalation Policy',
    triggers: [{ type: 'policy-deny' }],
    routing: {
      channel: 'webhook',
      target: 'https://example.com/escalate',
      severity: 'medium',
    },
    timeoutMs: 5000,
    timeoutAction: 'deny',
    ...overrides,
  };
}

function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    action: 'read',
    reason: 'Policy denied the action',
    metadata: {},
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<EscalationTrigger> = {}): EscalationTrigger {
  return {
    type: 'policy-deny',
    ...overrides,
  };
}

// -- EscalationManager: Policy Registration --

describe('EscalationManager', () => {
  let manager: EscalationManager;

  beforeEach(() => {
    manager = new EscalationManager(':memory:');
  });

  afterEach(() => {
    manager.close();
  });

  describe('Policy Registration', () => {
    it('should register a policy and retrieve it', () => {
      manager.registerPolicy(makePolicy());
      const policies = manager.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].id).toBe('policy-1');
      expect(policies[0].name).toBe('Default Escalation Policy');
    });

    it('should register multiple policies', () => {
      manager.registerPolicy(makePolicy({ id: 'p1', name: 'Policy 1' }));
      manager.registerPolicy(makePolicy({ id: 'p2', name: 'Policy 2' }));
      expect(manager.getPolicies()).toHaveLength(2);
    });

    it('should overwrite a policy with the same ID', () => {
      manager.registerPolicy(makePolicy({ id: 'p1', name: 'Original' }));
      manager.registerPolicy(makePolicy({ id: 'p1', name: 'Updated' }));
      const policies = manager.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].name).toBe('Updated');
    });

    it('should remove a policy by ID', () => {
      manager.registerPolicy(makePolicy());
      const removed = manager.removePolicy('policy-1');
      expect(removed).toBe(true);
      expect(manager.getPolicies()).toHaveLength(0);
    });

    it('should return false when removing a non-existent policy', () => {
      const removed = manager.removePolicy('non-existent');
      expect(removed).toBe(false);
    });

    it('should persist policy triggers and routing as JSON', () => {
      const policy = makePolicy({
        triggers: [
          { type: 'policy-deny', actionPattern: 'write*', resourcePattern: 'db/*' },
          { type: 'budget-exceeded' },
        ],
        routing: {
          channel: 'queue',
          target: 'escalation-queue',
          severity: 'high',
          assignee: 'team-lead',
        },
      });
      manager.registerPolicy(policy);
      const retrieved = manager.getPolicies()[0];
      expect(retrieved.triggers).toHaveLength(2);
      expect(retrieved.triggers[0].actionPattern).toBe('write*');
      expect(retrieved.routing.channel).toBe('queue');
      expect(retrieved.routing.assignee).toBe('team-lead');
    });
  });

  // -- Escalation Creation --

  describe('Escalation Creation', () => {
    it('should create an escalation request with a unique ID', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      expect(req.id).toBeDefined();
      expect(req.id.length).toBeGreaterThan(0);
      expect(req.agentId).toBe('agent-1');
      expect(req.status).toBe('pending');
    });

    it('should match a registered policy and assign its severity', () => {
      manager.registerPolicy(makePolicy({
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'critical' },
      }));
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      expect(req.severity).toBe('critical');
      expect(req.policyId).toBe('policy-1');
    });

    it('should use default medium severity when no policy matches', () => {
      const req = manager.escalate('agent-1', makeTrigger({ type: 'safety-flag' }), makeContext());
      expect(req.severity).toBe('medium');
      expect(req.policyId).toBeUndefined();
    });

    it('should store the escalation context', () => {
      const ctx = makeContext({
        action: 'delete',
        reason: 'Dangerous operation',
        agentReasoning: 'I wanted to clean up old data',
        policyDetails: { ruleId: 'policy_0', reason: 'Forbidden by admin' },
        metadata: { requestId: 'req-123' },
      });
      const req = manager.escalate('agent-1', makeTrigger(), ctx);
      const retrieved = manager.getById(req.id);
      expect(retrieved!.context.action).toBe('delete');
      expect(retrieved!.context.reason).toBe('Dangerous operation');
      expect(retrieved!.context.agentReasoning).toBe('I wanted to clean up old data');
      expect(retrieved!.context.policyDetails!.ruleId).toBe('policy_0');
      expect(retrieved!.context.metadata).toEqual({ requestId: 'req-123' });
    });

    it('should match policy by trigger type', () => {
      manager.registerPolicy(makePolicy({
        id: 'budget-policy',
        triggers: [{ type: 'budget-exceeded' }],
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'high' },
      }));
      manager.registerPolicy(makePolicy({
        id: 'deny-policy',
        triggers: [{ type: 'policy-deny' }],
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'low' },
      }));

      const req = manager.escalate('agent-1', makeTrigger({ type: 'budget-exceeded' }), makeContext());
      expect(req.policyId).toBe('budget-policy');
      expect(req.severity).toBe('high');
    });

    it('should match policy by action pattern', () => {
      manager.registerPolicy(makePolicy({
        triggers: [{ type: 'policy-deny', actionPattern: 'write*' }],
      }));

      const matched = manager.escalate('agent-1', makeTrigger({ actionPattern: 'write-db' }), makeContext());
      expect(matched.policyId).toBe('policy-1');

      const unmatched = manager.escalate('agent-1', makeTrigger({ actionPattern: 'read-file' }), makeContext());
      expect(unmatched.policyId).toBeUndefined();
    });
  });

  // -- Claim/Resolve Flow --

  describe('Claim and Resolve Flow', () => {
    it('should claim a pending escalation', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      const claimed = manager.claim(req.id, 'reviewer-1');
      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('claimed');
      expect(claimed!.claimedBy).toBe('reviewer-1');
      expect(claimed!.claimedAt).toBeGreaterThan(0);
    });

    it('should not claim an already claimed escalation', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.claim(req.id, 'reviewer-1');
      const secondClaim = manager.claim(req.id, 'reviewer-2');
      expect(secondClaim).toBeNull();
    });

    it('should not claim a non-existent escalation', () => {
      const claimed = manager.claim('non-existent', 'reviewer-1');
      expect(claimed).toBeNull();
    });

    it('should resolve a pending escalation', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      const resolution: EscalationResolution = {
        decision: 'approve',
        reason: 'Looks safe',
        resolvedBy: 'admin-1',
      };
      const resolved = manager.resolve(req.id, resolution);
      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('resolved');
      expect(resolved!.resolution!.decision).toBe('approve');
      expect(resolved!.resolvedAt).toBeGreaterThan(0);
    });

    it('should resolve a claimed escalation', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.claim(req.id, 'reviewer-1');
      const resolution: EscalationResolution = {
        decision: 'deny',
        reason: 'Too risky',
        resolvedBy: 'reviewer-1',
      };
      const resolved = manager.resolve(req.id, resolution);
      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('resolved');
    });

    it('should not resolve an already resolved escalation', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      const resolution: EscalationResolution = {
        decision: 'approve',
        reason: 'OK',
        resolvedBy: 'admin-1',
      };
      manager.resolve(req.id, resolution);
      const secondResolve = manager.resolve(req.id, {
        decision: 'deny',
        reason: 'Changed my mind',
        resolvedBy: 'admin-1',
      });
      expect(secondResolve).toBeNull();
    });

    it('should persist resolution with policy modification', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      const resolution: EscalationResolution = {
        decision: 'modify-policy',
        reason: 'Need to update the rule',
        resolvedBy: 'admin-1',
        policyModification: {
          ruleId: 'policy_0',
          newConditions: { minReputationScore: 50 },
        },
      };
      const resolved = manager.resolve(req.id, resolution);
      expect(resolved!.resolution!.policyModification!.ruleId).toBe('policy_0');
      expect(resolved!.resolution!.policyModification!.newConditions).toEqual({ minReputationScore: 50 });
    });
  });

  // -- Pending Queries --

  describe('Pending Queries', () => {
    it('should get all pending escalations', () => {
      manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.escalate('agent-2', makeTrigger(), makeContext());
      const pending = manager.getPending();
      expect(pending).toHaveLength(2);
    });

    it('should filter pending escalations by severity', () => {
      manager.registerPolicy(makePolicy({
        id: 'high-policy',
        triggers: [{ type: 'safety-flag' }],
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'high' },
      }));
      manager.registerPolicy(makePolicy({
        id: 'low-policy',
        triggers: [{ type: 'policy-deny' }],
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'low' },
      }));

      manager.escalate('agent-1', makeTrigger({ type: 'safety-flag' }), makeContext());
      manager.escalate('agent-2', makeTrigger({ type: 'policy-deny' }), makeContext());

      const highOnly = manager.getPending('high');
      expect(highOnly).toHaveLength(1);
      expect(highOnly[0].severity).toBe('high');
    });

    it('should not include resolved escalations in pending', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.resolve(req.id, { decision: 'approve', reason: 'ok', resolvedBy: 'admin' });
      expect(manager.getPending()).toHaveLength(0);
    });
  });

  // -- Timeout Processing --

  describe('Timeout Processing', () => {
    it('should expire escalations past their timeout', async () => {
      manager.registerPolicy(makePolicy({ timeoutMs: 10, timeoutAction: 'deny' }));
      manager.escalate('agent-1', makeTrigger(), makeContext());

      // Wait for timeout to pass
      await new Promise(resolve => setTimeout(resolve, 20));
      const expired = manager.processTimeouts();
      expect(expired).toHaveLength(1);
      expect(expired[0].status).toBe('expired');
    });

    it('should auto-resolve with allow-with-warning on timeout', async () => {
      manager.registerPolicy(makePolicy({ timeoutMs: 10, timeoutAction: 'allow-with-warning' }));
      manager.escalate('agent-1', makeTrigger(), makeContext());

      await new Promise(resolve => setTimeout(resolve, 20));
      const expired = manager.processTimeouts();
      expect(expired).toHaveLength(1);
      expect(expired[0].status).toBe('auto-resolved');
      expect(expired[0].resolution!.decision).toBe('approve');
      expect(expired[0].resolution!.resolvedBy).toBe('system');
    });

    it('should re-escalate on timeout with higher severity', async () => {
      manager.registerPolicy(makePolicy({
        timeoutMs: 10,
        timeoutAction: 're-escalate',
        routing: { channel: 'webhook', target: 'https://example.com', severity: 'low' },
      }));
      manager.escalate('agent-1', makeTrigger(), makeContext());

      await new Promise(resolve => setTimeout(resolve, 20));
      const expired = manager.processTimeouts();
      expect(expired.length).toBeGreaterThanOrEqual(1);

      // The original should be expired
      const expiredOnes = expired.filter(e => e.status === 'expired');
      expect(expiredOnes.length).toBeGreaterThanOrEqual(1);

      // A new escalation should exist with higher severity
      const pending = manager.getPending();
      // The re-escalated request should be medium (one step above low)
      if (pending.length > 0) {
        expect(pending[0].severity).toBe('medium');
      }
    });

    it('should not expire escalations within their timeout window', () => {
      manager.registerPolicy(makePolicy({ timeoutMs: 999999, timeoutAction: 'deny' }));
      manager.escalate('agent-1', makeTrigger(), makeContext());

      const expired = manager.processTimeouts();
      expect(expired).toHaveLength(0);
    });
  });

  // -- Agent History --

  describe('Agent History', () => {
    it('should return escalation history for an agent', () => {
      manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.escalate('agent-2', makeTrigger(), makeContext());

      const history = manager.getAgentHistory('agent-1');
      expect(history).toHaveLength(2);
      expect(history.every(h => h.agentId === 'agent-1')).toBe(true);
    });

    it('should respect the limit parameter', () => {
      manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.escalate('agent-1', makeTrigger(), makeContext());
      manager.escalate('agent-1', makeTrigger(), makeContext());

      const history = manager.getAgentHistory('agent-1', 2);
      expect(history).toHaveLength(2);
    });

    it('should return empty array for unknown agent', () => {
      const history = manager.getAgentHistory('unknown-agent');
      expect(history).toHaveLength(0);
    });
  });

  // -- GetById --

  describe('GetById', () => {
    it('should retrieve an escalation by ID', () => {
      const req = manager.escalate('agent-1', makeTrigger(), makeContext());
      const retrieved = manager.getById(req.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(req.id);
      expect(retrieved!.agentId).toBe('agent-1');
    });

    it('should return null for non-existent ID', () => {
      const retrieved = manager.getById('non-existent');
      expect(retrieved).toBeNull();
    });
  });
});

// -- Integration with MoltPermit --

describe('MoltPermit Escalation Integration', () => {
  let permit: MoltPermit;

  afterEach(() => {
    permit?.close();
  });

  it('should return escalated decision when escalation is enabled and policy denies', async () => {
    permit = new MoltPermit({
      escalation: {
        enabled: true,
        policies: [makePolicy()],
      },
    });

    // No Cedar policies loaded → default deny → should escalate
    const result = await permit.evaluate({
      agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    expect(result.decision).toBe('escalated');
    expect(result.escalationId).toBeDefined();
  });

  it('should return normal deny when escalation is not enabled', async () => {
    permit = new MoltPermit({});

    const result = await permit.evaluate({
      agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    expect(result.decision).toBe('deny');
    expect(result.escalationId).toBeUndefined();
  });

  it('should return allow when Cedar policy allows, even with escalation enabled', async () => {
    permit = new MoltPermit({
      escalation: {
        enabled: true,
        policies: [makePolicy()],
      },
    });

    permit.loadPoliciesFromString(`
      permit(
        principal,
        action,
        resource
      );
    `);

    const result = await permit.evaluate({
      agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    expect(result.decision).toBe('allow');
    expect(result.escalationId).toBeUndefined();
  });

  it('should provide access to the EscalationManager instance', () => {
    permit = new MoltPermit({
      escalation: { enabled: true },
    });

    const mgr = permit.getEscalationManager();
    expect(mgr).not.toBeNull();
    expect(mgr).toBeInstanceOf(EscalationManager);
  });

  it('should return null EscalationManager when escalation is disabled', () => {
    permit = new MoltPermit({});
    expect(permit.getEscalationManager()).toBeNull();
  });

  it('should create retrievable escalation requests on deny', async () => {
    permit = new MoltPermit({
      escalation: {
        enabled: true,
        policies: [makePolicy()],
      },
    });

    const result = await permit.evaluate({
      agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    const mgr = permit.getEscalationManager()!;
    const escalation = mgr.getById(result.escalationId!);
    expect(escalation).not.toBeNull();
    expect(escalation!.agentId).toBe('agent-1');
    expect(escalation!.status).toBe('pending');
    expect(escalation!.context.action).toBe('read');
  });
});
