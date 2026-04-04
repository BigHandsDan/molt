import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { OrgRegistry, Organization, OrgTier } from '../src/federation/organization.js';

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    orgId: 'acme-corp',
    name: 'Acme Corporation',
    tier: OrgTier.OWNER,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OrgRegistry', () => {
  let db: Database.Database;
  let registry: OrgRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new OrgRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should register an organization', () => {
    registry.registerOrg(makeOrg());
    const org = registry.getOrg('acme-corp');
    expect(org).toBeDefined();
    expect(org!.name).toBe('Acme Corporation');
    expect(org!.tier).toBe(OrgTier.OWNER);
  });

  it('should reject duplicate org registration', () => {
    registry.registerOrg(makeOrg());
    expect(() => registry.registerOrg(makeOrg())).toThrow('already exists');
  });

  it('should return undefined for unknown orgId', () => {
    const org = registry.getOrg('nonexistent');
    expect(org).toBeUndefined();
  });

  it('should list all organizations', () => {
    registry.registerOrg(makeOrg({ orgId: 'org-1', name: 'Org 1' }));
    registry.registerOrg(makeOrg({ orgId: 'org-2', name: 'Org 2' }));
    registry.registerOrg(makeOrg({ orgId: 'org-3', name: 'Org 3' }));
    const orgs = registry.listOrgs();
    expect(orgs).toHaveLength(3);
  });

  it('should update organization name', () => {
    registry.registerOrg(makeOrg());
    const updated = registry.updateOrg('acme-corp', { name: 'Acme Inc' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Acme Inc');
    expect(updated!.tier).toBe(OrgTier.OWNER); // unchanged
  });

  it('should update organization tier', () => {
    registry.registerOrg(makeOrg());
    const updated = registry.updateOrg('acme-corp', { tier: OrgTier.PARTNER });
    expect(updated).toBeDefined();
    expect(updated!.tier).toBe(OrgTier.PARTNER);
  });

  it('should update organization metadata', () => {
    registry.registerOrg(makeOrg());
    const updated = registry.updateOrg('acme-corp', { metadata: { region: 'us-east' } });
    expect(updated).toBeDefined();
    expect(updated!.metadata).toEqual({ region: 'us-east' });
  });

  it('should return undefined when updating nonexistent org', () => {
    const updated = registry.updateOrg('nonexistent', { name: 'New' });
    expect(updated).toBeUndefined();
  });

  it('should store and retrieve metadata correctly', () => {
    registry.registerOrg(makeOrg({ metadata: { billing: 'enterprise', seats: 50 } }));
    const org = registry.getOrg('acme-corp');
    expect(org!.metadata).toEqual({ billing: 'enterprise', seats: 50 });
  });

  it('should support all org tiers', () => {
    const tiers = [OrgTier.OWNER, OrgTier.PARTNER, OrgTier.VENDOR, OrgTier.PUBLIC];
    tiers.forEach((tier, i) => {
      registry.registerOrg(makeOrg({ orgId: `org-${i}`, tier }));
      const org = registry.getOrg(`org-${i}`);
      expect(org!.tier).toBe(tier);
    });
  });

  it('should preserve createdAt timestamp', () => {
    const timestamp = '2025-01-15T10:30:00.000Z';
    registry.registerOrg(makeOrg({ createdAt: timestamp }));
    const org = registry.getOrg('acme-corp');
    expect(org!.createdAt).toBe(timestamp);
  });
});
