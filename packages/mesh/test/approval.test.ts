import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ApprovalManager } from '../src/policy/approval.js';
import { TaskEnvelope } from '../src/router/types.js';
import { TrustTier } from '../src/contracts/schema.js';

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    envelopeId: 'env-1',
    contractId: 'test-contract',
    version: '1.0.0',
    input: { query: 'test' },
    caller: {
      agentId: 'caller-agent',
      name: 'Caller',
      description: 'Test caller',
      trustTier: TrustTier.INTERNAL_RESTRICTED,
      capabilities: ['test'],
      allowedTools: [],
      metadata: {},
      registeredAt: new Date().toISOString(),
    },
    traceId: 'trace-1',
    metadata: {},
    ...overrides,
  };
}

describe('ApprovalManager', () => {
  let db: Database.Database;
  let manager: ApprovalManager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    manager = new ApprovalManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a pending approval request', () => {
    const request = manager.createRequest(makeEnvelope(), 'target-agent');
    expect(request.status).toBe('pending_approval');
    expect(request.agentId).toBe('target-agent');
    expect(request.callerAgentId).toBe('caller-agent');
    expect(request.contractId).toBe('test-contract');
    expect(request.approvalId).toBeDefined();
  });

  it('should approve a pending request', () => {
    const request = manager.createRequest(makeEnvelope(), 'target-agent');
    const approved = manager.approve(request.approvalId);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('approved');
    expect(approved!.resolvedAt).toBeDefined();
  });

  it('should deny a pending request with reason', () => {
    const request = manager.createRequest(makeEnvelope(), 'target-agent');
    const denied = manager.deny(request.approvalId, 'Not authorized for this action');
    expect(denied).toBeDefined();
    expect(denied!.status).toBe('denied');
    expect(denied!.reason).toBe('Not authorized for this action');
    expect(denied!.resolvedAt).toBeDefined();
  });

  it('should not approve an already resolved request', () => {
    const request = manager.createRequest(makeEnvelope(), 'target-agent');
    manager.deny(request.approvalId, 'denied');
    const result = manager.approve(request.approvalId);
    // The request stays denied
    expect(result!.status).toBe('denied');
  });

  it('should list pending approvals', () => {
    manager.createRequest(makeEnvelope(), 'agent-1');
    manager.createRequest(makeEnvelope({ envelopeId: 'env-2' }), 'agent-2');
    const pending = manager.getPending();
    expect(pending.length).toBe(2);
  });

  it('should retrieve a specific request', () => {
    const request = manager.createRequest(makeEnvelope(), 'target-agent');
    const retrieved = manager.getRequest(request.approvalId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.approvalId).toBe(request.approvalId);
    expect(retrieved!.envelope.contractId).toBe('test-contract');
  });

  it('should return undefined for non-existent request', () => {
    const result = manager.getRequest('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should list all requests including resolved', () => {
    const req1 = manager.createRequest(makeEnvelope(), 'agent-1');
    manager.createRequest(makeEnvelope({ envelopeId: 'env-2' }), 'agent-2');
    manager.approve(req1.approvalId);
    const all = manager.getAll();
    expect(all.length).toBe(2);
    const pending = manager.getPending();
    expect(pending.length).toBe(1);
  });
});
