import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  CatalogRegistry,
  ServiceListing,
  ServiceCategory,
  ServicePricing,
  ServiceSLA,
} from '../src/exchange/catalog.js';

function makePricing(overrides: Partial<ServicePricing> = {}): ServicePricing {
  return {
    model: 'per_request',
    currency: 'credits',
    perRequestCost: 10,
    ...overrides,
  };
}

function makeSLA(overrides: Partial<ServiceSLA> = {}): ServiceSLA {
  return {
    maxLatencyMs: 5000,
    availabilityPct: 99.5,
    maxConcurrent: 10,
    supportTier: 'standard',
    ...overrides,
  };
}

function makeListing(overrides: Partial<ServiceListing> = {}): ServiceListing {
  return {
    listingId: `listing-${Math.random().toString(36).slice(2, 8)}`,
    orgId: 'acme',
    name: 'Acme Research Agent',
    description: 'A deep research agent for complex queries',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research', 'summarization'],
    contractIds: ['contract-1'],
    pricing: makePricing(),
    sla: makeSLA(),
    tags: ['research', 'ai', 'deep-learning'],
    status: 'draft',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
    ...overrides,
  };
}

describe('CatalogRegistry', () => {
  let db: Database.Database;
  let catalog: CatalogRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    catalog = new CatalogRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Publish & Retrieve ---

  it('should publish a listing and retrieve it', () => {
    const listing = makeListing({ listingId: 'listing-1' });
    const published = catalog.publish(listing);

    expect(published.listingId).toBe('listing-1');
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBeDefined();

    const retrieved = catalog.get('listing-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Acme Research Agent');
    expect(retrieved!.status).toBe('published');
  });

  it('should auto-generate listingId if not provided', () => {
    const listing = makeListing({ listingId: '' });
    // Override to empty so publish generates one
    const published = catalog.publish({ ...listing, listingId: '' });
    expect(published.listingId).toBeTruthy();
    expect(published.listingId.length).toBeGreaterThan(0);
  });

  it('should preserve all fields on publish', () => {
    const listing = makeListing({
      listingId: 'listing-full',
      orgId: 'org-1',
      name: 'Full Listing',
      description: 'Detailed description here',
      category: ServiceCategory.CODE,
      capabilities: ['code-gen', 'review'],
      contractIds: ['c-1', 'c-2'],
      pricing: makePricing({ model: 'per_token', inputTokenRate: 0.5, outputTokenRate: 1.0 }),
      sla: makeSLA({ supportTier: 'premium' }),
      tags: ['code', 'generator'],
      version: '2.0.0',
      metadata: { custom: true },
    });
    const published = catalog.publish(listing);

    expect(published.orgId).toBe('org-1');
    expect(published.category).toBe(ServiceCategory.CODE);
    expect(published.capabilities).toEqual(['code-gen', 'review']);
    expect(published.contractIds).toEqual(['c-1', 'c-2']);
    expect(published.pricing.model).toBe('per_token');
    expect(published.pricing.inputTokenRate).toBe(0.5);
    expect(published.sla.supportTier).toBe('premium');
    expect(published.tags).toEqual(['code', 'generator']);
    expect(published.version).toBe('2.0.0');
    expect(published.metadata).toEqual({ custom: true });
  });

  it('should return undefined for non-existent listing', () => {
    const result = catalog.get('nonexistent');
    expect(result).toBeUndefined();
  });

  // --- Update ---

  it('should update a listing with partial updates', () => {
    catalog.publish(makeListing({ listingId: 'listing-upd' }));
    const updated = catalog.update('listing-upd', {
      name: 'Updated Name',
      description: 'New desc',
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('New desc');
    // Other fields remain
    expect(updated!.category).toBe(ServiceCategory.RESEARCH);
  });

  it('should return undefined when updating non-existent listing', () => {
    const result = catalog.update('nonexistent', { name: 'Test' });
    expect(result).toBeUndefined();
  });

  it('should update tags and capabilities', () => {
    catalog.publish(makeListing({ listingId: 'listing-tags' }));
    const updated = catalog.update('listing-tags', {
      tags: ['new-tag'],
      capabilities: ['new-cap'],
    });
    expect(updated!.tags).toEqual(['new-tag']);
    expect(updated!.capabilities).toEqual(['new-cap']);
  });

  it('should update pricing model', () => {
    catalog.publish(makeListing({ listingId: 'listing-price' }));
    const updated = catalog.update('listing-price', {
      pricing: makePricing({ model: 'per_token', inputTokenRate: 0.3, outputTokenRate: 0.6 }),
    });
    expect(updated!.pricing.model).toBe('per_token');
    expect(updated!.pricing.inputTokenRate).toBe(0.3);
  });

  it('should update status via update method', () => {
    catalog.publish(makeListing({ listingId: 'listing-status' }));
    const updated = catalog.update('listing-status', { status: 'suspended' });
    expect(updated!.status).toBe('suspended');
  });

  // --- Deprecate ---

  it('should deprecate a listing', () => {
    catalog.publish(makeListing({ listingId: 'listing-dep' }));
    const deprecated = catalog.deprecate('listing-dep');
    expect(deprecated).toBeDefined();
    expect(deprecated!.status).toBe('deprecated');
  });

  it('should return undefined when deprecating non-existent listing', () => {
    const result = catalog.deprecate('nonexistent');
    expect(result).toBeUndefined();
  });

  // --- Get by org ---

  it('should get listings by org', () => {
    catalog.publish(makeListing({ listingId: 'l-1', orgId: 'acme' }));
    catalog.publish(makeListing({ listingId: 'l-2', orgId: 'acme' }));
    catalog.publish(makeListing({ listingId: 'l-3', orgId: 'widget' }));

    const acmeListings = catalog.getByOrg('acme');
    expect(acmeListings).toHaveLength(2);
    const widgetListings = catalog.getByOrg('widget');
    expect(widgetListings).toHaveLength(1);
  });

  it('should return empty array for org with no listings', () => {
    const result = catalog.getByOrg('unknown-org');
    expect(result).toEqual([]);
  });

  // --- Get by capability ---

  it('should find listings by capability', () => {
    catalog.publish(
      makeListing({ listingId: 'cap-1', capabilities: ['research', 'summarization'] })
    );
    catalog.publish(makeListing({ listingId: 'cap-2', capabilities: ['code-gen'] }));
    catalog.publish(makeListing({ listingId: 'cap-3', capabilities: ['research', 'code-gen'] }));

    const research = catalog.getByCapability('research');
    expect(research).toHaveLength(2);

    const codeGen = catalog.getByCapability('code-gen');
    expect(codeGen).toHaveLength(2);

    const translation = catalog.getByCapability('translation');
    expect(translation).toHaveLength(0);
  });

  // --- Full-text search ---

  it('should search by keyword in name', () => {
    catalog.publish(
      makeListing({ listingId: 's-1', name: 'Deep Research Agent', description: 'General purpose' })
    );
    catalog.publish(
      makeListing({ listingId: 's-2', name: 'Code Generator', description: 'Generates code' })
    );

    const results = catalog.search('Research');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.listingId === 's-1')).toBe(true);
  });

  it('should search by keyword in description', () => {
    catalog.publish(
      makeListing({
        listingId: 'sd-1',
        name: 'Agent One',
        description: 'Advanced analytics platform',
      })
    );
    catalog.publish(
      makeListing({ listingId: 'sd-2', name: 'Agent Two', description: 'Simple chat bot' })
    );

    const results = catalog.search('analytics');
    expect(results.some((r) => r.listingId === 'sd-1')).toBe(true);
  });

  it('should search by keyword in tags', () => {
    catalog.publish(makeListing({ listingId: 'st-1', tags: ['machine-learning', 'nlp'] }));
    catalog.publish(makeListing({ listingId: 'st-2', tags: ['blockchain', 'crypto'] }));

    const results = catalog.search('machine-learning');
    expect(results.some((r) => r.listingId === 'st-1')).toBe(true);
  });

  it('should return partial matches in search', () => {
    catalog.publish(makeListing({ listingId: 'sp-1', name: 'Deep Research Agent' }));

    // "research" should match "Research" via FTS prefix matching
    const results = catalog.search('research');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // --- Search with filters ---

  it('should search with category filter', () => {
    catalog.publish(
      makeListing({ listingId: 'fc-1', name: 'Research Bot', category: ServiceCategory.RESEARCH })
    );
    catalog.publish(
      makeListing({ listingId: 'fc-2', name: 'Research Code Tool', category: ServiceCategory.CODE })
    );

    const results = catalog.search('Research', { category: ServiceCategory.RESEARCH });
    expect(results.every((r) => r.category === ServiceCategory.RESEARCH)).toBe(true);
    expect(results.some((r) => r.listingId === 'fc-1')).toBe(true);
  });

  it('should search with pricing model filter', () => {
    catalog.publish(
      makeListing({ listingId: 'fp-1', pricing: makePricing({ model: 'per_request' }) })
    );
    catalog.publish(
      makeListing({ listingId: 'fp-2', pricing: makePricing({ model: 'per_token' }) })
    );
    catalog.publish(makeListing({ listingId: 'fp-3', pricing: makePricing({ model: 'free' }) }));

    const results = catalog.search('', { pricingModel: 'free' });
    expect(results.some((r) => r.listingId === 'fp-3')).toBe(true);
    expect(results.every((r) => r.pricing.model === 'free')).toBe(true);
  });

  it('should search with org filter', () => {
    catalog.publish(makeListing({ listingId: 'fo-1', orgId: 'acme' }));
    catalog.publish(makeListing({ listingId: 'fo-2', orgId: 'widget' }));

    const results = catalog.search('', { orgId: 'acme' });
    expect(results.every((r) => r.orgId === 'acme')).toBe(true);
  });

  it('should search with status filter', () => {
    catalog.publish(makeListing({ listingId: 'fs-1' }));
    catalog.publish(makeListing({ listingId: 'fs-2' }));
    catalog.deprecate('fs-2');

    const deprecated = catalog.search('', { status: 'deprecated' });
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0].listingId).toBe('fs-2');
  });

  it('should return empty for no matches in search', () => {
    catalog.publish(makeListing({ listingId: 'nm-1' }));
    const results = catalog.search('zzz_nonexistent_term_xyz');
    expect(results).toHaveLength(0);
  });

  // --- Categories ---

  it('should get categories with counts', () => {
    catalog.publish(makeListing({ listingId: 'cat-1', category: ServiceCategory.RESEARCH }));
    catalog.publish(makeListing({ listingId: 'cat-2', category: ServiceCategory.RESEARCH }));
    catalog.publish(makeListing({ listingId: 'cat-3', category: ServiceCategory.CODE }));
    catalog.publish(makeListing({ listingId: 'cat-4', category: ServiceCategory.DATA }));

    const categories = catalog.getCategories();
    expect(categories.length).toBeGreaterThanOrEqual(3);

    const research = categories.find((c) => c.category === 'research');
    expect(research).toBeDefined();
    expect(research!.count).toBe(2);

    const code = categories.find((c) => c.category === 'code');
    expect(code!.count).toBe(1);
  });

  it('should not count deprecated listings in categories', () => {
    catalog.publish(makeListing({ listingId: 'catd-1', category: ServiceCategory.RESEARCH }));
    catalog.publish(makeListing({ listingId: 'catd-2', category: ServiceCategory.RESEARCH }));
    catalog.deprecate('catd-2');

    const categories = catalog.getCategories();
    const research = categories.find((c) => c.category === 'research');
    expect(research!.count).toBe(1);
  });

  // --- Usage count ---

  it('should increment usage count', () => {
    catalog.publish(makeListing({ listingId: 'uc-1' }));

    catalog.incrementUsage('uc-1');
    catalog.incrementUsage('uc-1');
    catalog.incrementUsage('uc-1');

    const listing = catalog.get('uc-1');
    expect(listing!.usageCount).toBe(3);
  });

  // --- Rating ---

  it('should update rating', () => {
    catalog.publish(makeListing({ listingId: 'rt-1' }));

    catalog.updateRating('rt-1', 4.5, 10);
    const listing = catalog.get('rt-1');
    expect(listing!.ratingAvg).toBe(4.5);
    expect(listing!.ratingCount).toBe(10);
  });

  it('should update rating multiple times', () => {
    catalog.publish(makeListing({ listingId: 'rt-2' }));

    catalog.updateRating('rt-2', 3.0, 5);
    catalog.updateRating('rt-2', 4.2, 15);

    const listing = catalog.get('rt-2');
    expect(listing!.ratingAvg).toBe(4.2);
    expect(listing!.ratingCount).toBe(15);
  });

  // --- Status transitions ---

  it('should support draft → published → deprecated lifecycle', () => {
    // publish sets status to published
    const published = catalog.publish(makeListing({ listingId: 'lc-1', status: 'draft' }));
    expect(published.status).toBe('published');

    const deprecated = catalog.deprecate('lc-1');
    expect(deprecated!.status).toBe('deprecated');
  });

  it('should support published → suspended → published', () => {
    catalog.publish(makeListing({ listingId: 'lc-2' }));
    catalog.update('lc-2', { status: 'suspended' });
    const suspended = catalog.get('lc-2');
    expect(suspended!.status).toBe('suspended');

    catalog.update('lc-2', { status: 'published' });
    const republished = catalog.get('lc-2');
    expect(republished!.status).toBe('published');
  });

  // --- Multiple orgs ---

  it('should handle multiple orgs publishing services', () => {
    catalog.publish(makeListing({ listingId: 'mo-1', orgId: 'acme', name: 'Acme Agent' }));
    catalog.publish(makeListing({ listingId: 'mo-2', orgId: 'widget', name: 'Widget Agent' }));
    catalog.publish(makeListing({ listingId: 'mo-3', orgId: 'acme', name: 'Acme Bot' }));

    const acme = catalog.getByOrg('acme');
    expect(acme).toHaveLength(2);

    const widget = catalog.getByOrg('widget');
    expect(widget).toHaveLength(1);

    // Search across all orgs
    const all = catalog.search('Agent');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  // --- Default search only returns published ---

  it('should only return published listings in default search', () => {
    catalog.publish(makeListing({ listingId: 'ds-1' }));
    catalog.publish(makeListing({ listingId: 'ds-2' }));
    catalog.deprecate('ds-2');

    const results = catalog.search('');
    expect(results.every((r) => r.status === 'published')).toBe(true);
  });

  // --- FTS sync on update ---

  it('should find updated listing by new name in search', () => {
    catalog.publish(makeListing({ listingId: 'fts-upd', name: 'Original Name' }));
    catalog.update('fts-upd', { name: 'Quantum Computing Agent' });

    const results = catalog.search('Quantum');
    expect(results.some((r) => r.listingId === 'fts-upd')).toBe(true);
  });

  // --- Version field ---

  it('should preserve and update version field', () => {
    catalog.publish(makeListing({ listingId: 'ver-1', version: '1.0.0' }));
    expect(catalog.get('ver-1')!.version).toBe('1.0.0');

    catalog.update('ver-1', { version: '2.0.0' });
    expect(catalog.get('ver-1')!.version).toBe('2.0.0');
  });

  // --- Metadata field ---

  it('should preserve and update metadata', () => {
    catalog.publish(makeListing({ listingId: 'meta-1', metadata: { region: 'us-east' } }));
    expect(catalog.get('meta-1')!.metadata).toEqual({ region: 'us-east' });

    catalog.update('meta-1', { metadata: { region: 'eu-west', tier: 'premium' } });
    expect(catalog.get('meta-1')!.metadata).toEqual({ region: 'eu-west', tier: 'premium' });
  });
});
