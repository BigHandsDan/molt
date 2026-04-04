import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SubscriptionRegistry } from '../src/exchange/subscriptions.js';
import {
  ServiceCategory,
  ServiceListing,
  ServicePricing,
  ServiceSLA,
} from '../src/exchange/catalog.js';
import { MoltMesh } from '../src/bus.js';
import { OrgTier } from '../src/federation/organization.js';

function makePricing(overrides: Partial<ServicePricing> = {}): ServicePricing {
  return {
    model: 'per_request',
    currency: 'credits',
    perRequestCost: 10,
    subscriptionRate: 50,
    freeQuota: 100,
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
    listingId: 'listing-1',
    orgId: 'seller-org',
    name: 'Test Service',
    description: 'A test service',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research'],
    contractIds: ['research-contract'],
    pricing: makePricing(),
    sla: makeSLA(),
    tags: ['test'],
    status: 'published',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
    ...overrides,
  };
}

describe('SubscriptionRegistry', () => {
  let db: Database.Database;
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new SubscriptionRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a subscription with correct fields', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    expect(sub.subscriptionId).toBeTruthy();
    expect(sub.buyerOrgId).toBe('buyer-org');
    expect(sub.listingId).toBe('listing-1');
    expect(sub.sellerOrgId).toBe('seller-org');
    expect(sub.plan).toBe('monthly');
    expect(sub.creditsPerPeriod).toBe(50);
    expect(sub.requestsIncluded).toBe(100);
    expect(sub.overageRate).toBe(1);
    expect(sub.status).toBe('active');
    expect(sub.requestsUsed).toBe(0);
    expect(sub.autoRenew).toBe(true);
  });

  it('should calculate daily period (1 day)', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'daily', 10, 50, 0.5);
    const start = new Date(sub.currentPeriodStart);
    const end = new Date(sub.currentPeriodEnd);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(1);
  });

  it('should calculate weekly period (7 days)', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'weekly', 30, 200, 0.5);
    const start = new Date(sub.currentPeriodStart);
    const end = new Date(sub.currentPeriodEnd);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(7);
  });

  it('should calculate monthly period (30 days)', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 500, 1);
    const start = new Date(sub.currentPeriodStart);
    const end = new Date(sub.currentPeriodEnd);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it('should get subscription by id', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    const fetched = registry.get(sub.subscriptionId);
    expect(fetched).toBeDefined();
    expect(fetched!.subscriptionId).toBe(sub.subscriptionId);
  });

  it('should return undefined for nonexistent subscription', () => {
    const fetched = registry.get('nonexistent');
    expect(fetched).toBeUndefined();
  });

  it('should increment usage counter', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    expect(sub.requestsUsed).toBe(0);

    registry.incrementUsage(sub.subscriptionId);
    registry.incrementUsage(sub.subscriptionId);
    registry.incrementUsage(sub.subscriptionId);

    const updated = registry.get(sub.subscriptionId)!;
    expect(updated.requestsUsed).toBe(3);
  });

  it('should detect overage when usage exceeds included requests', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 2, 1);
    expect(registry.isOverage(sub.subscriptionId)).toBe(false);

    registry.incrementUsage(sub.subscriptionId);
    expect(registry.isOverage(sub.subscriptionId)).toBe(false);

    registry.incrementUsage(sub.subscriptionId);
    expect(registry.isOverage(sub.subscriptionId)).toBe(true);

    registry.incrementUsage(sub.subscriptionId);
    expect(registry.isOverage(sub.subscriptionId)).toBe(true);
  });

  it('should cancel subscription immediately', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    const cancelled = registry.cancel(sub.subscriptionId, true);
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.autoRenew).toBe(false);
  });

  it('should cancel subscription at end-of-period (set autoRenew=false)', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    const cancelled = registry.cancel(sub.subscriptionId, false);
    expect(cancelled!.status).toBe('active'); // Still active until end of period
    expect(cancelled!.autoRenew).toBe(false);
  });

  it('should renew subscription (reset usage and advance period)', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'weekly', 30, 100, 1);
    const originalEnd = sub.currentPeriodEnd;

    // Use some requests
    registry.incrementUsage(sub.subscriptionId);
    registry.incrementUsage(sub.subscriptionId);

    const renewed = registry.renew(sub.subscriptionId)!;
    expect(renewed.requestsUsed).toBe(0);
    expect(renewed.status).toBe('active');
    expect(renewed.currentPeriodStart).toBe(originalEnd);
    expect(new Date(renewed.currentPeriodEnd).getTime()).toBeGreaterThan(
      new Date(originalEnd).getTime()
    );
  });

  it('should expire subscription', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    const expired = registry.expire(sub.subscriptionId);
    expect(expired!.status).toBe('expired');
  });

  it('should get subscriptions by buyer', () => {
    registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    registry.create('buyer-org', 'listing-2', 'seller-org', 'weekly', 30, 50, 0.5);
    registry.create('other-buyer', 'listing-1', 'seller-org', 'daily', 10, 20, 0.1);

    const buyerSubs = registry.getByBuyer('buyer-org');
    expect(buyerSubs).toHaveLength(2);
  });

  it('should get subscriptions by listing', () => {
    registry.create('buyer-1', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    registry.create('buyer-2', 'listing-1', 'seller-org', 'weekly', 30, 50, 0.5);
    registry.create('buyer-3', 'listing-2', 'seller-org', 'daily', 10, 20, 0.1);

    const listingSubs = registry.getByListing('listing-1');
    expect(listingSubs).toHaveLength(2);
  });

  it('should get active subscription for buyer+listing combo', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    const active = registry.getActive('buyer-org', 'listing-1');
    expect(active).toBeDefined();
    expect(active!.subscriptionId).toBe(sub.subscriptionId);
  });

  it('should not return cancelled subscription as active', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    registry.cancel(sub.subscriptionId, true);
    const active = registry.getActive('buyer-org', 'listing-1');
    expect(active).toBeUndefined();
  });

  it('should set grant ID on subscription', () => {
    const sub = registry.create('buyer-org', 'listing-1', 'seller-org', 'monthly', 50, 100, 1);
    expect(sub.grantId).toBeUndefined();

    registry.setGrantId(sub.subscriptionId, 'grant-123');
    const updated = registry.get(sub.subscriptionId)!;
    expect(updated.grantId).toBe('grant-123');
  });

  it('should return undefined when cancelling nonexistent subscription', () => {
    expect(registry.cancel('nonexistent')).toBeUndefined();
  });

  it('should return undefined when renewing nonexistent subscription', () => {
    expect(registry.renew('nonexistent')).toBeUndefined();
  });

  it('should return undefined when expiring nonexistent subscription', () => {
    expect(registry.expire('nonexistent')).toBeUndefined();
  });

  it('should not detect overage for nonexistent subscription', () => {
    expect(registry.isOverage('nonexistent')).toBe(false);
  });
});

