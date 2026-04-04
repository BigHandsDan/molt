import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

/** Categories for classifying services in the exchange catalog. */
export enum ServiceCategory {
  /** Research and investigation services. */
  RESEARCH = 'research',
  /** Data analysis and insight services. */
  ANALYSIS = 'analysis',
  /** Code generation and review services. */
  CODE = 'code',
  /** Writing and content creation services. */
  WRITING = 'writing',
  /** Data processing and transformation services. */
  DATA = 'data',
  /** Regulatory compliance and audit services. */
  COMPLIANCE = 'compliance',
  /** Custom uncategorized services. */
  CUSTOM = 'custom',
}

/** Pricing model and rates for a service listing. */
export interface ServicePricing {
  model: 'per_request' | 'per_token' | 'subscription' | 'free';
  currency: 'credits';
  perRequestCost?: number;
  inputTokenRate?: number;
  outputTokenRate?: number;
  subscriptionRate?: number;
  freeQuota?: number;
}

/** Service level agreement defining performance and availability guarantees. */
export interface ServiceSLA {
  maxLatencyMs: number;
  availabilityPct: number;
  maxConcurrent: number;
  supportTier: 'community' | 'standard' | 'premium';
}

/** Lifecycle status of a service listing. */
export type ServiceStatus = 'draft' | 'published' | 'suspended' | 'deprecated';

/** A published service in the exchange catalog. */
export interface ServiceListing {
  listingId: string;
  orgId: string;
  name: string;
  description: string;
  category: ServiceCategory;
  capabilities: string[];
  contractIds: string[];
  pricing: ServicePricing;
  sla: ServiceSLA;
  tags: string[];
  status: ServiceStatus;
  version: string;
  publishedAt?: string;
  metadata: Record<string, unknown>;
  ratingAvg: number;
  ratingCount: number;
  usageCount: number;
}

/** Filters for narrowing catalog search results. */
export interface CatalogSearchFilters {
  category?: ServiceCategory;
  pricingModel?: string;
  orgId?: string;
  status?: ServiceStatus;
}

/** Sort order for catalog search results. */
export interface CatalogSearchSort {
  by: 'relevance' | 'newest' | 'usage';
}

interface ListingRow {
  listing_id: string;
  org_id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string;
  contract_ids: string;
  pricing: string;
  sla: string;
  tags: string;
  status: string;
  version: string;
  published_at: string | null;
  metadata: string;
  rating_avg: number;
  rating_count: number;
  usage_count: number;
}

/**
 * SQLite-backed service catalog with full-text search for discovering and managing
 * published services in the exchange.
 *
 * @example
 * ```ts
 * const catalog = new CatalogRegistry(db);
 * const listing = catalog.publish({ orgId: 'acme', name: 'Code Review', ... });
 * const results = catalog.search('code review', { category: ServiceCategory.CODE });
 * ```
 */
