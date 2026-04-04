import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BillingEngine } from '../src/exchange/billing.js';
import {
  ServiceListing,
  ServiceCategory,
  ServicePricing,
  ServiceSLA,
} from '../src/exchange/catalog.js';
import { InsufficientBalanceError } from '../src/errors.js';

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
    listingId: 'listing-1',
    orgId: 'acme',
    name: 'Test Service',
    description: 'A test service',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research'],
    contractIds: [],
    pricing: makePricing(),
    sla: makeSLA(),
    tags: [],
    status: 'published',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
    ...overrides,
  };
}

describe('BillingEngine', () => {
  let db: Database.Database;
  let billing: BillingEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    billing = new BillingEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- Account creation ---

  it('should create an account with initial balance', () => {
    const account = billing.createAccount('acme', 1000);
    expect(account.orgId).toBe('acme');
    expect(account.balance).toBe(1000);
    expect(account.lifetimeCredits).toBe(1000);
    expect(account.lifetimeSpent).toBe(0);
    expect(account.lifetimeEarned).toBe(0);
    expect(account.createdAt).toBeDefined();
  });

  it('should create an account with zero balance by default', () => {
    const account = billing.createAccount('acme');
    expect(account.balance).toBe(0);
    expect(account.lifetimeCredits).toBe(0);
  });

  it('should retrieve an existing account', () => {
    billing.createAccount('acme', 500);
    const account = billing.getAccount('acme');
    expect(account).toBeDefined();
    expect(account!.orgId).toBe('acme');
    expect(account!.balance).toBe(500);
  });

  it('should return undefined for non-existent account', () => {
    const account = billing.getAccount('nonexistent');
    expect(account).toBeUndefined();
  });

  // --- Add credits ---

  it('should add credits and update balance', () => {
    billing.createAccount('acme', 100);
    billing.addCredits('acme', 500, 'bonus');

    const balance = billing.getBalance('acme');
    expect(balance).toBe(600);

    const account = billing.getAccount('acme');
    expect(account!.lifetimeCredits).toBe(600);
  });

  it('should add credits multiple times', () => {
    billing.createAccount('acme', 0);
    billing.addCredits('acme', 100, 'bonus');
    billing.addCredits('acme', 200, 'purchase');
    billing.addCredits('acme', 300, 'bonus');

    expect(billing.getBalance('acme')).toBe(600);
    expect(billing.getAccount('acme')!.lifetimeCredits).toBe(600);
  });

  it('should throw when adding credits to non-existent account', () => {
    expect(() => billing.addCredits('nonexistent', 100, 'bonus')).toThrow(
      'No credit account for org nonexistent'
    );
  });

  // --- Get balance ---

  it('should return 0 balance for non-existent account', () => {
    expect(billing.getBalance('nonexistent')).toBe(0);
  });

  // --- Calculate cost ---

  it('should calculate cost for per_request pricing', () => {
    const listing = makeListing({
      pricing: makePricing({ model: 'per_request', perRequestCost: 25 }),
    });
    const cost = billing.calculateCost(listing, { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBe(25);
  });

  it('should calculate cost for per_token pricing', () => {
    const listing = makeListing({
      pricing: makePricing({ model: 'per_token', inputTokenRate: 0.5, outputTokenRate: 1.0 }),
    });
    // 2000 input tokens: (2000/1000) * 0.5 = 1.0
    // 1000 output tokens: (1000/1000) * 1.0 = 1.0
    const cost = billing.calculateCost(listing, { inputTokens: 2000, outputTokens: 1000 });
    expect(cost).toBe(2.0);
  });

  it('should calculate cost for per_token with large token usage', () => {
    const listing = makeListing({
      pricing: makePricing({ model: 'per_token', inputTokenRate: 0.3, outputTokenRate: 0.6 }),
    });
    // 10000 input: (10000/1000) * 0.3 = 3.0
    // 5000 output: (5000/1000) * 0.6 = 3.0
    const cost = billing.calculateCost(listing, { inputTokens: 10000, outputTokens: 5000 });
    expect(cost).toBe(6.0);
  });

  it('should calculate cost for subscription pricing (returns 0)', () => {
    const listing = makeListing({
      pricing: makePricing({ model: 'subscription', subscriptionRate: 100 }),
    });
    const cost = billing.calculateCost(listing, { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBe(0);
  });

  it('should calculate cost for free pricing (returns 0)', () => {
    const listing = makeListing({ pricing: makePricing({ model: 'free', freeQuota: 100 }) });
    const cost = billing.calculateCost(listing, { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBe(0);
  });

  // --- Charge for usage ---

  it('should charge buyer and credit seller on usage', () => {
    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    const txn = billing.chargeForUsage('trace-1', 'buyer', 'seller', 100, 'listing-1');

    expect(txn.transactionType).toBe('usage');
    expect(txn.amount).toBe(100);
    expect(txn.platformFee).toBe(10); // 10% default
    expect(txn.netAmount).toBe(90);

    // Buyer debited
    expect(billing.getBalance('buyer')).toBe(900);
    // Seller credited net amount
    expect(billing.getBalance('seller')).toBe(90);
  });

  it('should apply default 10% platform fee', () => {
    billing.createAccount('buyer', 500);
    billing.createAccount('seller', 0);

    const txn = billing.chargeForUsage('trace-2', 'buyer', 'seller', 200, 'listing-1');
    expect(txn.platformFee).toBe(20);
    expect(txn.netAmount).toBe(180);
  });

  it('should update lifetime counters on charge', () => {
    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    billing.chargeForUsage('trace-3', 'buyer', 'seller', 100, 'listing-1');

    const buyerAccount = billing.getAccount('buyer')!;
    expect(buyerAccount.lifetimeSpent).toBe(100);

    const sellerAccount = billing.getAccount('seller')!;
    expect(sellerAccount.lifetimeEarned).toBe(90);
  });

  it('should throw InsufficientBalanceError when buyer has insufficient balance', () => {
    billing.createAccount('buyer', 50);
    billing.createAccount('seller', 0);

    try {
      billing.chargeForUsage('trace-4', 'buyer', 'seller', 100, 'listing-1');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const ibe = err as InsufficientBalanceError;
      expect(ibe.orgId).toBe('buyer');
      expect(ibe.balance).toBe(50);
      expect(ibe.required).toBe(100);
    }
  });

  it('should not modify balances when charge fails due to insufficient funds', () => {
    billing.createAccount('buyer', 50);
    billing.createAccount('seller', 100);

    try {
      billing.chargeForUsage('trace-5', 'buyer', 'seller', 100, 'listing-1');
    } catch {
      // expected
    }

    expect(billing.getBalance('buyer')).toBe(50);
    expect(billing.getBalance('seller')).toBe(100);
  });

  it('should record both usage and earning transactions on charge', () => {
    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    billing.chargeForUsage('trace-6', 'buyer', 'seller', 100, 'listing-1');

    const buyerTxns = billing.getTransactions('buyer');
    const sellerTxns = billing.getTransactions('seller');

    // buyer should see usage txn
    expect(buyerTxns.some((t) => t.transactionType === 'usage')).toBe(true);
    // seller should see earning txn
    expect(sellerTxns.some((t) => t.transactionType === 'earning')).toBe(true);
  });

  // --- Custom platform fee ---

  it('should use configurable platform fee percentage', () => {
    db.close();
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    billing = new BillingEngine(db, { defaultPlatformFeePct: 0.05 });

    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    const txn = billing.chargeForUsage('trace-7', 'buyer', 'seller', 200, 'listing-1');
    expect(txn.platformFee).toBe(10); // 5%
    expect(txn.netAmount).toBe(190);
  });

  it('should use per-org fee override', () => {
    db.close();
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    billing = new BillingEngine(db, { orgFeeOverrides: { seller: 0.15 } });

    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    const txn = billing.chargeForUsage('trace-8', 'buyer', 'seller', 100, 'listing-1');
    expect(txn.platformFee).toBe(15); // 15% override
    expect(txn.netAmount).toBe(85);
  });

  // --- Refund ---

  it('should refund a charge and restore balances', () => {
    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    const chargeTxn = billing.chargeForUsage('trace-9', 'buyer', 'seller', 100, 'listing-1');

    expect(billing.getBalance('buyer')).toBe(900);
    expect(billing.getBalance('seller')).toBe(90);

    const refundTxn = billing.refund(chargeTxn.transactionId, 'Service failed');

    expect(refundTxn.transactionType).toBe('refund');
    expect(refundTxn.amount).toBe(100);
    expect(billing.getBalance('buyer')).toBe(1000);
    expect(billing.getBalance('seller')).toBe(0);
  });

  it('should update lifetime counters on refund', () => {
    billing.createAccount('buyer', 1000);
    billing.createAccount('seller', 0);

    const chargeTxn = billing.chargeForUsage('trace-10', 'buyer', 'seller', 200, 'listing-1');
    billing.refund(chargeTxn.transactionId, 'Error');

    const buyerAccount = billing.getAccount('buyer')!;
    expect(buyerAccount.lifetimeSpent).toBe(0);

    const sellerAccount = billing.getAccount('seller')!;
    expect(sellerAccount.lifetimeEarned).toBe(0);
  });

  it('should throw when refunding non-existent transaction', () => {
    expect(() => billing.refund('nonexistent', 'reason')).toThrow(
      'Transaction nonexistent not found'
    );
  });

  // --- Transaction history ---

  it('should retrieve transactions with pagination', () => {
    billing.createAccount('buyer', 10000);
    billing.createAccount('seller', 0);

    for (let i = 0; i < 5; i++) {
      billing.chargeForUsage(`trace-p-${i}`, 'buyer', 'seller', 10, 'listing-1');
    }

    // Each chargeForUsage creates 2 txns (usage + earning) both referencing buyer's account
    // So buyer sees 10 total txns
    const all = billing.getTransactions('buyer');
    expect(all).toHaveLength(10);

    const page1 = billing.getTransactions('buyer', { limit: 4, offset: 0 });
    expect(page1).toHaveLength(4);

    const page2 = billing.getTransactions('buyer', { limit: 4, offset: 4 });
    expect(page2).toHaveLength(4);

    const page3 = billing.getTransactions('buyer', { limit: 4, offset: 8 });
    expect(page3).toHaveLength(2);
  });

  it('should filter transactions by type', () => {
    billing.createAccount('buyer', 10000);
    billing.createAccount('seller', 0);

    billing.chargeForUsage('trace-ft-1', 'buyer', 'seller', 100, 'listing-1');
    billing.addCredits('buyer', 50, 'bonus');

    const usageTxns = billing.getTransactions('buyer', { type: 'usage' });
    expect(usageTxns.every((t) => t.transactionType === 'usage')).toBe(true);

    const grantTxns = billing.getTransactions('buyer', { type: 'grant' });
    expect(grantTxns.every((t) => t.transactionType === 'grant')).toBe(true);
  });

  it('should return empty array for non-existent account transactions', () => {
    const txns = billing.getTransactions('nonexistent');
    expect(txns).toEqual([]);
  });

  // --- Earnings summary ---

  it('should aggregate earnings summary', () => {
    billing.createAccount('buyer', 10000);
    billing.createAccount('seller', 0);

    billing.chargeForUsage('trace-e-1', 'buyer', 'seller', 100, 'listing-a');
    billing.chargeForUsage('trace-e-2', 'buyer', 'seller', 200, 'listing-b');
    billing.chargeForUsage('trace-e-3', 'buyer', 'seller', 300, 'listing-a');

    const earnings = billing.getEarnings('seller');
    expect(earnings.transactionCount).toBe(3);
    // Earnings amount is netAmount in earning txns
    expect(earnings.totalEarned).toBeGreaterThan(0);
    expect(earnings.totalPlatformFees).toBeGreaterThan(0);
    expect(earnings.netEarnings).toBe(earnings.totalEarned - earnings.totalPlatformFees);
  });

  it('should return empty earnings for non-existent org', () => {
    const earnings = billing.getEarnings('nonexistent');
    expect(earnings.totalEarned).toBe(0);
    expect(earnings.transactionCount).toBe(0);
  });

  // --- Spend summary ---

  it('should aggregate spend summary', () => {
    billing.createAccount('buyer', 10000);
    billing.createAccount('seller-a', 0);
    billing.createAccount('seller-b', 0);

    billing.chargeForUsage('trace-s-1', 'buyer', 'seller-a', 100, 'listing-1');
    billing.chargeForUsage('trace-s-2', 'buyer', 'seller-b', 200, 'listing-2');
    billing.chargeForUsage('trace-s-3', 'buyer', 'seller-a', 150, 'listing-1');

    const spend = billing.getSpend('buyer');
    expect(spend.totalSpent).toBe(450);
    expect(spend.transactionCount).toBe(3);
    expect(spend.byOrg['seller-a']).toBe(250);
    expect(spend.byOrg['seller-b']).toBe(200);
  });

  it('should return empty spend for non-existent org', () => {
    const spend = billing.getSpend('nonexistent');
    expect(spend.totalSpent).toBe(0);
    expect(spend.transactionCount).toBe(0);
  });

  // --- Multiple transactions across orgs ---

  it('should handle multiple transactions across different orgs', () => {
    billing.createAccount('org-a', 5000);
    billing.createAccount('org-b', 3000);
    billing.createAccount('org-c', 0);

    // org-a buys from org-c
    billing.chargeForUsage('t-1', 'org-a', 'org-c', 100, 'listing-x');
    // org-b buys from org-c
    billing.chargeForUsage('t-2', 'org-b', 'org-c', 200, 'listing-y');
    // org-a buys from org-b
    billing.chargeForUsage('t-3', 'org-a', 'org-b', 50, 'listing-z');

    expect(billing.getBalance('org-a')).toBe(4850); // -100 -50
    expect(billing.getBalance('org-b')).toBe(2800 + 45); // -200 + (50 - 5)
    expect(billing.getBalance('org-c')).toBe(90 + 180); // (100 - 10) + (200 - 20)
  });

  // --- Lifetime counters accuracy ---

  it('should maintain accurate lifetime counters across multiple operations', () => {
    billing.createAccount('org', 1000);
    billing.createAccount('provider', 0);

    billing.addCredits('org', 500, 'bonus'); // lifetime_credits: 1500
    billing.chargeForUsage('t-lc1', 'org', 'provider', 200, 'listing-1'); // spent 200
    billing.chargeForUsage('t-lc2', 'org', 'provider', 100, 'listing-1'); // spent 300

    const orgAccount = billing.getAccount('org')!;
    expect(orgAccount.lifetimeCredits).toBe(1500);
    expect(orgAccount.lifetimeSpent).toBe(300);
    expect(orgAccount.balance).toBe(1200);

    const providerAccount = billing.getAccount('provider')!;
    expect(providerAccount.lifetimeEarned).toBe(270); // (200 + 100) * 0.9
    expect(providerAccount.balance).toBe(270);
  });

  // --- Edge cases ---

  it('should handle zero-cost charge', () => {
    billing.createAccount('buyer', 100);
    billing.createAccount('seller', 0);

    const txn = billing.chargeForUsage('t-zero', 'buyer', 'seller', 0, 'listing-free');
    expect(txn.amount).toBe(0);
    expect(txn.platformFee).toBe(0);
    expect(billing.getBalance('buyer')).toBe(100);
  });

  it('should handle charge that exactly depletes balance', () => {
    billing.createAccount('buyer', 100);
    billing.createAccount('seller', 0);

    billing.chargeForUsage('t-exact', 'buyer', 'seller', 100, 'listing-1');
    expect(billing.getBalance('buyer')).toBe(0);
  });

  it('should create accounts with accountId set', () => {
    const account = billing.createAccount('test-org', 500);
    expect(account.accountId).toBeDefined();
    expect(account.accountId.length).toBeGreaterThan(0);
  });
});
