import Database from 'better-sqlite3';

/** Resource quotas enforced within a namespace. */
export interface NamespaceQuotas {
  maxAgents: number;
  maxContractsPerHour: number;
  maxTokensPerDay: number;
  maxCostPerDay: number;
}

/** Default quotas applied to new namespaces. */
export const DEFAULT_NAMESPACE_QUOTAS: NamespaceQuotas = {
  maxAgents: 100,
  maxContractsPerHour: 1000,
  maxTokensPerDay: 1_000_000,
  maxCostPerDay: 100,
};

/** A namespace within an organization, providing isolation and quota boundaries. */
export interface Namespace {
  namespaceId: string; // e.g. "acme-corp/engineering"
  orgId: string;
  name: string;
  parentNamespace?: string;
  quotas: NamespaceQuotas;
  metadata: Record<string, unknown>;
}

interface NamespaceRow {
  namespace_id: string;
  org_id: string;
  name: string;
  parent_namespace: string | null;
  quotas: string;
  metadata: string;
}

/** SQLite-backed registry of namespaces within organizations. */
export class NamespaceRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS namespaces (
        namespace_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_namespace TEXT,
        quotas TEXT NOT NULL DEFAULT '{}',
        metadata TEXT DEFAULT '{}',
        UNIQUE(org_id, name)
      );
    `);
  }

  /** Create a new namespace. ID must be in "orgId/teamName" format. */
  createNamespace(ns: Namespace): void {
    const existing = this.getNamespace(ns.namespaceId);
    if (existing) {
      throw new Error(`Namespace ${ns.namespaceId} already exists`);
    }
    // Validate namespaceId format: "orgId/teamName"
    if (!ns.namespaceId.includes('/')) {
      throw new Error(`Namespace ID must be in format "orgId/teamName", got "${ns.namespaceId}"`);
    }
    const stmt = this.db.prepare(`
      INSERT INTO namespaces (namespace_id, org_id, name, parent_namespace, quotas, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      ns.namespaceId,
      ns.orgId,
      ns.name,
      ns.parentNamespace || null,
      JSON.stringify(ns.quotas),
      JSON.stringify(ns.metadata)
    );
  }

  /** Retrieve a namespace by ID. */
  getNamespace(namespaceId: string): Namespace | undefined {
    const row = this.db
      .prepare('SELECT * FROM namespaces WHERE namespace_id = ?')
      .get(namespaceId) as NamespaceRow | undefined;
    if (!row) return undefined;
    return this.rowToNamespace(row);
  }

  /** List all namespaces for an organization. */
  listNamespaces(orgId: string): Namespace[] {
    const rows = this.db
      .prepare('SELECT * FROM namespaces WHERE org_id = ? ORDER BY namespace_id ASC')
      .all(orgId) as NamespaceRow[];
    return rows.map(this.rowToNamespace);
  }

  /** Partially update the quotas for a namespace. */
  updateQuotas(namespaceId: string, quotas: Partial<NamespaceQuotas>): Namespace | undefined {
    const existing = this.getNamespace(namespaceId);
    if (!existing) return undefined;

    const merged: NamespaceQuotas = {
      ...existing.quotas,
      ...quotas,
    };

    this.db
      .prepare(
        `
      UPDATE namespaces SET quotas = ? WHERE namespace_id = ?
    `
      )
      .run(JSON.stringify(merged), namespaceId);

    return this.getNamespace(namespaceId);
  }

  private rowToNamespace(row: NamespaceRow): Namespace {
    return {
      namespaceId: row.namespace_id,
      orgId: row.org_id,
      name: row.name,
      parentNamespace: row.parent_namespace || undefined,
      quotas: JSON.parse(row.quotas),
      metadata: JSON.parse(row.metadata),
    };
  }
}
