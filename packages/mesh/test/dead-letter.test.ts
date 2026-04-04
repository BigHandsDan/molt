import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DeadLetterQueue } from '../src/router/dead-letter.js';
import { TaskEnvelope } from '../src/router/types.js';
import { TrustTier } from '../src/contracts/schema.js';

function makeEnvelope(contractId = 'test-contract'): TaskEnvelope {
  return {
    envelopeId: 'env-1',
    contractId,
    version: '1.0.0',
    input: { query: 'test' },
    caller: {
      agentId: 'caller-agent',
      name: 'Caller',
      description: 'Test',
      trustTier: TrustTier.INTERNAL_TRUSTED,
      capabilities: ['test'],
      allowedTools: [],
      metadata: {},
      registeredAt: new Date().toISOString(),
    },
    traceId: 'trace-1',
    metadata: {},
  };
}

describe('DeadLetterQueue', () => {
  let db: Database.Database;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    dlq = new DeadLetterQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should add a dead letter', () => {
    const dl = dlq.add(
      makeEnvelope(),
      [
        {
          timestamp: new Date().toISOString(),
          error: 'Timeout',
          agentId: 'agent-1',
          durationMs: 5000,
        },
      ],
      'All retries exhausted'
    );
    expect(dl.id).toBeDefined();
    expect(dl.contractId).toBe('test-contract');
    expect(dl.reason).toBe('All retries exhausted');
    expect(dl.resolved).toBe(false);
    expect(dl.attempts.length).toBe(1);
  });

  it('should retrieve a dead letter by ID', () => {
    const dl = dlq.add(makeEnvelope(), [], 'Failed');
    const retrieved = dlq.get(dl.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(dl.id);
  });

  it('should list unresolved dead letters', () => {
    dlq.add(makeEnvelope(), [], 'Failed 1');
    dlq.add(makeEnvelope('other-contract'), [], 'Failed 2');
    const all = dlq.getAll();
    expect(all.length).toBe(2);
  });

  it('should resolve a dead letter', () => {
    const dl = dlq.add(makeEnvelope(), [], 'Failed');
    const resolved = dlq.resolve(dl.id);
    expect(resolved).toBe(true);
    const retrieved = dlq.get(dl.id);
    expect(retrieved!.resolved).toBe(true);
    expect(retrieved!.resolvedAt).toBeDefined();
  });

  it('should not include resolved dead letters by default', () => {
    const dl = dlq.add(makeEnvelope(), [], 'Failed');
    dlq.resolve(dl.id);
    const unresolved = dlq.getAll(false);
    expect(unresolved.length).toBe(0);
    const all = dlq.getAll(true);
    expect(all.length).toBe(1);
  });

  it('should count unresolved dead letters', () => {
    dlq.add(makeEnvelope(), [], 'Failed 1');
    dlq.add(makeEnvelope(), [], 'Failed 2');
    expect(dlq.count()).toBe(2);
    const dl = dlq.getAll()[0];
    dlq.resolve(dl.id);
    expect(dlq.count()).toBe(1);
  });

  it('should store attempt details', () => {
    const attempts = [
      {
        timestamp: '2024-01-01T00:00:00Z',
        error: 'Timeout after 5000ms',
        agentId: 'agent-1',
        durationMs: 5000,
      },
      {
        timestamp: '2024-01-01T00:00:06Z',
        error: 'Connection refused',
        agentId: 'agent-1',
        durationMs: 100,
      },
    ];
    const dl = dlq.add(makeEnvelope(), attempts, 'All retries exhausted');
    const retrieved = dlq.get(dl.id);
    expect(retrieved!.attempts.length).toBe(2);
    expect(retrieved!.attempts[0].error).toBe('Timeout after 5000ms');
    expect(retrieved!.attempts[1].durationMs).toBe(100);
  });

  it('should return false when resolving non-existent dead letter', () => {
    const result = dlq.resolve('nonexistent');
    expect(result).toBe(false);
  });
});
