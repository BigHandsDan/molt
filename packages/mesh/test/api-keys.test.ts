import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { ApiKeyRegistry } from '../src/gateway/api-keys.js';
import { RateLimiter } from '../src/gateway/rate-limiter.js';

describe('ApiKeyRegistry', () => {
  let db: Database.Database;
  let registry: ApiKeyRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new ApiKeyRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a key with mm_ prefix and 32 hex chars', () => {
    const { rawKey, apiKey } = registry.createKey('acme-corp', ['submit', 'read']);
    expect(rawKey).toMatch(/^mm_[a-f0-9]{32}$/);
    expect(apiKey.orgId).toBe('acme-corp');
    expect(apiKey.scopes).toEqual(['submit', 'read']);
    expect(apiKey.keyId).toBeDefined();
  });

  it('should hash the key with SHA-256', () => {
    const { rawKey, apiKey } = registry.createKey('acme-corp');
    const expectedHash = createHash('sha256').update(rawKey).digest('hex');
    expect(apiKey.keyHash).toBe(expectedHash);
  });

  it('should validate a valid raw key', () => {
    const { rawKey } = registry.createKey('acme-corp');
    const validated = registry.validateKey(rawKey);
    expect(validated).not.toBeNull();
    expect(validated!.orgId).toBe('acme-corp');
  });

  it('should return null for an invalid key', () => {
    registry.createKey('acme-corp');
    const validated = registry.validateKey('mm_0000000000000000000000000000dead');
    expect(validated).toBeNull();
  });

  it('should return null for a completely wrong format key', () => {
    const validated = registry.validateKey('not-a-valid-key');
    expect(validated).toBeNull();
  });

  it('should return null for an expired key', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    const { rawKey } = registry.createKey('acme-corp', ['submit'], 60, pastDate);
    const validated = registry.validateKey(rawKey);
    expect(validated).toBeNull();
  });

  it('should validate a non-expired key', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
    const { rawKey } = registry.createKey('acme-corp', ['submit'], 60, futureDate);
    const validated = registry.validateKey(rawKey);
    expect(validated).not.toBeNull();
  });

  it('should revoke a key', () => {
    const { rawKey, apiKey } = registry.createKey('acme-corp');
    expect(registry.revokeKey(apiKey.keyId)).toBe(true);
    const validated = registry.validateKey(rawKey);
    expect(validated).toBeNull();
  });

  it('should return false revoking non-existent key', () => {
    expect(registry.revokeKey('non-existent')).toBe(false);
  });

  it('should list keys for an org', () => {
    registry.createKey('acme-corp');
    registry.createKey('acme-corp');
    registry.createKey('widget-inc');
    const acmeKeys = registry.listKeys('acme-corp');
    expect(acmeKeys).toHaveLength(2);
    const widgetKeys = registry.listKeys('widget-inc');
    expect(widgetKeys).toHaveLength(1);
  });

  it('should update lastUsedAt on validation', () => {
    const { rawKey, apiKey } = registry.createKey('acme-corp');
    expect(apiKey.lastUsedAt).toBeUndefined();
    registry.validateKey(rawKey);
    const key = registry.getKey(apiKey.keyId);
    expect(key!.lastUsedAt).toBeDefined();
  });

  it('should support custom rate limit', () => {
    const { apiKey } = registry.createKey('acme-corp', ['submit'], 120);
    expect(apiKey.rateLimit).toBe(120);
  });

  it('should support custom scopes', () => {
    const { apiKey } = registry.createKey('acme-corp', ['admin']);
    expect(apiKey.scopes).toEqual(['admin']);
  });

  it('should default scopes to submit and read', () => {
    const { apiKey } = registry.createKey('acme-corp');
    expect(apiKey.scopes).toEqual(['submit', 'read']);
  });

  it('should default rate limit to 60', () => {
    const { apiKey } = registry.createKey('acme-corp');
    expect(apiKey.rateLimit).toBe(60);
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('should allow requests within the limit', () => {
    const result = limiter.checkRate('key1', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('should track remaining correctly', () => {
    for (let i = 0; i < 5; i++) {
      limiter.checkRate('key1', 10);
    }
    const result = limiter.checkRate('key1', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should deny after exceeding limit', () => {
    for (let i = 0; i < 10; i++) {
      limiter.checkRate('key1', 10);
    }
    const result = limiter.checkRate('key1', 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track keys independently', () => {
    for (let i = 0; i < 10; i++) {
      limiter.checkRate('key1', 10);
    }
    const result = limiter.checkRate('key2', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('should provide resetAt in the future', () => {
    const result = limiter.checkRate('key1', 10);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should reset a key', () => {
    for (let i = 0; i < 10; i++) {
      limiter.checkRate('key1', 10);
    }
    limiter.reset('key1');
    const result = limiter.checkRate('key1', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });
});
