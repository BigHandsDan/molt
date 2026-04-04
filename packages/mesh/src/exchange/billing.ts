import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { InsufficientBalanceError } from '../errors.js';
import { ServiceListing } from './catalog.js';

/** Credit account for an organization, tracking balance and lifetime totals. */
export interface CreditAccount {
  accountId: string;
  orgId: string;
  balance: number;
  lifetimeCredits: number;
  lifetimeSpent: number;
  lifetimeEarned: number;
  createdAt: string;
}

/** Type of credit transaction. */
export type TransactionType = 'purchase' | 'usage' | 'earning' | 'refund' | 'grant';
/** What the transaction references (trace, subscription, topup, or bonus). */
export type ReferenceType = 'trace' | 'subscription' | 'topup' | 'bonus';

/** Record of a credit movement between accounts. */
export interface CreditTransaction {
  transactionId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  transactionType: TransactionType;
  referenceType: ReferenceType;
  referenceId: string;
  description: string;
  platformFee: number;
  netAmount: number;
  createdAt: string;
}

/** Token consumption for a single invocation. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Summary of earnings for a service provider organization. */
export interface EarningsSummary {
  totalEarned: number;
  totalPlatformFees: number;
  netEarnings: number;
  transactionCount: number;
  byService: Record<string, number>;
}

/** Summary of spending for a buyer organization. */
export interface SpendSummary {
  totalSpent: number;
  transactionCount: number;
  byService: Record<string, number>;
  byOrg: Record<string, number>;
}

/** Options for paginating and filtering transaction queries. */
export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  type?: TransactionType;
}

/** ISO 8601 date range for filtering transactions. */
export interface DateRange {
  from: string;
  to: string;
}

/** Configuration for the billing engine including platform fee percentages. */
export interface BillingConfig {
  defaultPlatformFeePct?: number;
  orgFeeOverrides?: Record<string, number>;
}

interface AccountRow {
  account_id: string;
  org_id: string;
  balance: number;
  lifetime_credits: number;
  lifetime_spent: number;
  lifetime_earned: number;
  created_at: string;
}

interface TransactionRow {
  transaction_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transaction_type: string;
  reference_type: string;
  reference_id: string;
  description: string;
  platform_fee: number;
  net_amount: number;
  created_at: string;
}

/**
 * SQLite-backed credit billing engine that manages organization accounts,
 * processes charges with platform fees, and tracks earnings and spending.
 *
 * @example
 * ```ts
 * const billing = new BillingEngine(db);
 * billing.createAccount('acme', 1000);
 * billing.chargeForUsage(traceId, 'buyer-org', 'seller-org', 5.0, 'listing-1');
 * ```
 */
export class BillingEngine {
  private db: Database.Database;
  private platformFeePct: number;
  private orgFeeOverrides: Record<string, number>;

