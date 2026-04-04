import { describe, it, expect, vi, afterEach } from 'vitest';
import { MoltPermit } from '../src/index';

describe('Actionable Rollbacks', () => {
  let permit: MoltPermit;

  afterEach(() => {
    permit?.close();
  });

  function makePermit() {
    const p = new MoltPermit({ audit: { store: 'memory' } });
    p.loadPoliciesFromString(`
      permit(
        principal is Agent,
        action == MoltPermit::Action::"read",
        resource
      );
      permit(
        principal is Agent,
        action == MoltPermit::Action::"write",
        resource
      );
    `);
    return p;
  }

  it('should execute rollback callback when registered', async () => {
    permit = makePermit();
    const rollbackFn = vi.fn().mockResolvedValue(undefined);

    const decision = await permit.evaluateWithRollback(
      {
        agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
        action: { type: 'write', resource: 'data', parameters: {} },
        context: { timestamp: new Date().toISOString(), environment: 'development' },
      },
      rollbackFn,
    );

    expect(decision.decision).toBe('allow');

    const result = await permit.rollback(decision.auditId);
    expect(result.success).toBe(true);
    expect(rollbackFn).toHaveBeenCalledOnce();
  });

  it('should mark audit entry as rolled back after callback', async () => {
    permit = makePermit();
    const rollbackFn = vi.fn().mockResolvedValue(undefined);

    const decision = await permit.evaluateWithRollback(
      {
        agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
        action: { type: 'write', resource: 'data', parameters: {} },
        context: { timestamp: new Date().toISOString(), environment: 'development' },
      },
      rollbackFn,
    );

    await permit.rollback(decision.auditId);

    const logs = permit.queryLogs({ agentId: 'agent-1' });
    const entry = logs.find((l) => l.id === decision.auditId);
    expect(entry).toBeDefined();
    expect(entry!.outcome).toBe('rolled_back');
    expect(entry!.reverseActionId).toBeDefined();
  });

  it('should return error when rollback callback throws', async () => {
    permit = makePermit();
    const rollbackFn = vi.fn().mockRejectedValue(new Error('Undo failed'));

    const decision = await permit.evaluateWithRollback(
      {
        agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
        action: { type: 'write', resource: 'data', parameters: {} },
        context: { timestamp: new Date().toISOString(), environment: 'development' },
      },
      rollbackFn,
    );

    const result = await permit.rollback(decision.auditId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Undo failed');
  });

  it('should still mark log when no callback is registered', async () => {
    permit = makePermit();

    const decision = await permit.evaluate({
      agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    const result = await permit.rollback(decision.auditId);
    expect(result.success).toBe(true);

    const logs = permit.queryLogs({ agentId: 'agent-1' });
    const entry = logs.find((l) => l.id === decision.auditId);
    expect(entry!.outcome).toBe('rolled_back');
  });

  it('should not register rollback callback on deny', async () => {
    permit = new MoltPermit({ audit: { store: 'memory' } });
    // No permit policies loaded, so everything is denied

    const rollbackFn = vi.fn().mockResolvedValue(undefined);

    const decision = await permit.evaluateWithRollback(
      {
        agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
        action: { type: 'write', resource: 'data', parameters: {} },
        context: { timestamp: new Date().toISOString(), environment: 'development' },
      },
      rollbackFn,
    );

    expect(decision.decision).toBe('deny');

    // Rollback should just mark the log, not call the fn
    const result = await permit.rollback(decision.auditId);
    expect(result.success).toBe(true);
    expect(rollbackFn).not.toHaveBeenCalled();
  });

  it('should mark audit entry as reversible when rollback fn is provided', async () => {
    permit = makePermit();
    const rollbackFn = vi.fn().mockResolvedValue(undefined);

    const decision = await permit.evaluateWithRollback(
      {
        agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
        action: { type: 'write', resource: 'data', parameters: {} },
        context: { timestamp: new Date().toISOString(), environment: 'development' },
      },
      rollbackFn,
    );

    const logs = permit.queryLogs({ agentId: 'agent-1' });
    const entry = logs.find((l) => l.id === decision.auditId);
    expect(entry!.reversible).toBe(true);
  });
});
