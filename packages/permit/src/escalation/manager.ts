import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  EscalationPolicy,
  EscalationTrigger,
  EscalationContext,
  EscalationRequest,
  EscalationResolution,
  EscalationRouting,
  EscalationSeverity,
} from './types.js';

export class EscalationManager {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS escalation_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        triggers_json TEXT NOT NULL,
        routing_json TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL,
        timeout_action TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS escalation_requests (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        policy_id TEXT,
        trigger_json TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        claimed_by TEXT,
        resolved_at INTEGER,
        resolution_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_esc_req_agent_id ON escalation_requests(agent_id);
      CREATE INDEX IF NOT EXISTS idx_esc_req_status ON escalation_requests(status);
      CREATE INDEX IF NOT EXISTS idx_esc_req_severity ON escalation_requests(severity);
    `);
  }

  /** Register an escalation policy */
  registerPolicy(policy: EscalationPolicy): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO escalation_policies (id, name, triggers_json, routing_json, timeout_ms, timeout_action)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      policy.id,
      policy.name,
      JSON.stringify(policy.triggers),
      JSON.stringify(policy.routing),
      policy.timeoutMs,
      policy.timeoutAction,
    );
  }

  /** Remove a policy */
  removePolicy(policyId: string): boolean {
    const result = this.db.prepare('DELETE FROM escalation_policies WHERE id = ?').run(policyId);
    return result.changes > 0;
  }

  /** Get all registered policies */
  getPolicies(): EscalationPolicy[] {
    const rows = this.db.prepare('SELECT * FROM escalation_policies').all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToPolicy(row));
  }

  /** Create an escalation request — called when an agent action is denied or flagged */
  escalate(agentId: string, trigger: EscalationTrigger, context: EscalationContext): EscalationRequest {
    const policy = this.matchPolicy(trigger);

    const request: EscalationRequest = {
      id: uuidv4(),
      agentId,
      policyId: policy?.id,
      trigger,
      severity: policy?.routing.severity ?? 'medium',
      status: 'pending',
      context,
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO escalation_requests (
        id, agent_id, policy_id, trigger_json, severity, status, context_json,
        created_at, claimed_at, claimed_by, resolved_at, resolution_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      request.id,
      request.agentId,
      request.policyId ?? null,
      JSON.stringify(request.trigger),
      request.severity,
      request.status,
      JSON.stringify(request.context),
      request.createdAt,
      null,
      null,
      null,
      null,
    );

    // Fire-and-forget delivery if policy matched
    if (policy) {
      this.deliver(request, policy.routing).catch(() => {
        // delivery failures are non-fatal
      });
    }

    return request;
  }

  /** Match triggers against registered policies to determine routing */
  private matchPolicy(trigger: EscalationTrigger): EscalationPolicy | null {
    const policies = this.getPolicies();

    for (const policy of policies) {
      for (const policyTrigger of policy.triggers) {
        if (policyTrigger.type !== trigger.type) continue;

        // Check action pattern match
        if (policyTrigger.actionPattern && trigger.actionPattern) {
          if (!this.globMatch(trigger.actionPattern, policyTrigger.actionPattern)) continue;
        }

        // Check resource pattern match
        if (policyTrigger.resourcePattern && trigger.resourcePattern) {
          if (!this.globMatch(trigger.resourcePattern, policyTrigger.resourcePattern)) continue;
        }

        return policy;
      }
    }

    return null;
  }

  /** Simple glob matching: supports * as wildcard */
  private globMatch(value: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }

  /** Deliver the escalation via the configured channel */
  async deliver(request: EscalationRequest, routing: EscalationRouting): Promise<boolean> {
    switch (routing.channel) {
      case 'webhook': {
        try {
          const response = await fetch(routing.target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              escalationId: request.id,
              agentId: request.agentId,
              severity: request.severity,
              trigger: request.trigger,
              context: request.context,
              assignee: routing.assignee,
            }),
          });
          return response.ok;
        } catch {
          return false;
        }
      }
      case 'callback':
      case 'queue':
        // callback and queue channels are application-level concerns
        return true;
      default:
        return false;
    }
  }

  /** Claim an escalation (human picks it up) */
  claim(escalationId: string, claimedBy: string): EscalationRequest | null {
    const existing = this.getById(escalationId);
    if (!existing || existing.status !== 'pending') return null;

    const now = Date.now();
    this.db.prepare(
      'UPDATE escalation_requests SET status = ?, claimed_at = ?, claimed_by = ? WHERE id = ?',
    ).run('claimed', now, claimedBy, escalationId);

    return {
      ...existing,
      status: 'claimed',
      claimedAt: now,
      claimedBy,
    };
  }

  /** Resolve an escalation */
  resolve(escalationId: string, resolution: EscalationResolution): EscalationRequest | null {
    const existing = this.getById(escalationId);
    if (!existing || (existing.status !== 'pending' && existing.status !== 'claimed')) return null;

    const now = Date.now();
    this.db.prepare(
      'UPDATE escalation_requests SET status = ?, resolved_at = ?, resolution_json = ? WHERE id = ?',
    ).run('resolved', now, JSON.stringify(resolution), escalationId);

    return {
      ...existing,
      status: 'resolved',
      resolvedAt: now,
      resolution,
    };
  }

  /** Get pending escalations */
  getPending(severity?: EscalationSeverity): EscalationRequest[] {
    if (severity) {
      const rows = this.db.prepare(
        'SELECT * FROM escalation_requests WHERE status = ? AND severity = ? ORDER BY created_at DESC',
      ).all('pending', severity) as Record<string, unknown>[];
      return rows.map((row) => this.rowToRequest(row));
    }

    const rows = this.db.prepare(
      'SELECT * FROM escalation_requests WHERE status = ? ORDER BY created_at DESC',
    ).all('pending') as Record<string, unknown>[];
    return rows.map((row) => this.rowToRequest(row));
  }

  /** Get escalation by ID */
  getById(id: string): EscalationRequest | null {
    const row = this.db.prepare('SELECT * FROM escalation_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRequest(row) : null;
  }

  /** Check for expired escalations and apply timeout actions */
  processTimeouts(): EscalationRequest[] {
    const now = Date.now();
    const pendingRows = this.db.prepare(
      'SELECT * FROM escalation_requests WHERE status = ? OR status = ?',
    ).all('pending', 'claimed') as Record<string, unknown>[];

    const expired: EscalationRequest[] = [];

    for (const row of pendingRows) {
      const request = this.rowToRequest(row);

      // Find the matching policy to check timeoutMs
      let timeoutMs = 300000; // default 5 min
      let timeoutAction: EscalationPolicy['timeoutAction'] = 'deny';

      if (request.policyId) {
        const policyRow = this.db.prepare('SELECT * FROM escalation_policies WHERE id = ?').get(request.policyId) as Record<string, unknown> | undefined;
        if (policyRow) {
          const policy = this.rowToPolicy(policyRow);
          timeoutMs = policy.timeoutMs;
          timeoutAction = policy.timeoutAction;
        }
      }

      if (now - request.createdAt >= timeoutMs) {
        let newStatus: EscalationRequest['status'] = 'expired';

        if (timeoutAction === 'allow-with-warning') {
          newStatus = 'auto-resolved';
          const autoResolution: EscalationResolution = {
            decision: 'approve',
            reason: 'Auto-resolved: timeout with allow-with-warning policy',
            resolvedBy: 'system',
          };
          this.db.prepare(
            'UPDATE escalation_requests SET status = ?, resolved_at = ?, resolution_json = ? WHERE id = ?',
          ).run(newStatus, now, JSON.stringify(autoResolution), request.id);

          expired.push({
            ...request,
            status: newStatus,
            resolvedAt: now,
            resolution: autoResolution,
          });
        } else if (timeoutAction === 're-escalate') {
          // Create a new escalation with higher severity
          const severityOrder: EscalationSeverity[] = ['low', 'medium', 'high', 'critical'];
          const currentIdx = severityOrder.indexOf(request.severity);
          const newSeverity = severityOrder[Math.min(currentIdx + 1, severityOrder.length - 1)];

          // Mark original as expired
          this.db.prepare('UPDATE escalation_requests SET status = ? WHERE id = ?').run('expired', request.id);

          // Create re-escalation
          const reEscalated = this.escalate(request.agentId, request.trigger, {
            ...request.context,
            reason: `Re-escalated from ${request.id}: ${request.context.reason}`,
          });

          // Update severity on the new request
          this.db.prepare('UPDATE escalation_requests SET severity = ? WHERE id = ?').run(newSeverity, reEscalated.id);
          reEscalated.severity = newSeverity;

          expired.push({ ...request, status: 'expired' });
        } else {
          // 'deny' — just expire
          this.db.prepare('UPDATE escalation_requests SET status = ? WHERE id = ?').run('expired', request.id);
          expired.push({ ...request, status: 'expired' });
        }
      }
    }

    return expired;
  }

  /** Get escalation history for an agent */
  getAgentHistory(agentId: string, limit: number = 100): EscalationRequest[] {
    const rows = this.db.prepare(
      'SELECT * FROM escalation_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(agentId, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToRequest(row));
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  /** Get the underlying database instance (for shared DB use) */
  getDatabase(): Database.Database {
    return this.db;
  }

  private rowToPolicy(row: Record<string, unknown>): EscalationPolicy {
    return {
      id: row.id as string,
      name: row.name as string,
      triggers: JSON.parse(row.triggers_json as string),
      routing: JSON.parse(row.routing_json as string),
      timeoutMs: row.timeout_ms as number,
      timeoutAction: row.timeout_action as EscalationPolicy['timeoutAction'],
    };
  }

  private rowToRequest(row: Record<string, unknown>): EscalationRequest {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      policyId: (row.policy_id as string) || undefined,
      trigger: JSON.parse(row.trigger_json as string),
      severity: row.severity as EscalationRequest['severity'],
      status: row.status as EscalationRequest['status'],
      context: JSON.parse(row.context_json as string),
      createdAt: row.created_at as number,
      claimedAt: (row.claimed_at as number) || undefined,
      claimedBy: (row.claimed_by as string) || undefined,
      resolvedAt: (row.resolved_at as number) || undefined,
      resolution: row.resolution_json ? JSON.parse(row.resolution_json as string) : undefined,
    };
  }
}
