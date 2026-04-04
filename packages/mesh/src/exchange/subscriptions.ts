import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

/** Billing period for a subscription. */
export type SubscriptionPlan = 'daily' | 'weekly' | 'monthly';
/** Lifecycle status of a subscription. */
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';

/** A subscription linking a buyer to a service listing with a billing plan. */
export interface Subscription {
  subscriptionId: string;
  buyerOrgId: string;
  listingId: string;
  sellerOrgId: string;
  plan: SubscriptionPlan;
  creditsPerPeriod: number;
  requestsIncluded: number;
  overageRate: number;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  requestsUsed: number;
  autoRenew: boolean;
  grantId?: string;
  createdAt: string;
}

interface SubscriptionRow {
  subscription_id: string;
  buyer_org_id: string;
  listing_id: string;
  seller_org_id: string;
  plan: string;
  credits_per_period: number;
  requests_included: number;
  overage_rate: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  requests_used: number;
  auto_renew: number;
  grant_id: string | null;
  created_at: string;
}

const PLAN_DAYS: Record<SubscriptionPlan, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

/** SQLite-backed registry for managing service subscriptions with usage tracking. */
export class SubscriptionRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        subscription_id TEXT PRIMARY KEY,
        buyer_org_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        seller_org_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        credits_per_period REAL NOT NULL,
        requests_included INTEGER NOT NULL,
        overage_rate REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        requests_used INTEGER NOT NULL DEFAULT 0,
        auto_renew INTEGER NOT NULL DEFAULT 1,
        grant_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sub_buyer ON subscriptions(buyer_org_id);
      CREATE INDEX IF NOT EXISTS idx_sub_listing ON subscriptions(listing_id);
      CREATE INDEX IF NOT EXISTS idx_sub_status ON subscriptions(status);
    `);
  }

  /** Create a new active subscription with computed period dates. */
  create(
    buyerOrgId: string,
    listingId: string,
    sellerOrgId: string,
    plan: SubscriptionPlan,
    creditsPerPeriod: number,
    requestsIncluded: number,
    overageRate: number
  ): Subscription {
    const subscriptionId = uuidv4();
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + PLAN_DAYS[plan]);

    const sub: Subscription = {
      subscriptionId,
      buyerOrgId,
      listingId,
      sellerOrgId,
      plan,
      creditsPerPeriod,
      requestsIncluded,
      overageRate,
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      requestsUsed: 0,
      autoRenew: true,
      createdAt: now.toISOString(),
    };

    this.db
      .prepare(
        `
      INSERT INTO subscriptions (subscription_id, buyer_org_id, listing_id, seller_org_id, plan,
        credits_per_period, requests_included, overage_rate, status, current_period_start,
        current_period_end, requests_used, auto_renew, grant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        sub.subscriptionId,
        sub.buyerOrgId,
        sub.listingId,
        sub.sellerOrgId,
        sub.plan,
        sub.creditsPerPeriod,
        sub.requestsIncluded,
        sub.overageRate,
        sub.status,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
        sub.requestsUsed,
        sub.autoRenew ? 1 : 0,
        sub.grantId || null,
        sub.createdAt
      );

    return sub;
  }

  /** Retrieve a subscription by ID. */
  get(subscriptionId: string): Subscription | undefined {
    const row = this.db
      .prepare('SELECT * FROM subscriptions WHERE subscription_id = ?')
      .get(subscriptionId) as SubscriptionRow | undefined;
    if (!row) return undefined;
    return this.rowToSubscription(row);
  }

  /** Get all subscriptions for a buyer organization. */
  getByBuyer(buyerOrgId: string): Subscription[] {
    const rows = this.db
      .prepare('SELECT * FROM subscriptions WHERE buyer_org_id = ? ORDER BY created_at DESC')
      .all(buyerOrgId) as SubscriptionRow[];
    return rows.map((r) => this.rowToSubscription(r));
  }

  /** Get all subscriptions for a listing. */
  getByListing(listingId: string): Subscription[] {
    const rows = this.db
      .prepare('SELECT * FROM subscriptions WHERE listing_id = ? ORDER BY created_at DESC')
      .all(listingId) as SubscriptionRow[];
    return rows.map((r) => this.rowToSubscription(r));
  }

  /** Get the active subscription for a buyer on a specific listing. */
  getActive(buyerOrgId: string, listingId: string): Subscription | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM subscriptions WHERE buyer_org_id = ? AND listing_id = ? AND status = 'active' LIMIT 1"
      )
      .get(buyerOrgId, listingId) as SubscriptionRow | undefined;
    if (!row) return undefined;
    return this.rowToSubscription(row);
  }

  /** Increment the request usage counter for a subscription. */
  incrementUsage(subscriptionId: string): void {
    this.db
      .prepare(
        'UPDATE subscriptions SET requests_used = requests_used + 1 WHERE subscription_id = ?'
      )
      .run(subscriptionId);
  }

  /** Check whether a subscription has exceeded its included request quota. */
  isOverage(subscriptionId: string): boolean {
    const sub = this.get(subscriptionId);
    if (!sub) return false;
    return sub.requestsUsed >= sub.requestsIncluded;
  }

  /** Cancel a subscription, either immediately or at the end of the current period. */
  cancel(subscriptionId: string, immediate?: boolean): Subscription | undefined {
    const sub = this.get(subscriptionId);
    if (!sub) return undefined;

    if (immediate) {
      this.db
        .prepare(
          "UPDATE subscriptions SET status = 'cancelled', auto_renew = 0 WHERE subscription_id = ?"
        )
        .run(subscriptionId);
    } else {
      this.db
        .prepare('UPDATE subscriptions SET auto_renew = 0 WHERE subscription_id = ?')
        .run(subscriptionId);
    }

    return this.get(subscriptionId);
  }

  /** Renew a subscription for the next billing period, resetting usage counters. */
  renew(subscriptionId: string): Subscription | undefined {
    const sub = this.get(subscriptionId);
    if (!sub) return undefined;

    const newStart = new Date(sub.currentPeriodEnd);
    const newEnd = new Date(newStart);
    newEnd.setDate(newEnd.getDate() + PLAN_DAYS[sub.plan]);

    this.db
      .prepare(
        `
      UPDATE subscriptions
      SET requests_used = 0, current_period_start = ?, current_period_end = ?, status = 'active'
      WHERE subscription_id = ?
    `
      )
      .run(newStart.toISOString(), newEnd.toISOString(), subscriptionId);

    return this.get(subscriptionId);
  }

  /** Mark a subscription as expired. */
  expire(subscriptionId: string): Subscription | undefined {
    const sub = this.get(subscriptionId);
    if (!sub) return undefined;
    this.db
      .prepare("UPDATE subscriptions SET status = 'expired' WHERE subscription_id = ?")
      .run(subscriptionId);
    return this.get(subscriptionId);
  }

  /** Associate a federation grant ID with a subscription. */
  setGrantId(subscriptionId: string, grantId: string): void {
    this.db
      .prepare('UPDATE subscriptions SET grant_id = ? WHERE subscription_id = ?')
      .run(grantId, subscriptionId);
  }

  private rowToSubscription(row: SubscriptionRow): Subscription {
    return {
      subscriptionId: row.subscription_id,
      buyerOrgId: row.buyer_org_id,
      listingId: row.listing_id,
      sellerOrgId: row.seller_org_id,
      plan: row.plan as SubscriptionPlan,
      creditsPerPeriod: row.credits_per_period,
      requestsIncluded: row.requests_included,
      overageRate: row.overage_rate,
      status: row.status as SubscriptionStatus,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      requestsUsed: row.requests_used,
      autoRenew: row.auto_renew === 1,
      grantId: row.grant_id || undefined,
      createdAt: row.created_at,
    };
  }
}
