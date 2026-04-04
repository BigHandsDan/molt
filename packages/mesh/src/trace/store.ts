import Database from 'better-sqlite3';
import { TraceEvent, TraceFilter } from './types.js';

/** SQLite-backed storage for distributed trace events with indexed queries. */
export class TraceStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        duration_ms REAL,
        data TEXT NOT NULL,
        contract_id TEXT,
        agent_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trace_id ON trace_events(trace_id);
      CREATE INDEX IF NOT EXISTS idx_agent_id ON trace_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_contract_id ON trace_events(contract_id);
      CREATE INDEX IF NOT EXISTS idx_event_type ON trace_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON trace_events(timestamp);
    `);
  }

  /** Persist a trace event. */
  record(event: TraceEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO trace_events (trace_id, span_id, parent_span_id, event_type, timestamp, duration_ms, data, contract_id, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.traceId,
      event.spanId,
      event.parentSpanId || null,
      event.eventType,
      event.timestamp,
      event.durationMs || null,
      JSON.stringify(event.data),
      event.data.contractId || null,
      event.data.agentId || null
    );
  }

  /** Retrieve all events for a given trace, ordered by timestamp. */
  getTrace(traceId: string): TraceEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM trace_events WHERE trace_id = ? ORDER BY timestamp ASC')
      .all(traceId) as TraceRow[];
    return rows.map(this.rowToEvent);
  }

  /** Query trace events using a flexible filter. */
  query(filter: TraceFilter): TraceEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.traceId) {
      conditions.push('trace_id = ?');
      params.push(filter.traceId);
    }
    if (filter.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter.contractId) {
      conditions.push('contract_id = ?');
      params.push(filter.contractId);
    }
    if (filter.eventType) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.startTime) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }

    let sql = 'SELECT * FROM trace_events';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY timestamp ASC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as TraceRow[];
    return rows.map(this.rowToEvent);
  }

  /** Get a summary of recent traces with event counts. */
  getRecentTraces(limit = 50): Array<{ traceId: string; eventCount: number; startTime: string }> {
    const rows = this.db
      .prepare(
        `SELECT trace_id, COUNT(*) as event_count, MIN(timestamp) as start_time
         FROM trace_events
         GROUP BY trace_id
         ORDER BY start_time DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ trace_id: string; event_count: number; start_time: string }>;

    return rows.map((r) => ({
      traceId: r.trace_id,
      eventCount: r.event_count,
      startTime: r.start_time,
    }));
  }

  /** Close the underlying SQLite database connection. */
  close(): void {
    this.db.close();
  }

  private rowToEvent(row: TraceRow): TraceEvent {
    return {
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id || undefined,
      eventType: row.event_type as TraceEvent['eventType'],
      timestamp: row.timestamp,
      durationMs: row.duration_ms || undefined,
      data: JSON.parse(row.data),
    };
  }
}

interface TraceRow {
  id: number;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  event_type: string;
  timestamp: string;
  duration_ms: number | null;
  data: string;
  contract_id: string | null;
  agent_id: string | null;
}
