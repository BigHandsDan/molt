import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
  AgentCapability,
  CapabilityPerformance,
  CapabilityQuery,
  CapabilityStatus,
} from './types.js';

/** Row shape returned from the capabilities table. */
interface CapabilityRow {
  id: string;
  agent_id: string;
  contract_ids: string;
  description: string;
  input_schema: string | null;
  output_schema: string | null;
  status: CapabilityStatus;
  avg_latency_ms: number | null;
  success_rate: number | null;
  cost_per_call: number | null;
  registered_at: number;
  last_seen_at: number;
  ttl_ms: number;
}

/**
 * SQLite-backed registry for agent capabilities.
 *
 * Allows agents to advertise what they can do (mapped to contract IDs),
 * supports discovery queries with performance-based ranking, heartbeat
 * keep-alive, and automatic TTL-based expiration.
 */
export class CapabilityRegistry {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capabilities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        contract_ids TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema TEXT,
        output_schema TEXT,
        status TEXT NOT NULL DEFAULT 'available',
        avg_latency_ms REAL,
        success_rate REAL,
        cost_per_call REAL,
        registered_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cap_agent_id ON capabilities(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cap_status ON capabilities(status);
    `);
  }

  /** Register or update an agent's capability. Returns the full capability record. */
  register(
    capability: Omit<AgentCapability, 'id' | 'registeredAt' | 'lastSeenAt'>
  ): AgentCapability {
    const now = Date.now();
    const id = crypto.randomUUID();
    const perf = capability.performance;

    this.db
      .prepare(
        `INSERT INTO capabilities
          (id, agent_id, contract_ids, description, input_schema, output_schema, status, avg_latency_ms, success_rate, cost_per_call, registered_at, last_seen_at, ttl_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        capability.agentId,
        JSON.stringify(capability.contractIds),
        capability.description,
        capability.inputSchema ? JSON.stringify(capability.inputSchema) : null,
        capability.outputSchema ? JSON.stringify(capability.outputSchema) : null,
        capability.status,
        perf?.avgLatencyMs ?? null,
        perf?.successRate ?? null,
        perf?.costPerCall ?? null,
        now,
        now,
        capability.ttlMs
      );

    return { ...capability, id, registeredAt: now, lastSeenAt: now };
  }

  /** Send a heartbeat to keep a capability alive. Returns true if the capability exists. */
  heartbeat(capabilityId: string): boolean {
    const result = this.db
      .prepare('UPDATE capabilities SET last_seen_at = ? WHERE id = ?')
      .run(Date.now(), capabilityId);
    return result.changes > 0;
  }

  /** Update capability status. Returns true if the capability exists. */
  updateStatus(capabilityId: string, status: CapabilityStatus): boolean {
    const result = this.db
      .prepare('UPDATE capabilities SET status = ?, last_seen_at = ? WHERE id = ?')
      .run(status, Date.now(), capabilityId);
    return result.changes > 0;
  }

  /** Update performance metadata. Returns true if the capability exists. */
  updatePerformance(
    capabilityId: string,
    performance: CapabilityPerformance
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE capabilities
         SET avg_latency_ms = COALESCE(?, avg_latency_ms),
             success_rate = COALESCE(?, success_rate),
             cost_per_call = COALESCE(?, cost_per_call),
             last_seen_at = ?
         WHERE id = ?`
      )
      .run(
        performance.avgLatencyMs ?? null,
        performance.successRate ?? null,
        performance.costPerCall ?? null,
        Date.now(),
        capabilityId
      );
    return result.changes > 0;
  }

  /** Deregister a capability. Returns true if the capability existed. */
  deregister(capabilityId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM capabilities WHERE id = ?')
      .run(capabilityId);
    return result.changes > 0;
  }

  /**
   * Discover capabilities matching a query.
   * Results are sorted by best performance (highest success rate, then lowest latency).
   */
  discover(query: CapabilityQuery): AgentCapability[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.contractId) {
      // Search JSON array for the contract ID
      conditions.push("contract_ids LIKE ?");
      params.push(`%"${query.contractId}"%`);
    }
    if (query.agentId) {
      conditions.push('agent_id = ?');
      params.push(query.agentId);
    }
    if (query.status) {
      conditions.push('status = ?');
      params.push(query.status);
    }
    if (query.minSuccessRate !== undefined) {
      conditions.push('success_rate >= ?');
      params.push(query.minSuccessRate);
    }
    if (query.maxLatencyMs !== undefined) {
      conditions.push('avg_latency_ms <= ?');
      params.push(query.maxLatencyMs);
    }
    if (query.maxCostPerCall !== undefined) {
      conditions.push('cost_per_call <= ?');
      params.push(query.maxCostPerCall);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM capabilities ${where} ORDER BY success_rate DESC, avg_latency_ms ASC`;
    const rows = this.db.prepare(sql).all(...params) as CapabilityRow[];
    return rows.map(this.rowToCapability);
  }

  /**
   * Find the best agent for a contract based on performance data.
   * Ranks by success rate (descending) then latency (ascending).
   * Only considers capabilities with status 'available'.
   */
  findBestAgent(contractId: string): AgentCapability | null {
    const row = this.db
      .prepare(
        `SELECT * FROM capabilities
         WHERE contract_ids LIKE ? AND status = 'available'
         ORDER BY success_rate DESC, avg_latency_ms ASC
         LIMIT 1`
      )
      .get(`%"${contractId}"%`) as CapabilityRow | undefined;
    return row ? this.rowToCapability(row) : null;
  }

  /**
   * Clean up expired capabilities (past TTL with no heartbeat).
   * Returns the number of capabilities removed.
   */
  pruneExpired(): number {
    const now = Date.now();
    const result = this.db
      .prepare('DELETE FROM capabilities WHERE (last_seen_at + ttl_ms) < ?')
      .run(now);
    return result.changes;
  }

  /** Get all capabilities for an agent. */
  getAgentCapabilities(agentId: string): AgentCapability[] {
    const rows = this.db
      .prepare('SELECT * FROM capabilities WHERE agent_id = ? ORDER BY registered_at ASC')
      .all(agentId) as CapabilityRow[];
    return rows.map(this.rowToCapability);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private rowToCapability(row: CapabilityRow): AgentCapability {
    const cap: AgentCapability = {
      id: row.id,
      agentId: row.agent_id,
      contractIds: JSON.parse(row.contract_ids),
      description: row.description,
      status: row.status,
      registeredAt: row.registered_at,
      lastSeenAt: row.last_seen_at,
      ttlMs: row.ttl_ms,
    };

    if (row.input_schema) {
      cap.inputSchema = JSON.parse(row.input_schema);
    }
    if (row.output_schema) {
      cap.outputSchema = JSON.parse(row.output_schema);
    }

    if (
      row.avg_latency_ms !== null ||
      row.success_rate !== null ||
      row.cost_per_call !== null
    ) {
      cap.performance = {};
      if (row.avg_latency_ms !== null) cap.performance.avgLatencyMs = row.avg_latency_ms;
      if (row.success_rate !== null) cap.performance.successRate = row.success_rate;
      if (row.cost_per_call !== null) cap.performance.costPerCall = row.cost_per_call;
    }

    return cap;
  }
}
