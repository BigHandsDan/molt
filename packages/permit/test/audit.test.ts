import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAuditStore } from '../src/logging/sqlite-store';
import { AuditLogger } from '../src/logging/audit-logger';
import { ActionRequest, PolicyDecision } from '../src/engine/types';
import { AuditEntry } from '../src/logging/types';

function makeRequest(): ActionRequest {
  return {
    agent: { id: 'agent-1', verificationTier: 'moltcaptcha' },
    action: { type: 'read', resource: 'data', parameters: {} },
    context: { timestamp: new Date().toISOString(), environment: 'development' },
  };
}

function makeDecision(decision: 'allow' | 'deny' = 'allow'): PolicyDecision {
  return {
    decision,
    reasons: [decision === 'allow' ? 'Allowed by policy' : 'Denied by policy'],
    matchedPolicies: ['policy_0'],
    auditId: '',
  };
}

describe('SqliteAuditStore', () => {
  let store: SqliteAuditStore;

  beforeEach(() => {
    store = new SqliteAuditStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('should insert and retrieve audit entries', () => {
    const entry: AuditEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision(),
      outcome: 'pending',
      reversible: false,
    };

    store.insert(entry);
    const retrieved = store.getById('test-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('test-1');
    expect(retrieved!.actionRequest.agent.id).toBe('agent-1');
  });

  it('should query by agent ID', () => {
    const entry1: AuditEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision(),
      outcome: 'pending',
      reversible: false,
    };

    const entry2: AuditEntry = {
      id: 'test-2',
      timestamp: new Date().toISOString(),
      actionRequest: {
        ...makeRequest(),
        agent: { id: 'agent-2', verificationTier: 'unverified' },
      },
      decision: makeDecision('deny'),
      outcome: 'pending',
      reversible: false,
    };

    store.insert(entry1);
    store.insert(entry2);

    const results = store.query({ agentId: 'agent-1' });
    expect(results).toHaveLength(1);
    expect(results[0].actionRequest.agent.id).toBe('agent-1');
  });

  it('should query by decision', () => {
    const entry1: AuditEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision('allow'),
      outcome: 'pending',
      reversible: false,
    };

    const entry2: AuditEntry = {
      id: 'test-2',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision('deny'),
      outcome: 'pending',
      reversible: false,
    };

    store.insert(entry1);
    store.insert(entry2);

    const denies = store.query({ decision: 'deny' });
    expect(denies).toHaveLength(1);
    expect(denies[0].decision.decision).toBe('deny');
  });

  it('should update outcome', () => {
    const entry: AuditEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision(),
      outcome: 'pending',
      reversible: true,
    };

    store.insert(entry);
    store.updateOutcome('test-1', 'success');

    const retrieved = store.getById('test-1');
    expect(retrieved!.outcome).toBe('success');
  });

  it('should mark as rolled back', () => {
    const entry: AuditEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      actionRequest: makeRequest(),
      decision: makeDecision(),
      outcome: 'pending',
      reversible: true,
    };

    store.insert(entry);
    store.updateOutcome('test-1', 'rolled_back', 'reverse-1');

    const retrieved = store.getById('test-1');
    expect(retrieved!.outcome).toBe('rolled_back');
    expect(retrieved!.reverseActionId).toBe('reverse-1');
  });
});

describe('AuditLogger', () => {
  let store: SqliteAuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new SqliteAuditStore(':memory:');
    logger = new AuditLogger(store);
  });

  afterEach(() => {
    store.close();
  });

  it('should log an audit entry and return it with an ID', () => {
    const entry = logger.log(makeRequest(), makeDecision());
    expect(entry.id).toBeDefined();
    expect(entry.decision.auditId).toBe(entry.id);
  });

  it('should retrieve logged entries', () => {
    logger.log(makeRequest(), makeDecision());
    logger.log(makeRequest(), makeDecision('deny'));

    const all = logger.query({});
    expect(all).toHaveLength(2);
  });

  it('should record outcome', () => {
    const entry = logger.log(makeRequest(), makeDecision());
    logger.recordOutcome(entry.id, 'success');

    const retrieved = logger.getById(entry.id);
    expect(retrieved!.outcome).toBe('success');
  });

  it('should mark rolled back', () => {
    const entry = logger.log(makeRequest(), makeDecision(), { reversible: true });
    logger.markRolledBack(entry.id, 'reverse-123');

    const retrieved = logger.getById(entry.id);
    expect(retrieved!.outcome).toBe('rolled_back');
    expect(retrieved!.reverseActionId).toBe('reverse-123');
  });
});
