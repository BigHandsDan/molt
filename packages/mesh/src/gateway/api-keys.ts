import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

/** An API key issued to an organization for gateway authentication. */
export interface OrgApiKey {
  keyId: string;
  orgId: string;
  keyHash: string;
  scopes: string[];
  rateLimit: number;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

interface ApiKeyRow {
  key_id: string;
  org_id: string;
  key_hash: string;
  scopes: string;
  rate_limit: number;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

/** SQLite-backed registry for creating, validating, and revoking organization API keys. */
export class ApiKeyRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        scopes TEXT DEFAULT '[]',
        rate_limit INTEGER DEFAULT 60,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `);
  }

  /** Create a new API key for an organization, returning both the raw key and its stored record. */
  createKey(
    orgId: string,
    scopes: string[] = ['submit', 'read'],
    rateLimit = 60,
    expiresAt?: string
  ): { rawKey: string; apiKey: OrgApiKey } {
    const keyId = uuidv4();
    const rawHex = randomBytes(16).toString('hex'); // 32 hex chars
    const rawKey = `mm_${rawHex}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const now = new Date().toISOString();

    const apiKey: OrgApiKey = {
      keyId,
      orgId,
      keyHash,
      scopes,
      rateLimit,
      createdAt: now,
      expiresAt,
    };

    this.db
      .prepare(
        `
      INSERT INTO api_keys (key_id, org_id, key_hash, scopes, rate_limit, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(keyId, orgId, keyHash, JSON.stringify(scopes), rateLimit, now, expiresAt || null);

    return { rawKey, apiKey };
  }

  /** Validate a raw API key, returning the key record if valid and not expired. */
  validateKey(rawKey: string): OrgApiKey | null {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as
      | ApiKeyRow
      | undefined;
    if (!row) return null;

    const apiKey = this.rowToKey(row);

    // Check expiration
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      return null;
    }

    // Update last used
    this.db
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE key_id = ?')
      .run(new Date().toISOString(), apiKey.keyId);

    return apiKey;
  }

  /** Revoke an API key by deleting it from the registry. */
  revokeKey(keyId: string): boolean {
    const result = this.db.prepare('DELETE FROM api_keys WHERE key_id = ?').run(keyId);
    return result.changes > 0;
  }

  /** List all API keys for an organization. */
  listKeys(orgId: string): OrgApiKey[] {
    const rows = this.db
      .prepare('SELECT * FROM api_keys WHERE org_id = ? ORDER BY created_at ASC')
      .all(orgId) as ApiKeyRow[];
    return rows.map(this.rowToKey);
  }

  /** Retrieve an API key record by its ID. */
  getKey(keyId: string): OrgApiKey | undefined {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key_id = ?').get(keyId) as
      | ApiKeyRow
      | undefined;
    if (!row) return undefined;
    return this.rowToKey(row);
  }

  private rowToKey(row: ApiKeyRow): OrgApiKey {
    return {
      keyId: row.key_id,
      orgId: row.org_id,
      keyHash: row.key_hash,
      scopes: JSON.parse(row.scopes),
      rateLimit: row.rate_limit,
      createdAt: row.created_at,
      expiresAt: row.expires_at || undefined,
      lastUsedAt: row.last_used_at || undefined,
    };
  }
}
