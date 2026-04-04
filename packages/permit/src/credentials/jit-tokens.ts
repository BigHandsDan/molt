import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface JitTokenOptions {
  agentId: string;
  allowedActions: string[];
  resources?: string[];
  maxValue?: number;
  ttlSeconds: number;
  singleUse: boolean;
}

export interface JitToken {
  token: string;
  agentId: string;
  allowedActions: string[];
  restrictions: {
    resources?: string[];
    maxValue?: number;
    ttlSeconds: number;
    singleUse: boolean;
  };
  issuedAt: string;
  expiresAt: string;
}

export class JitTokenManager {
  private tokens: Map<string, JitToken & { used: boolean }> = new Map();
  private db?: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
      this.initSchema();
    }
  }

  private initSchema(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS jit_tokens (
        token TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        allowed_actions TEXT NOT NULL,
        resources TEXT,
        max_value REAL,
        ttl_seconds INTEGER NOT NULL,
        single_use INTEGER NOT NULL DEFAULT 1,
        used INTEGER NOT NULL DEFAULT 0,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jit_agent_id ON jit_tokens(agent_id);
      CREATE INDEX IF NOT EXISTS idx_jit_expires_at ON jit_tokens(expires_at);
    `);
  }

  mint(options: JitTokenOptions): JitToken {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1000);
    const token = randomBytes(32).toString('hex');

    const jit: JitToken = {
      token,
      agentId: options.agentId,
      allowedActions: options.allowedActions,
      restrictions: {
        resources: options.resources,
        maxValue: options.maxValue,
        ttlSeconds: options.ttlSeconds,
        singleUse: options.singleUse,
      },
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.tokens.set(token, { ...jit, used: false });

    if (this.db) {
      this.db.prepare(`
        INSERT INTO jit_tokens (token, agent_id, allowed_actions, resources, max_value, ttl_seconds, single_use, used, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        token,
        options.agentId,
        JSON.stringify(options.allowedActions),
        options.resources ? JSON.stringify(options.resources) : null,
        options.maxValue ?? null,
        options.ttlSeconds,
        options.singleUse ? 1 : 0,
        jit.issuedAt,
        jit.expiresAt,
      );
    }

    return jit;
  }

  verify(
    token: string,
    action?: string,
    resource?: string,
  ): { valid: boolean; reason?: string; token?: JitToken } {
    let stored = this.tokens.get(token);

    // Fall back to SQLite if not in memory cache
    if (!stored && this.db) {
      const row = this.db.prepare('SELECT * FROM jit_tokens WHERE token = ?').get(token) as Record<string, unknown> | undefined;
      if (row) {
        stored = this.rowToToken(row);
        this.tokens.set(token, stored);
      }
    }

    if (!stored) {
      return { valid: false, reason: 'Token not found' };
    }

    if (new Date() > new Date(stored.expiresAt)) {
      this.tokens.delete(token);
      if (this.db) {
        this.db.prepare('DELETE FROM jit_tokens WHERE token = ?').run(token);
      }
      return { valid: false, reason: 'Token expired' };
    }

    if (stored.restrictions.singleUse && stored.used) {
      return { valid: false, reason: 'Token already used' };
    }

    if (action && !stored.allowedActions.includes(action)) {
      return {
        valid: false,
        reason: `Action "${action}" not allowed by this token`,
      };
    }

    if (resource && stored.restrictions.resources && !stored.restrictions.resources.includes(resource)) {
      return {
        valid: false,
        reason: `Resource "${resource}" not allowed by this token`,
      };
    }

    // Mark as used if single-use
    if (stored.restrictions.singleUse) {
      stored.used = true;
      if (this.db) {
        this.db.prepare('UPDATE jit_tokens SET used = 1 WHERE token = ?').run(token);
      }
    }

    return { valid: true, token: stored };
  }

  revoke(token: string): boolean {
    const deleted = this.tokens.delete(token);
    if (this.db) {
      this.db.prepare('DELETE FROM jit_tokens WHERE token = ?').run(token);
    }
    return deleted;
  }

  cleanup(): number {
    let removed = 0;
    const now = new Date();
    for (const [key, stored] of this.tokens.entries()) {
      if (new Date(stored.expiresAt) < now) {
        this.tokens.delete(key);
        removed++;
      }
    }
    if (this.db) {
      const result = this.db.prepare('DELETE FROM jit_tokens WHERE expires_at < ?').run(now.toISOString());
      removed = Math.max(removed, result.changes);
    }
    return removed;
  }

  private rowToToken(row: Record<string, unknown>): JitToken & { used: boolean } {
    return {
      token: row.token as string,
      agentId: row.agent_id as string,
      allowedActions: JSON.parse(row.allowed_actions as string),
      restrictions: {
        resources: row.resources ? JSON.parse(row.resources as string) : undefined,
        maxValue: row.max_value as number | undefined,
        ttlSeconds: row.ttl_seconds as number,
        singleUse: row.single_use === 1,
      },
      issuedAt: row.issued_at as string,
      expiresAt: row.expires_at as string,
      used: row.used === 1,
    };
  }
}
