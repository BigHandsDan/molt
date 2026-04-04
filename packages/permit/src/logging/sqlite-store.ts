import Database from 'better-sqlite3';
import { AuditEntry, AuditQuery } from './types.js';

export class SqliteAuditStore {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        resource TEXT NOT NULL,
        decision TEXT NOT NULL,
        reasons TEXT NOT NULL,
        matched_policies TEXT NOT NULL,
        outcome TEXT,
        reversible INTEGER NOT NULL DEFAULT 0,
        reverse_action_id TEXT,
        duration_ms INTEGER,
        action_request TEXT NOT NULL,
        policy_decision TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_log(action_type);
    `);
  }

  insert(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, agent_id, action_type, resource, decision,
        reasons, matched_policies, outcome, reversible, reverse_action_id,
        duration_ms, action_request, policy_decision, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.timestamp,
      entry.actionRequest.agent.id,
      entry.actionRequest.action.type,
      entry.actionRequest.action.resource,
      entry.decision.decision,
      JSON.stringify(entry.decision.reasons),
      JSON.stringify(entry.decision.matchedPolicies),
      entry.outcome || null,
      entry.reversible ? 1 : 0,
      entry.reverseActionId || null,
      entry.durationMs || null,
      JSON.stringify(entry.actionRequest),
      JSON.stringify(entry.decision),
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    );
  }

  query(query: AuditQuery): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.agentId) {
      conditions.push('agent_id = ?');
      params.push(query.agentId);
    }
    if (query.decision) {
      conditions.push('decision = ?');
      params.push(query.decision);
    }
    if (query.since) {
      conditions.push('timestamp >= ?');
      params.push(query.since);
    }
    if (query.until) {
      conditions.push('timestamp <= ?');
      params.push(query.until);
    }
    if (query.actionType) {
      conditions.push('action_type = ?');
      params.push(query.actionType);
    }
    if (query.outcome) {
      conditions.push('outcome = ?');
      params.push(query.outcome);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const sql = `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEntry(row));
  }

  getById(id: string): AuditEntry | null {
    const row = this.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  updateOutcome(id: string, outcome: AuditEntry['outcome'], reverseActionId?: string): void {
    if (reverseActionId) {
      this.db.prepare('UPDATE audit_log SET outcome = ?, reverse_action_id = ? WHERE id = ?')
        .run(outcome, reverseActionId, id);
    } else {
      this.db.prepare('UPDATE audit_log SET outcome = ? WHERE id = ?')
        .run(outcome, id);
    }
  }

  updateReversible(id: string, reversible: boolean): void {
    this.db.prepare('UPDATE audit_log SET reversible = ? WHERE id = ?')
      .run(reversible ? 1 : 0, id);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      id: row.id as string,
      timestamp: row.timestamp as string,
      actionRequest: JSON.parse(row.action_request as string),
      decision: JSON.parse(row.policy_decision as string),
      outcome: (row.outcome as AuditEntry['outcome']) || undefined,
      reversible: row.reversible === 1,
      reverseActionId: (row.reverse_action_id as string) || undefined,
      durationMs: (row.duration_ms as number) || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }
}
