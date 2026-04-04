import { describe, it, expect, afterEach } from 'vitest';
import { CedarEngine } from '../src/engine/cedar-engine';
import { MoltPermit } from '../src/index';

describe('CedarEngine clearPolicies', () => {
  it('should clear all loaded policies', () => {
    const engine = new CedarEngine();
    engine.loadPolicies(`
      permit(
        principal is Agent,
        action == MoltPermit::Action::"read",
        resource
      );
    `);

    expect(engine.getPolicies()).toHaveLength(1);
    engine.clearPolicies();
    expect(engine.getPolicies()).toHaveLength(0);
  });

  it('should result in default deny after clearing', () => {
    const engine = new CedarEngine();
    engine.loadPolicies(`
      permit(
        principal is Agent,
        action == MoltPermit::Action::"read",
        resource
      );
    `);

    engine.clearPolicies();

    const result = engine.evaluate({
      agent: { id: 'agent-1', verificationTier: 'unverified' },
      action: { type: 'read', resource: 'data', parameters: {} },
      context: { timestamp: new Date().toISOString(), environment: 'development' },
    });

    expect(result.decision).toBe('deny');
  });
});

describe('MoltPermit clearPolicies and reloadPolicies', () => {
  let permit: MoltPermit;

  afterEach(() => {
    permit?.close();
  });

  it('should clear policies via MoltPermit', () => {
    permit = new MoltPermit({ audit: { store: 'memory' } });
    permit.loadPoliciesFromString(`
      permit(
        principal is Agent,
        action == MoltPermit::Action::"read",
        resource
      );
    `);

    expect(permit.getPolicyCount()).toBe(1);
    permit.clearPolicies();
    expect(permit.getPolicyCount()).toBe(0);
  });

  it('should reload policies from config path', () => {
    permit = new MoltPermit({
      policies: './policies',
      audit: { store: 'memory' },
    });

    const initialCount = permit.getPolicyCount();
    expect(initialCount).toBeGreaterThan(0);

    permit.clearPolicies();
    expect(permit.getPolicyCount()).toBe(0);

    permit.reloadPolicies();
    expect(permit.getPolicyCount()).toBe(initialCount);
  });

  it('should handle reload with no policies path', () => {
    permit = new MoltPermit({ audit: { store: 'memory' } });
    permit.loadPoliciesFromString(`
      permit(
        principal is Agent,
        action == MoltPermit::Action::"read",
        resource
      );
    `);

    permit.reloadPolicies();
    // No policies path configured, so clearPolicies is called but nothing reloaded
    expect(permit.getPolicyCount()).toBe(0);
  });
});
