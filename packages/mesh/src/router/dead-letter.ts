import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { TaskEnvelope } from './types.js';

/** Record of a single failed dispatch attempt for dead-letter tracking. */
export interface DeadLetterAttempt {
  timestamp: string;
  error: string;
  agentId: string;
  durationMs: number;
}

/** A task that exhausted all retries and was sent to the dead-letter queue. */
export interface DeadLetter {
  id: string;
  envelope: TaskEnvelope;
  attempts: DeadLetterAttempt[];
  contractId: string;
  reason: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

/** SQLite-backed dead-letter queue for tasks that failed all dispatch attempts. */
export class DeadLetterQueue {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dead_letters (
        id TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        attempts_json TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dead_letter_contract ON dead_letters(contract_id);
      CREATE INDEX IF NOT EXISTS idx_dead_letter_resolved ON dead_letters(resolved);
    `);
  }

  /** Add a failed task to the dead-letter queue. */
  add(envelope: TaskEnvelope, attempts: DeadLetterAttempt[], reason: string): DeadLetter {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO dead_letters (id, envelope_json, attempts_json, contract_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        JSON.stringify(envelope),
        JSON.stringify(attempts),
        envelope.contractId,
        reason,
        now
      );

    return {
      id,
      envelope,
      attempts,
      contractId: envelope.contractId,
      reason,
      createdAt: now,
      resolved: false,
    };
  }

  /** Retrieve a dead letter by its ID. */
  get(id: string): DeadLetter | undefined {
    const row = this.db.prepare('SELECT * FROM dead_letters WHERE id = ?').get(id) as
      | DeadLetterRow
      | undefined;
    if (!row) return undefined;
    return this.rowToDeadLetter(row);
  }

  /** List dead letters, optionally including resolved ones. */
  getAll(includeResolved = false): DeadLetter[] {
    const sql = includeResolved
      ? 'SELECT * FROM dead_letters ORDER BY created_at DESC'
      : 'SELECT * FROM dead_letters WHERE resolved = 0 ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all() as DeadLetterRow[];
    return rows.map((r) => this.rowToDeadLetter(r));
  }

  /** Mark a dead letter as resolved. Returns true if the letter was found and resolved. */
  resolve(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE dead_letters SET resolved = 1, resolved_at = ? WHERE id = ? AND resolved = 0`
      )
      .run(now, id);
    return result.changes > 0;
  }

  /** Count unresolved dead letters. */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM dead_letters WHERE resolved = 0')
      .get() as { cnt: number };
    return row.cnt;
  }

  private rowToDeadLetter(row: DeadLetterRow): DeadLetter {
    return {
      id: row.id,
      envelope: JSON.parse(row.envelope_json),
      attempts: JSON.parse(row.attempts_json),
      contractId: row.contract_id,
      reason: row.reason,
      createdAt: row.created_at,
      resolved: row.resolved === 1,
      resolvedAt: row.resolved_at || undefined,
    };
  }
}

interface DeadLetterRow {
  id: string;
  envelope_json: string;
  attempts_json: string;
  contract_id: string;
  reason: string;
  created_at: string;
  resolved: number;
  resolved_at: string | null;
}
