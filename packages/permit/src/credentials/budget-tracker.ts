import Database from 'better-sqlite3';
import { ActionBudget } from '../engine/types.js';

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    lifetime: number;
    hourly?: number;
    daily?: number;
  };
}

export class BudgetTracker {
  private db: Database.Database;
  private budgets: Map<string, ActionBudget> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS budget_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        value REAL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_budget_agent ON budget_usage(agent_id);
      CREATE INDEX IF NOT EXISTS idx_budget_action ON budget_usage(action_type);
      CREATE INDEX IF NOT EXISTS idx_budget_timestamp ON budget_usage(timestamp);
    `);
  }

  setBudget(actionType: string, budget: ActionBudget): void {
    this.budgets.set(actionType, budget);
  }

  setBudgets(budgets: Record<string, ActionBudget>): void {
    for (const [actionType, budget] of Object.entries(budgets)) {
      this.budgets.set(actionType, budget);
    }
  }

  check(agentId: string, actionType: string, value?: number): BudgetCheckResult {
    const budget = this.budgets.get(actionType);
    if (!budget) {
      return { allowed: true };
    }

    if (budget.maxValuePerAction !== undefined && value !== undefined) {
      if (value > budget.maxValuePerAction) {
        return {
          allowed: false,
          reason: `Value ${value} exceeds max per-action value of ${budget.maxValuePerAction}`,
        };
      }
    }

    const now = new Date();

    // Lifetime count
    const lifetimeCount = this.getCount(agentId, actionType);
    if (lifetimeCount >= budget.perAgent) {
      return {
        allowed: false,
        reason: `Lifetime budget exhausted: ${lifetimeCount}/${budget.perAgent} actions used`,
        remaining: { lifetime: 0 },
      };
    }

    // Hourly count
    if (budget.perHour !== undefined) {
      const hourAgo = new Date(now.getTime() - 3600000).toISOString();
      const hourlyCount = this.getCountSince(agentId, actionType, hourAgo);
      if (hourlyCount >= budget.perHour) {
        return {
          allowed: false,
          reason: `Hourly budget exhausted: ${hourlyCount}/${budget.perHour} actions in the last hour`,
          remaining: {
            lifetime: budget.perAgent - lifetimeCount,
            hourly: 0,
          },
        };
      }
    }

    // Daily count
    if (budget.perDay !== undefined) {
      const dayAgo = new Date(now.getTime() - 86400000).toISOString();
      const dailyCount = this.getCountSince(agentId, actionType, dayAgo);
      if (dailyCount >= budget.perDay) {
        return {
          allowed: false,
          reason: `Daily budget exhausted: ${dailyCount}/${budget.perDay} actions today`,
          remaining: {
            lifetime: budget.perAgent - lifetimeCount,
            daily: 0,
          },
        };
      }
    }

    const remaining: BudgetCheckResult['remaining'] = {
      lifetime: budget.perAgent - lifetimeCount,
    };

    if (budget.perHour !== undefined) {
      const hourAgo = new Date(now.getTime() - 3600000).toISOString();
      const hourlyCount = this.getCountSince(agentId, actionType, hourAgo);
      remaining.hourly = budget.perHour - hourlyCount;
    }

    if (budget.perDay !== undefined) {
      const dayAgo = new Date(now.getTime() - 86400000).toISOString();
      const dailyCount = this.getCountSince(agentId, actionType, dayAgo);
      remaining.daily = budget.perDay - dailyCount;
    }

    return { allowed: true, remaining };
  }

  record(agentId: string, actionType: string, value?: number): void {
    this.db.prepare(
      'INSERT INTO budget_usage (agent_id, action_type, timestamp, value) VALUES (?, ?, ?, ?)',
    ).run(agentId, actionType, new Date().toISOString(), value ?? 0);
  }

  getUsage(agentId: string): Record<string, { used: number; limit: number }> {
    const result: Record<string, { used: number; limit: number }> = {};

    for (const [actionType, budget] of this.budgets.entries()) {
      const used = this.getCount(agentId, actionType);
      result[actionType] = { used, limit: budget.perAgent };
    }

    return result;
  }

  private getCount(agentId: string, actionType: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM budget_usage WHERE agent_id = ? AND action_type = ?',
    ).get(agentId, actionType) as { count: number };
    return row.count;
  }

  private getCountSince(agentId: string, actionType: string, since: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM budget_usage WHERE agent_id = ? AND action_type = ? AND timestamp >= ?',
    ).get(agentId, actionType, since) as { count: number };
    return row.count;
  }
}
