import Database from 'better-sqlite3';

/** Tier classification for organizations within the federation. */
export enum OrgTier {
  /** Platform owner organization. */
  OWNER = 'owner',
  /** Trusted partner organization. */
  PARTNER = 'partner',
  /** Third-party vendor organization. */
  VENDOR = 'vendor',
  /** Public/untrusted organization. */
  PUBLIC = 'public',
}

/** A registered organization in the MoltMesh federation. */
export interface Organization {
  orgId: string;
  name: string;
  tier: OrgTier;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface OrgRow {
  org_id: string;
  name: string;
  tier: string;
  metadata: string;
  created_at: string;
}

/** SQLite-backed registry of federated organizations. */
export class OrgRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        org_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tier TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
  }

  /** Register a new organization. Throws if the org ID already exists. */
  registerOrg(org: Organization): void {
    const existing = this.getOrg(org.orgId);
    if (existing) {
      throw new Error(`Organization ${org.orgId} already exists`);
    }
    const stmt = this.db.prepare(`
      INSERT INTO organizations (org_id, name, tier, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(org.orgId, org.name, org.tier, JSON.stringify(org.metadata), org.createdAt);
  }

  /** Retrieve an organization by ID. */
  getOrg(orgId: string): Organization | undefined {
    const row = this.db.prepare('SELECT * FROM organizations WHERE org_id = ?').get(orgId) as
      | OrgRow
      | undefined;
    if (!row) return undefined;
    return this.rowToOrg(row);
  }

  /** List all registered organizations. */
  listOrgs(): Organization[] {
    const rows = this.db
      .prepare('SELECT * FROM organizations ORDER BY created_at ASC')
      .all() as OrgRow[];
    return rows.map(this.rowToOrg);
  }

  /** Update an organization's name, tier, or metadata. */
  updateOrg(
    orgId: string,
    updates: Partial<Pick<Organization, 'name' | 'tier' | 'metadata'>>
  ): Organization | undefined {
    const existing = this.getOrg(orgId);
    if (!existing) return undefined;

    const name = updates.name ?? existing.name;
    const tier = updates.tier ?? existing.tier;
    const metadata = updates.metadata ?? existing.metadata;

    this.db
      .prepare(
        `
      UPDATE organizations SET name = ?, tier = ?, metadata = ? WHERE org_id = ?
    `
      )
      .run(name, tier, JSON.stringify(metadata), orgId);

    return this.getOrg(orgId);
  }

  private rowToOrg(row: OrgRow): Organization {
    return {
      orgId: row.org_id,
      name: row.name,
      tier: row.tier as OrgTier,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
    };
  }
}
