import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { TaskEnvelope } from '../router/types.js';

/** Status of an approval request in its lifecycle. */
export type ApprovalStatus = 'pending_approval' | 'approved' | 'denied';

/** A request awaiting human approval before a task can be dispatched. */
export interface ApprovalRequest {
  approvalId: string;
  envelopeId: string;
  contractId: string;
  agentId: string;
  callerAgentId: string;
  status: ApprovalStatus;
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
  envelope: TaskEnvelope;
}

/** SQLite-backed manager for task approval workflows. */
export class ApprovalManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        approval_id TEXT PRIMARY KEY,
        envelope_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        caller_agent_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        envelope_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
    `);
  }

  /** Create a new pending approval request for a task envelope. */
  createRequest(envelope: TaskEnvelope, targetAgentId: string): ApprovalRequest {
    const approvalId = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO approval_requests (approval_id, envelope_id, contract_id, agent_id, caller_agent_id, status, created_at, envelope_json)
       VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?)`
      )
      .run(
        approvalId,
        envelope.envelopeId,
        envelope.contractId,
        targetAgentId,
        envelope.caller.agentId,
        now,
        JSON.stringify(envelope)
      );

    return {
      approvalId,
      envelopeId: envelope.envelopeId,
      contractId: envelope.contractId,
      agentId: targetAgentId,
      callerAgentId: envelope.caller.agentId,
      status: 'pending_approval',
      createdAt: now,
      envelope,
    };
  }

  /** Approve a pending request, marking it as approved. */
  approve(approvalId: string): ApprovalRequest | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approval_requests SET status = 'approved', resolved_at = ? WHERE approval_id = ? AND status = 'pending_approval'`
      )
      .run(now, approvalId);
    return this.getRequest(approvalId);
  }

  /** Deny a pending request with an optional reason. */
  deny(approvalId: string, reason?: string): ApprovalRequest | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approval_requests SET status = 'denied', reason = ?, resolved_at = ? WHERE approval_id = ? AND status = 'pending_approval'`
      )
      .run(reason || 'Denied by operator', now, approvalId);
    return this.getRequest(approvalId);
  }

  /** Retrieve an approval request by ID. */
  getRequest(approvalId: string): ApprovalRequest | undefined {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE approval_id = ?')
      .get(approvalId) as ApprovalRow | undefined;
    if (!row) return undefined;
    return this.rowToRequest(row);
  }

  /** Get all pending approval requests, ordered by creation time. */
  getPending(): ApprovalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_requests WHERE status = 'pending_approval' ORDER BY created_at ASC`
      )
      .all() as ApprovalRow[];
    return rows.map((r) => this.rowToRequest(r));
  }

  /** Get all approval requests regardless of status. */
  getAll(): ApprovalRequest[] {
    const rows = this.db
      .prepare(`SELECT * FROM approval_requests ORDER BY created_at DESC`)
      .all() as ApprovalRow[];
    return rows.map((r) => this.rowToRequest(r));
  }

  private rowToRequest(row: ApprovalRow): ApprovalRequest {
    return {
      approvalId: row.approval_id,
      envelopeId: row.envelope_id,
      contractId: row.contract_id,
      agentId: row.agent_id,
      callerAgentId: row.caller_agent_id,
      status: row.status as ApprovalStatus,
      reason: row.reason || undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
      envelope: JSON.parse(row.envelope_json),
    };
  }
}

interface ApprovalRow {
  approval_id: string;
  envelope_id: string;
  contract_id: string;
  agent_id: string;
  caller_agent_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  envelope_json: string;
}
