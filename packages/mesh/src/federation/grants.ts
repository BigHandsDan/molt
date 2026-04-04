import Database from 'better-sqlite3';

/** Conditions attached to a federation grant controlling how it may be used. */
export interface GrantConditions {
  requireApproval: boolean;
  allowedTools: string[];
  blockedTools: string[];
  timeWindow?: {
    start: string; // "09:00" UTC
    end: string; // "17:00" UTC
    daysOfWeek: number[]; // 0=Sun..6=Sat
  };
  maxConcurrent: number;
}

/** Lifecycle status of a federation grant. */
export type GrantStatus = 'active' | 'suspended' | 'expired';

/** A grant of access from one organization to another for specific contracts or capabilities. */
export interface FederationGrant {
  grantId: string;
  fromOrgId: string;
  toOrgId: string;
  contractIds: string[];
  capabilities: string[];
  maxTokensPerDay: number;
  maxCostPerDay: number;
  expiresAt?: string;
  conditions: GrantConditions;
  status: GrantStatus;
  createdAt: string;
}

interface GrantRow {
  grant_id: string;
  from_org_id: string;
  to_org_id: string;
  contract_ids: string;
  capabilities: string;
  max_tokens_per_day: number;
  max_cost_per_day: number;
  expires_at: string | null;
  conditions: string;
  status: string;
  created_at: string;
}

/** SQLite-backed registry of federation grants between organizations. */
export class GrantRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS federation_grants (
        grant_id TEXT PRIMARY KEY,
        from_org_id TEXT NOT NULL,
        to_org_id TEXT NOT NULL,
        contract_ids TEXT DEFAULT '[]',
        capabilities TEXT DEFAULT '[]',
        max_tokens_per_day INTEGER DEFAULT 100000,
        max_cost_per_day REAL DEFAULT 10.0,
        expires_at TEXT,
        conditions TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_grant_from_org ON federation_grants(from_org_id);
      CREATE INDEX IF NOT EXISTS idx_grant_to_org ON federation_grants(to_org_id);
      CREATE INDEX IF NOT EXISTS idx_grant_status ON federation_grants(status);
    `);
  }

  /** Create a new federation grant. Throws if the grant ID already exists. */
  createGrant(grant: FederationGrant): void {
    const existing = this.getGrant(grant.grantId);
    if (existing) {
      throw new Error(`Grant ${grant.grantId} already exists`);
    }
    const stmt = this.db.prepare(`
      INSERT INTO federation_grants (grant_id, from_org_id, to_org_id, contract_ids, capabilities,
        max_tokens_per_day, max_cost_per_day, expires_at, conditions, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      grant.grantId,
      grant.fromOrgId,
      grant.toOrgId,
      JSON.stringify(grant.contractIds),
      JSON.stringify(grant.capabilities),
      grant.maxTokensPerDay,
      grant.maxCostPerDay,
      grant.expiresAt || null,
      JSON.stringify(grant.conditions),
      grant.status,
      grant.createdAt
    );
  }

  /** Retrieve a grant by ID. */
  getGrant(grantId: string): FederationGrant | undefined {
    const row = this.db
      .prepare('SELECT * FROM federation_grants WHERE grant_id = ?')
      .get(grantId) as GrantRow | undefined;
    if (!row) return undefined;
    return this.rowToGrant(row);
  }

  /** List all grants involving an organization (as grantor or grantee). */
  listGrants(orgId: string): FederationGrant[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM federation_grants WHERE from_org_id = ? OR to_org_id = ? ORDER BY created_at ASC'
      )
      .all(orgId, orgId) as GrantRow[];
    return rows.map(this.rowToGrant);
  }

  /** Suspend an active grant, temporarily preventing its use. */
  suspendGrant(grantId: string): FederationGrant | undefined {
    const existing = this.getGrant(grantId);
    if (!existing) return undefined;
    this.db
      .prepare(`UPDATE federation_grants SET status = 'suspended' WHERE grant_id = ?`)
      .run(grantId);
    return this.getGrant(grantId);
  }

  /** Permanently revoke and delete a grant. */
  revokeGrant(grantId: string): FederationGrant | undefined {
    const existing = this.getGrant(grantId);
    if (!existing) return undefined;
    this.db.prepare(`DELETE FROM federation_grants WHERE grant_id = ?`).run(grantId);
    return existing;
  }

  /** Check whether a valid active grant exists between two organizations for a given capability. */
  checkGrant(
    fromOrgId: string,
    toOrgId: string,
    capability?: string
  ): { valid: boolean; grantId?: string; reason?: string } {
    // Find an active grant from fromOrgId to toOrgId
    const rows = this.db
      .prepare(
        `SELECT * FROM federation_grants WHERE from_org_id = ? AND to_org_id = ? AND status = 'active'`
      )
      .all(fromOrgId, toOrgId) as GrantRow[];

    if (rows.length === 0) {
      return {
        valid: false,
        reason: 'No active federation grant exists between these organizations',
      };
    }

    for (const row of rows) {
      const grant = this.rowToGrant(row);

      // Check expiration
      if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) {
        // Mark as expired
        this.db
          .prepare(`UPDATE federation_grants SET status = 'expired' WHERE grant_id = ?`)
          .run(grant.grantId);
        continue;
      }

      // Check capability if specified
      if (capability && grant.capabilities.length > 0 && !grant.capabilities.includes(capability)) {
        continue;
      }

      return { valid: true, grantId: grant.grantId };
    }

    return {
      valid: false,
      reason: 'No matching active grant found (expired or capability mismatch)',
    };
  }

  private rowToGrant(row: GrantRow): FederationGrant {
    return {
      grantId: row.grant_id,
      fromOrgId: row.from_org_id,
      toOrgId: row.to_org_id,
      contractIds: JSON.parse(row.contract_ids),
      capabilities: JSON.parse(row.capabilities),
      maxTokensPerDay: row.max_tokens_per_day,
      maxCostPerDay: row.max_cost_per_day,
      expiresAt: row.expires_at || undefined,
      conditions: JSON.parse(row.conditions),
      status: row.status as GrantStatus,
      createdAt: row.created_at,
    };
  }
}
