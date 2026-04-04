import Database from 'better-sqlite3';

/** Daily usage record for a federation grant. */
export interface GrantUsage {
  grantId: string;
  date: string;
  tokensUsed: number;
  costUsed: number;
  requestCount: number;
}

interface UsageRow {
  grant_id: string;
  date: string;
  tokens_used: number;
  cost_used: number;
  request_count: number;
}

/** SQLite-backed tracker for daily token and cost usage against federation grants. */
export class GrantUsageTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS grant_usage (
        grant_id TEXT NOT NULL,
        date TEXT NOT NULL,
        tokens_used INTEGER DEFAULT 0,
        cost_used REAL DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        PRIMARY KEY (grant_id, date)
      );
    `);
  }

  /** Record token and cost usage against a grant for today. */
  recordUsage(grantId: string, tokens: number, cost: number): void {
    const today = this.getToday();
    const existing = this.db
      .prepare('SELECT * FROM grant_usage WHERE grant_id = ? AND date = ?')
      .get(grantId, today) as UsageRow | undefined;

    if (existing) {
      this.db
        .prepare(
          `
        UPDATE grant_usage SET tokens_used = tokens_used + ?, cost_used = cost_used + ?, request_count = request_count + 1
        WHERE grant_id = ? AND date = ?
      `
        )
        .run(tokens, cost, grantId, today);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO grant_usage (grant_id, date, tokens_used, cost_used, request_count)
        VALUES (?, ?, ?, ?, 1)
      `
        )
        .run(grantId, today, tokens, cost);
    }
  }

  /** Get usage for a grant on a specific date (defaults to today). */
  getUsage(grantId: string, date?: string): GrantUsage | undefined {
    const targetDate = date || this.getToday();
    const row = this.db
      .prepare('SELECT * FROM grant_usage WHERE grant_id = ? AND date = ?')
      .get(grantId, targetDate) as UsageRow | undefined;
    if (!row) return undefined;
    return this.rowToUsage(row);
  }

  /** Check whether a grant's daily token and cost usage is within budget. */
  checkQuota(
    grantId: string,
    maxTokensPerDay: number,
    maxCostPerDay: number
  ): { withinBudget: boolean; reason?: string } {
    const usage = this.getUsage(grantId);
    if (!usage) {
      return { withinBudget: true };
    }
    if (usage.tokensUsed >= maxTokensPerDay) {
      return {
        withinBudget: false,
        reason: `Daily token limit reached: ${usage.tokensUsed}/${maxTokensPerDay}`,
      };
    }
    if (usage.costUsed >= maxCostPerDay) {
      return {
        withinBudget: false,
        reason: `Daily cost limit reached: $${usage.costUsed.toFixed(2)}/$${maxCostPerDay.toFixed(2)}`,
      };
    }
    return { withinBudget: true };
  }

  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  private rowToUsage(row: UsageRow): GrantUsage {
    return {
      grantId: row.grant_id,
      date: row.date,
      tokensUsed: row.tokens_used,
      costUsed: row.cost_used,
      requestCount: row.request_count,
    };
  }
}