  constructor(db: Database.Database, config?: BillingConfig) {
    this.db = db;
    this.platformFeePct = config?.defaultPlatformFeePct ?? 0.1;
    this.orgFeeOverrides = config?.orgFeeOverrides ?? {};
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_accounts (
        account_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL UNIQUE,
        balance REAL NOT NULL DEFAULT 0,
        lifetime_credits REAL DEFAULT 0,
        lifetime_spent REAL DEFAULT 0,
        lifetime_earned REAL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credit_account_org ON credit_accounts(org_id);

      CREATE TABLE IF NOT EXISTS credit_transactions (
        transaction_id TEXT PRIMARY KEY,
        from_account_id TEXT NOT NULL,
        to_account_id TEXT NOT NULL,
        amount REAL NOT NULL,
        transaction_type TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        description TEXT,
        platform_fee REAL DEFAULT 0,
        net_amount REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_txn_from ON credit_transactions(from_account_id);
      CREATE INDEX IF NOT EXISTS idx_txn_to ON credit_transactions(to_account_id);
      CREATE INDEX IF NOT EXISTS idx_txn_type ON credit_transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_txn_created ON credit_transactions(created_at);
    `);
  }

  /** Create a new credit account for an organization with an optional initial balance. */
  createAccount(orgId: string, initialBalance?: number): CreditAccount {
    const accountId = uuidv4();
    const now = new Date().toISOString();
    const balance = initialBalance ?? 0;

    this.db
      .prepare(
        `
      INSERT INTO credit_accounts (account_id, org_id, balance, lifetime_credits, lifetime_spent, lifetime_earned, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `
      )
      .run(accountId, orgId, balance, balance, now);

    return {
      accountId,
      orgId,
      balance,
      lifetimeCredits: balance,
      lifetimeSpent: 0,
      lifetimeEarned: 0,
      createdAt: now,
    };
  }

  /** Retrieve the credit account for an organization. */
  getAccount(orgId: string): CreditAccount | undefined {
    const row = this.db.prepare('SELECT * FROM credit_accounts WHERE org_id = ?').get(orgId) as
      | AccountRow
      | undefined;
    if (!row) return undefined;
    return this.rowToAccount(row);
  }

  /** Add credits to an organization's account. */
  addCredits(orgId: string, amount: number, reason: string): CreditTransaction {
    const account = this.getAccount(orgId);
    if (!account) throw new Error(`No credit account for org ${orgId}`);

    const txnId = uuidv4();
    const now = new Date().toISOString();
    const refType: ReferenceType = reason === 'purchase' ? 'topup' : 'bonus';

    const addCreditsTxn = this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE credit_accounts
        SET balance = balance + ?, lifetime_credits = lifetime_credits + ?
        WHERE org_id = ?
      `
        )
        .run(amount, amount, orgId);

      this.db
        .prepare(
          `
        INSERT INTO credit_transactions (transaction_id, from_account_id, to_account_id, amount,
          transaction_type, reference_type, reference_id, description, platform_fee, net_amount, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
        )
        .run(
          txnId,
          'platform',
          account.accountId,
          amount,
          'grant',
          refType,
          uuidv4(),
          reason,
          amount,
          now
        );
    });
    addCreditsTxn();

    return {
      transactionId: txnId,
      fromAccountId: 'platform',
      toAccountId: account.accountId,
      amount,
      transactionType: 'grant',
      referenceType: refType,
      referenceId: '',
      description: reason,
      platformFee: 0,
      netAmount: amount,
      createdAt: now,
    };
  }

  /** Get the current credit balance for an organization. */
  getBalance(orgId: string): number {
    const account = this.getAccount(orgId);
    return account?.balance ?? 0;
  }

  /** Calculate the cost of a service invocation based on the listing's pricing model. */
  calculateCost(listing: ServiceListing, tokenUsage: TokenUsage): number {
    const pricing = listing.pricing;
    switch (pricing.model) {
      case 'per_request':
        return pricing.perRequestCost ?? 0;
      case 'per_token': {
        const inputCost = (tokenUsage.inputTokens / 1000) * (pricing.inputTokenRate ?? 0);
        const outputCost = (tokenUsage.outputTokens / 1000) * (pricing.outputTokenRate ?? 0);
        return inputCost + outputCost;
      }
      case 'subscription':
        return 0;
      case 'free':
        return 0;
      default:
        return 0;
    }
  }

  /** Charge a buyer and credit a seller for service usage, deducting a platform fee. */
  chargeForUsage(
    traceId: string,
    buyerOrg: string,
    sellerOrg: string,
    cost: number,
    listingId: string
  ): CreditTransaction {
    const buyerAccount = this.getAccount(buyerOrg);
    if (!buyerAccount) throw new Error(`No credit account for buyer org ${buyerOrg}`);
    const sellerAccount = this.getAccount(sellerOrg);
    if (!sellerAccount) throw new Error(`No credit account for seller org ${sellerOrg}`);

    if (buyerAccount.balance < cost) {
      throw new InsufficientBalanceError(buyerOrg, buyerAccount.balance, cost);
    }

    const feePct = this.orgFeeOverrides[sellerOrg] ?? this.platformFeePct;
    const platformFee = cost * feePct;
    const netAmount = cost - platformFee;
    const now = new Date().toISOString();
    const usageTxnId = uuidv4();
    const earningTxnId = uuidv4();

    const chargeTxn = this.db.transaction(() => {
      // Debit buyer
      this.db
        .prepare(
          `
        UPDATE credit_accounts SET balance = balance - ?, lifetime_spent = lifetime_spent + ? WHERE org_id = ?
      `
        )
        .run(cost, cost, buyerOrg);

      // Credit seller
      this.db
        .prepare(
          `
        UPDATE credit_accounts SET balance = balance + ?, lifetime_earned = lifetime_earned + ? WHERE org_id = ?
      `
        )
        .run(netAmount, netAmount, sellerOrg);

      // Record usage transaction (buyer side)
      this.db
        .prepare(
          `
        INSERT INTO credit_transactions (transaction_id, from_account_id, to_account_id, amount,
          transaction_type, reference_type, reference_id, description, platform_fee, net_amount, created_at)
        VALUES (?, ?, ?, ?, 'usage', 'trace', ?, ?, ?, ?, ?)
      `
        )
        .run(
          usageTxnId,
          buyerAccount.accountId,
          sellerAccount.accountId,
          cost,
          traceId,
          `Usage charge for listing ${listingId}`,
          platformFee,
          netAmount,
          now
        );

      // Record earning transaction (seller side)
      this.db
        .prepare(
          `
        INSERT INTO credit_transactions (transaction_id, from_account_id, to_account_id, amount,
          transaction_type, reference_type, reference_id, description, platform_fee, net_amount, created_at)
        VALUES (?, ?, ?, ?, 'earning', 'trace', ?, ?, ?, ?, ?)
      `
        )
        .run(
          earningTxnId,
          buyerAccount.accountId,
          sellerAccount.accountId,
          netAmount,
          traceId,
          `Earning from listing ${listingId}`,
          platformFee,
          netAmount,
          now
        );
    });
    chargeTxn();

    return {
      transactionId: usageTxnId,
      fromAccountId: buyerAccount.accountId,
      toAccountId: sellerAccount.accountId,
      amount: cost,
      transactionType: 'usage',
      referenceType: 'trace',
      referenceId: traceId,
      description: `Usage charge for listing ${listingId}`,
      platformFee,
      netAmount,
      createdAt: now,
    };
  }

  /** Refund a previous transaction, reversing the charge and earning. */
  refund(transactionId: string, reason: string): CreditTransaction {
    const original = this.db
      .prepare('SELECT * FROM credit_transactions WHERE transaction_id = ?')
      .get(transactionId) as TransactionRow | undefined;
    if (!original) throw new Error(`Transaction ${transactionId} not found`);

    const refundTxnId = uuidv4();
    const now = new Date().toISOString();

    const refundTxn = this.db.transaction(() => {
      // Find the buyer and seller org from accounts
      const fromAccount = this.db
        .prepare('SELECT * FROM credit_accounts WHERE account_id = ?')
        .get(original.from_account_id) as AccountRow | undefined;
      const toAccount = this.db
        .prepare('SELECT * FROM credit_accounts WHERE account_id = ?')
        .get(original.to_account_id) as AccountRow | undefined;

      if (fromAccount) {
        // Refund buyer: add back the amount
        this.db
          .prepare(
            `
          UPDATE credit_accounts SET balance = balance + ?, lifetime_spent = lifetime_spent - ? WHERE account_id = ?
        `
          )
          .run(original.amount, original.amount, original.from_account_id);
      }

      if (toAccount) {
        // Debit seller: remove the net amount
        this.db
          .prepare(
            `
          UPDATE credit_accounts SET balance = balance - ?, lifetime_earned = lifetime_earned - ? WHERE account_id = ?
        `
          )
          .run(original.net_amount, original.net_amount, original.to_account_id);
      }

      // Record refund transaction
      this.db
        .prepare(
          `
        INSERT INTO credit_transactions (transaction_id, from_account_id, to_account_id, amount,
          transaction_type, reference_type, reference_id, description, platform_fee, net_amount, created_at)
        VALUES (?, ?, ?, ?, 'refund', 'trace', ?, ?, ?, ?, ?)
      `
        )
        .run(
          refundTxnId,
          original.to_account_id,
          original.from_account_id,
          original.amount,
          original.reference_id,
          `Refund: ${reason}`,
          original.platform_fee,
          original.net_amount,
          now
        );
    });
    refundTxn();

    return {
      transactionId: refundTxnId,
      fromAccountId: original.to_account_id,
      toAccountId: original.from_account_id,
      amount: original.amount,
      transactionType: 'refund',
      referenceType: 'trace',
      referenceId: original.reference_id,
      description: `Refund: ${reason}`,
      platformFee: original.platform_fee,
      netAmount: original.net_amount,
      createdAt: now,
    };
  }

  /** Get paginated transaction history for an organization. */
  getTransactions(orgId: string, options?: TransactionQueryOptions): CreditTransaction[] {
    const account = this.getAccount(orgId);
    if (!account) return [];

    const conditions = ['(from_account_id = ? OR to_account_id = ?)'];
    const params: unknown[] = [account.accountId, account.accountId];

    if (options?.type) {
      conditions.push('transaction_type = ?');
      params.push(options.type);
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const where = conditions.join(' AND ');

    const rows = this.db
      .prepare(
        `SELECT * FROM credit_transactions WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as TransactionRow[];

    return rows.map((r) => this.rowToTransaction(r));
  }

  /** Get an earnings summary for a service provider organization. */
  getEarnings(orgId: string, dateRange?: DateRange): EarningsSummary {
    const account = this.getAccount(orgId);
    if (!account) {
      return {
        totalEarned: 0,
        totalPlatformFees: 0,
        netEarnings: 0,
        transactionCount: 0,
        byService: {},
      };
    }

    const conditions = ['to_account_id = ?', "transaction_type = 'earning'"];
    const params: unknown[] = [account.accountId];

    if (dateRange?.from) {
      conditions.push('created_at >= ?');
      params.push(dateRange.from);
    }
    if (dateRange?.to) {
      conditions.push('created_at <= ?');
      params.push(dateRange.to);
    }

    const where = conditions.join(' AND ');
    const rows = this.db
      .prepare(`SELECT * FROM credit_transactions WHERE ${where}`)
      .all(...params) as TransactionRow[];

    let totalEarned = 0;
    let totalPlatformFees = 0;
    const byService: Record<string, number> = {};

    for (const row of rows) {
      totalEarned += row.amount;
      totalPlatformFees += row.platform_fee;
      // Extract listing id from description
      const listingMatch = row.description.match(/listing\s+(\S+)/);
      if (listingMatch) {
        const key = listingMatch[1];
        byService[key] = (byService[key] || 0) + row.net_amount;
      }
    }

    return {
      totalEarned,
      totalPlatformFees,
      netEarnings: totalEarned - totalPlatformFees,
      transactionCount: rows.length,
      byService,
    };
  }

  /** Get a spending summary for a buyer organization. */
  getSpend(orgId: string, dateRange?: DateRange): SpendSummary {
    const account = this.getAccount(orgId);
    if (!account) {
      return { totalSpent: 0, transactionCount: 0, byService: {}, byOrg: {} };
    }

    const conditions = ['from_account_id = ?', "transaction_type = 'usage'"];
    const params: unknown[] = [account.accountId];

    if (dateRange?.from) {
      conditions.push('created_at >= ?');
      params.push(dateRange.from);
    }
    if (dateRange?.to) {
      conditions.push('created_at <= ?');
      params.push(dateRange.to);
    }

    const where = conditions.join(' AND ');
    const rows = this.db
      .prepare(`SELECT * FROM credit_transactions WHERE ${where}`)
      .all(...params) as TransactionRow[];

    let totalSpent = 0;
    const byService: Record<string, number> = {};
    const byOrg: Record<string, number> = {};

    for (const row of rows) {
      totalSpent += row.amount;
      // Extract listing id from description
      const listingMatch = row.description.match(/listing\s+(\S+)/);
      if (listingMatch) {
        const key = listingMatch[1];
        byService[key] = (byService[key] || 0) + row.amount;
      }
      // Track by seller account -> org
      const sellerAccount = this.db
        .prepare('SELECT org_id FROM credit_accounts WHERE account_id = ?')
        .get(row.to_account_id) as { org_id: string } | undefined;
      if (sellerAccount) {
        byOrg[sellerAccount.org_id] = (byOrg[sellerAccount.org_id] || 0) + row.amount;
      }
    }

    return {
      totalSpent,
      transactionCount: rows.length,
      byService,
      byOrg,
    };
  }

  private rowToAccount(row: AccountRow): CreditAccount {
    return {
      accountId: row.account_id,
      orgId: row.org_id,
      balance: row.balance,
      lifetimeCredits: row.lifetime_credits,
      lifetimeSpent: row.lifetime_spent,
      lifetimeEarned: row.lifetime_earned,
      createdAt: row.created_at,
    };
  }

  private rowToTransaction(row: TransactionRow): CreditTransaction {
    return {
      transactionId: row.transaction_id,
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amount: row.amount,
      transactionType: row.transaction_type as TransactionType,
      referenceType: row.reference_type as ReferenceType,
      referenceId: row.reference_id,
      description: row.description || '',
      platformFee: row.platform_fee,
      netAmount: row.net_amount,
      createdAt: row.created_at,
    };
  }
}
