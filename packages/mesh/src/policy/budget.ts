import Database from 'better-sqlite3';
import { AgentBudget } from './types.js';
import { BudgetExceededError } from '../errors.js';

/** Configuration for agent token budgets including defaults and per-agent overrides. */
export interface BudgetConfig {
  defaultMaxTokensPerHour: number;
  defaultMaxTokensPerDay: number;
  agentOverrides?: Record<string, { maxTokensPerHour: number; maxTokensPerDay: number }>;
}

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  defaultMaxTokensPerHour: 50000,
  defaultMaxTokensPerDay: 200000,
};

/** Tracks per-agent token usage against hourly and daily budgets using SQLite. */
export class BudgetTracker {
  private db: Database.Database;
  private config: BudgetConfig;

  constructor(db: Database.Database, config?: BudgetConfig) {
    this.db = db;
    this.config = config || DEFAULT_BUDGET_CONFIG;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_budgets (
        agent_id TEXT PRIMARY KEY,
        max_tokens_per_hour INTEGER NOT NULL,
        max_tokens_per_day INTEGER NOT NULL,
        current_hour_usage INTEGER NOT NULL DEFAULT 0,
        current_day_usage INTEGER NOT NULL DEFAULT 0,
        last_reset_hour TEXT NOT NULL,
        last_reset_day TEXT NOT NULL
      );
    `);
  }

  private getHourKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}`;
  }

  private getDayKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }

  /** Ensure an agent has a budget row, creating one with defaults if missing. */
  ensureAgent(agentId: string): void {
    const existing = this.db
      .prepare('SELECT agent_id FROM agent_budgets WHERE agent_id = ?')
      .get(agentId);
    if (!existing) {
      const override = this.config.agentOverrides?.[agentId];
      const maxHour = override?.maxTokensPerHour ?? this.config.defaultMaxTokensPerHour;
      const maxDay = override?.maxTokensPerDay ?? this.config.defaultMaxTokensPerDay;
      this.db
        .prepare(
          `INSERT INTO agent_budgets (agent_id, max_tokens_per_hour, max_tokens_per_day, current_hour_usage, current_day_usage, last_reset_hour, last_reset_day)
         VALUES (?, ?, ?, 0, 0, ?, ?)`
        )
        .run(agentId, maxHour, maxDay, this.getHourKey(), this.getDayKey());
    }
  }

  /** Get the current budget state for an agent, resetting counters if the time window has elapsed. */
  getBudget(agentId: string): AgentBudget | undefined {
    this.ensureAgent(agentId);
    this.resetIfNeeded(agentId);
    const row = this.db.prepare('SELECT * FROM agent_budgets WHERE agent_id = ?').get(agentId) as
      | BudgetRow
      | undefined;
    if (!row) return undefined;
    return {
      agentId: row.agent_id,
      maxTokensPerHour: row.max_tokens_per_hour,
      maxTokensPerDay: row.max_tokens_per_day,
      currentHourUsage: row.current_hour_usage,
      currentDayUsage: row.current_day_usage,
      lastResetHour: row.last_reset_hour,
      lastResetDay: row.last_reset_day,
    };
  }

  /** Check whether an agent can consume more tokens. Throws BudgetExceededError if over limit. */
  checkBudget(agentId: string, tokensNeeded: number = 0): void {
    const budget = this.getBudget(agentId);
    if (!budget) return;

    if (budget.currentHourUsage + tokensNeeded > budget.maxTokensPerHour) {
      throw new BudgetExceededError(
        agentId,
        'hourly',
        budget.currentHourUsage + tokensNeeded,
        budget.maxTokensPerHour
      );
    }
    if (budget.currentDayUsage + tokensNeeded > budget.maxTokensPerDay) {
      throw new BudgetExceededError(
        agentId,
        'daily',
        budget.currentDayUsage + tokensNeeded,
        budget.maxTokensPerDay
      );
    }
  }

  /** Record token usage against an agent's hourly and daily counters. */
  recordUsage(agentId: string, tokens: number): void {
    this.ensureAgent(agentId);
    this.resetIfNeeded(agentId);
    this.db
      .prepare(
        `UPDATE agent_budgets SET current_hour_usage = current_hour_usage + ?, current_day_usage = current_day_usage + ? WHERE agent_id = ?`
      )
      .run(tokens, tokens, agentId);
  }

  /** Override the hourly and daily token limits for an agent. */
  setLimits(agentId: string, maxPerHour: number, maxPerDay: number): void {
    this.ensureAgent(agentId);
    this.db
      .prepare(
        `UPDATE agent_budgets SET max_tokens_per_hour = ?, max_tokens_per_day = ? WHERE agent_id = ?`
      )
      .run(maxPerHour, maxPerDay, agentId);
  }

  /** Return all agent budgets. */
  getAllBudgets(): AgentBudget[] {
    const rows = this.db.prepare('SELECT * FROM agent_budgets').all() as BudgetRow[];
    return rows.map((row) => ({
      agentId: row.agent_id,
      maxTokensPerHour: row.max_tokens_per_hour,
      maxTokensPerDay: row.max_tokens_per_day,
      currentHourUsage: row.current_hour_usage,
      currentDayUsage: row.current_day_usage,
      lastResetHour: row.last_reset_hour,
      lastResetDay: row.last_reset_day,
    }));
  }

  private resetIfNeeded(agentId: string): void {
    const row = this.db.prepare('SELECT * FROM agent_budgets WHERE agent_id = ?').get(agentId) as
      | BudgetRow
      | undefined;
    if (!row) return;

    const currentHour = this.getHourKey();
    const currentDay = this.getDayKey();

    if (row.last_reset_hour !== currentHour) {
      this.db
        .prepare(
          `UPDATE agent_budgets SET current_hour_usage = 0, last_reset_hour = ? WHERE agent_id = ?`
        )
        .run(currentHour, agentId);
    }
    if (row.last_reset_day !== currentDay) {
      this.db
        .prepare(
          `UPDATE agent_budgets SET current_day_usage = 0, last_reset_day = ? WHERE agent_id = ?`
        )
        .run(currentDay, agentId);
    }
  }
}

interface BudgetRow {
  agent_id: string;
  max_tokens_per_hour: number;
  max_tokens_per_day: number;
  current_hour_usage: number;
  current_day_usage: number;
  last_reset_hour: string;
  last_reset_day: string;
}