export class CatalogRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS service_listings (
        listing_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        capabilities TEXT DEFAULT '[]',
        contract_ids TEXT DEFAULT '[]',
        pricing TEXT NOT NULL DEFAULT '{}',
        sla TEXT DEFAULT '{}',
        tags TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        version TEXT NOT NULL DEFAULT '1.0.0',
        published_at TEXT,
        metadata TEXT DEFAULT '{}',
        rating_avg REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_listing_org ON service_listings(org_id);
      CREATE INDEX IF NOT EXISTS idx_listing_status ON service_listings(status);
      CREATE INDEX IF NOT EXISTS idx_listing_category ON service_listings(category);
    `);

    // Create FTS5 virtual table for full-text search
    // Use try/catch since CREATE VIRTUAL TABLE doesn't support IF NOT EXISTS in all versions
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE service_listings_fts USING fts5(
          listing_id,
          name,
          description,
          tags,
          content='service_listings',
          content_rowid='rowid'
        );
      `);
    } catch {
      // Table already exists
    }
  }

  /** Publish a new service listing to the catalog. */
  publish(listing: ServiceListing): ServiceListing {
    const now = new Date().toISOString();
    const listingId = listing.listingId || uuidv4();
    const published: ServiceListing = {
      ...listing,
      listingId,
      status: 'published',
      publishedAt: now,
      ratingAvg: listing.ratingAvg ?? 0,
      ratingCount: listing.ratingCount ?? 0,
      usageCount: listing.usageCount ?? 0,
    };

    const stmt = this.db.prepare(`
      INSERT INTO service_listings (listing_id, org_id, name, description, category,
        capabilities, contract_ids, pricing, sla, tags, status, version, published_at,
        metadata, rating_avg, rating_count, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      published.listingId,
      published.orgId,
      published.name,
      published.description,
      published.category,
      JSON.stringify(published.capabilities),
      JSON.stringify(published.contractIds),
      JSON.stringify(published.pricing),
      JSON.stringify(published.sla),
      JSON.stringify(published.tags),
      published.status,
      published.version,
      published.publishedAt,
      JSON.stringify(published.metadata),
      published.ratingAvg,
      published.ratingCount,
      published.usageCount
    );

    // Sync FTS index
    this.syncFtsInsert(published);

    return published;
  }

  /** Update fields on an existing listing. */
  update(listingId: string, updates: Partial<ServiceListing>): ServiceListing | undefined {
    const existing = this.get(listingId);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }
    if (updates.capabilities !== undefined) {
      fields.push('capabilities = ?');
      values.push(JSON.stringify(updates.capabilities));
    }
    if (updates.contractIds !== undefined) {
      fields.push('contract_ids = ?');
      values.push(JSON.stringify(updates.contractIds));
    }
    if (updates.pricing !== undefined) {
      fields.push('pricing = ?');
      values.push(JSON.stringify(updates.pricing));
    }
    if (updates.sla !== undefined) {
      fields.push('sla = ?');
      values.push(JSON.stringify(updates.sla));
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.version !== undefined) {
      fields.push('version = ?');
      values.push(updates.version);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return existing;

    values.push(listingId);
    this.db
      .prepare(`UPDATE service_listings SET ${fields.join(', ')} WHERE listing_id = ?`)
      .run(...values);

    // Re-sync FTS
    const updated = this.get(listingId)!;
    this.syncFtsDelete(listingId);
    this.syncFtsInsert(updated);

    return updated;
  }

  /** Mark a listing as deprecated. */
  deprecate(listingId: string): ServiceListing | undefined {
    const existing = this.get(listingId);
    if (!existing) return undefined;
    this.db
      .prepare(`UPDATE service_listings SET status = 'deprecated' WHERE listing_id = ?`)
      .run(listingId);
    return this.get(listingId);
  }

  /** Retrieve a listing by ID. */
  get(listingId: string): ServiceListing | undefined {
    const row = this.db
      .prepare('SELECT * FROM service_listings WHERE listing_id = ?')
      .get(listingId) as ListingRow | undefined;
    if (!row) return undefined;
    return this.rowToListing(row);
  }

  /** Get all listings for an organization. */
  getByOrg(orgId: string): ServiceListing[] {
    const rows = this.db
      .prepare('SELECT * FROM service_listings WHERE org_id = ? ORDER BY published_at DESC')
      .all(orgId) as ListingRow[];
    return rows.map((r) => this.rowToListing(r));
  }

  /** Find published listings that declare a given capability. */
  getByCapability(capability: string): ServiceListing[] {
    const rows = this.db
      .prepare("SELECT * FROM service_listings WHERE status = 'published'")
      .all() as ListingRow[];
    return rows.map((r) => this.rowToListing(r)).filter((l) => l.capabilities.includes(capability));
  }

  /** Search the catalog using full-text search with optional filters and sorting. */
  search(
    query: string,
    filters?: CatalogSearchFilters,
    sort?: CatalogSearchSort
  ): ServiceListing[] {
    // Use FTS for text search
    let listingIds: string[] | null = null;

    if (query && query.trim()) {
      // Use FTS5 search with prefix matching for partial matches
      const ftsQuery = query
        .trim()
        .split(/\s+/)
        .map((term) => `"${term}"*`)
        .join(' ');
      try {
        const ftsRows = this.db
          .prepare('SELECT listing_id FROM service_listings_fts WHERE service_listings_fts MATCH ?')
          .all(ftsQuery) as { listing_id: string }[];
        listingIds = ftsRows.map((r) => r.listing_id);
      } catch {
        // Fallback to LIKE search if FTS fails
        listingIds = null;
      }
    }

    // Build main query with filters
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (listingIds !== null) {
      if (listingIds.length === 0) return [];
      conditions.push(`listing_id IN (${listingIds.map(() => '?').join(',')})`);
      params.push(...listingIds);
    }

    if (filters?.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters?.pricingModel) {
      conditions.push("json_extract(pricing, '$.model') = ?");
      params.push(filters.pricingModel);
    }
    if (filters?.orgId) {
      conditions.push('org_id = ?');
      params.push(filters.orgId);
    }
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    } else {
      // Default to published
      conditions.push("status = 'published'");
    }

    let orderBy = 'published_at DESC';
    if (sort?.by === 'usage') orderBy = 'usage_count DESC';
    else if (sort?.by === 'newest') orderBy = 'published_at DESC';

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM service_listings ${where} ORDER BY ${orderBy}`;
    const rows = this.db.prepare(sql).all(...params) as ListingRow[];
    return rows.map((r) => this.rowToListing(r));
  }

  /** Get published service counts grouped by category. */
  getCategories(): { category: string; count: number }[] {
    const rows = this.db
      .prepare(
        "SELECT category, COUNT(*) as count FROM service_listings WHERE status = 'published' GROUP BY category ORDER BY count DESC"
      )
      .all() as { category: string; count: number }[];
    return rows;
  }

  /** Increment the usage counter for a listing. */
  incrementUsage(listingId: string): void {
    this.db
      .prepare('UPDATE service_listings SET usage_count = usage_count + 1 WHERE listing_id = ?')
      .run(listingId);
  }

  /** Update the average rating and count for a listing. */
  updateRating(listingId: string, avg: number, count: number): void {
    this.db
      .prepare('UPDATE service_listings SET rating_avg = ?, rating_count = ? WHERE listing_id = ?')
      .run(avg, count, listingId);
  }

  private syncFtsInsert(listing: ServiceListing): void {
    try {
      // Get rowid for the listing
      const row = this.db
        .prepare('SELECT rowid FROM service_listings WHERE listing_id = ?')
        .get(listing.listingId) as { rowid: number } | undefined;
      if (!row) return;

      this.db
        .prepare(
          `
        INSERT INTO service_listings_fts(rowid, listing_id, name, description, tags)
        VALUES (?, ?, ?, ?, ?)
      `
        )
        .run(
          row.rowid,
          listing.listingId,
          listing.name,
          listing.description,
          listing.tags.join(' ')
        );
    } catch {
      // FTS sync is best-effort
    }
  }

  private syncFtsDelete(listingId: string): void {
    try {
      // Get existing data for proper FTS delete
      const row = this.db
        .prepare('SELECT rowid, * FROM service_listings WHERE listing_id = ?')
        .get(listingId) as (ListingRow & { rowid: number }) | undefined;
      if (!row) return;

      this.db
        .prepare(
          `
        INSERT INTO service_listings_fts(service_listings_fts, rowid, listing_id, name, description, tags)
        VALUES ('delete', ?, ?, ?, ?, ?)
      `
        )
        .run(row.rowid, row.listing_id, row.name, row.description, JSON.parse(row.tags).join(' '));
    } catch {
      // FTS sync is best-effort
    }
  }

  private rowToListing(row: ListingRow): ServiceListing {
    return {
      listingId: row.listing_id,
      orgId: row.org_id,
      name: row.name,
      description: row.description || '',
      category: row.category as ServiceCategory,
      capabilities: JSON.parse(row.capabilities),
      contractIds: JSON.parse(row.contract_ids),
      pricing: JSON.parse(row.pricing),
      sla: JSON.parse(row.sla),
      tags: JSON.parse(row.tags),
      status: row.status as ServiceStatus,
      version: row.version,
      publishedAt: row.published_at || undefined,
      metadata: JSON.parse(row.metadata),
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
      usageCount: row.usage_count,
    };
  }
}