describe('MoltMesh Subscribe Integration', () => {
  let bus: MoltMesh;

  beforeEach(() => {
    bus = new MoltMesh();

    // Set up orgs
    bus.registerOrg({
      orgId: 'seller-org',
      name: 'Seller',
      tier: OrgTier.PARTNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.registerOrg({
      orgId: 'buyer-org',
      name: 'Buyer',
      tier: OrgTier.VENDOR,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    // Set up credit accounts
    bus.createCreditAccount('seller-org', 0);
    bus.createCreditAccount('buyer-org', 1000);

    // Publish a listing
    bus.publishService(makeListing());
  });

  afterEach(() => {
    bus.close();
  });

  it('should subscribe and create auto-grant', () => {
    const sub = bus.subscribe('buyer-org', 'listing-1', 'monthly');
    expect(sub.status).toBe('active');
    expect(sub.grantId).toBeTruthy();

    // Verify the grant was created
    const grant = bus.getGrant(sub.grantId!);
    expect(grant).toBeDefined();
    expect(grant!.fromOrgId).toBe('seller-org');
    expect(grant!.toOrgId).toBe('buyer-org');
    expect(grant!.contractIds).toContain('research-contract');
    expect(grant!.capabilities).toContain('research');
    expect(grant!.status).toBe('active');
  });

  it('should charge buyer for first period on subscribe', () => {
    const balanceBefore = bus.getBalance('buyer-org');
    bus.subscribe('buyer-org', 'listing-1', 'monthly');
    const balanceAfter = bus.getBalance('buyer-org');
    expect(balanceAfter).toBeLessThan(balanceBefore);
  });

  it('should reject subscribe if insufficient balance', () => {
    // Set buyer balance to 0
    bus.createCreditAccount('poor-org', 0);
    bus.registerOrg({
      orgId: 'poor-org',
      name: 'Poor',
      tier: OrgTier.VENDOR,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    expect(() => bus.subscribe('poor-org', 'listing-1', 'monthly')).toThrow();
  });

  it('should return subscriptions by buyer', () => {
    bus.subscribe('buyer-org', 'listing-1', 'monthly');
    const subs = bus.getSubscriptions('buyer-org');
    expect(subs).toHaveLength(1);
    expect(subs[0].listingId).toBe('listing-1');
  });

  it('should cancel a subscription', () => {
    const sub = bus.subscribe('buyer-org', 'listing-1', 'monthly');
    const cancelled = bus.cancelSubscription(sub.subscriptionId, true);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('cancelled');
  });

  it('should throw when subscribing to nonexistent listing', () => {
    expect(() => bus.subscribe('buyer-org', 'nonexistent', 'monthly')).toThrow(
      'Listing nonexistent not found'
    );
  });
});
