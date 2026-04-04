import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BudgetTracker } from '../src/policy/budget.js';
import { BudgetExceededError } from '../src/errors.js';

describe('BudgetTracker', () => {
  let db: Database.Database;
  let tracker: BudgetTracker;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    tracker = new BudgetTracker(db, {
      defaultMaxTokensPerHour: 1000,
      defaultMaxTokensPerDay: 5000,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('should create a budget record for a new agent', () => {
    tracker.ensureAgent('agent-1');
    const budget = tracker.getBudget('agent-1');
    expect(budget).toBeDefined();
    expect(budget!.agentId).toBe('agent-1');
    expect(budget!.maxTokensPerHour).toBe(1000);
    expect(budget!.maxTokensPerDay).toBe(5000);
    expect(budget!.currentHourUsage).toBe(0);
    expect(budget!.currentDayUsage).toBe(0);
  });

  it('should record token usage', () => {
    tracker.ensureAgent('agent-1');
    tracker.recordUsage('agent-1', 200);
    const budget = tracker.getBudget('agent-1');
    expect(budget!.currentHourUsage).toBe(200);
    expect(budget!.currentDayUsage).toBe(200);
  });

  it('should accumulate usage over multiple recordings', () => {
    tracker.ensureAgent('agent-1');
    tracker.recordUsage('agent-1', 200);
    tracker.recordUsage('agent-1', 300);
    const budget = tracker.getBudget('agent-1');
    expect(budget!.currentHourUsage).toBe(500);
    expect(budget!.currentDayUsage).toBe(500);
  });

  it('should throw BudgetExceededError when hourly limit exceeded', () => {
    tracker.ensureAgent('agent-1');
    tracker.recordUsage('agent-1', 800);
    expect(() => tracker.checkBudget('agent-1', 300)).toThrow(BudgetExceededError);
  });

  it('should throw BudgetExceededError when daily limit exceeded', () => {
    tracker.ensureAgent('agent-1');
    tracker.recordUsage('agent-1', 4800);
    expect(() => tracker.checkBudget('agent-1', 300)).toThrow(BudgetExceededError);
  });

  it('should not throw when within budget', () => {
    tracker.ensureAgent('agent-1');
    tracker.recordUsage('agent-1', 500);
    expect(() => tracker.checkBudget('agent-1', 400)).not.toThrow();
  });

  it('should allow overriding limits per agent', () => {
    tracker.ensureAgent('agent-1');
    tracker.setLimits('agent-1', 500, 2000);
    const budget = tracker.getBudget('agent-1');
    expect(budget!.maxTokensPerHour).toBe(500);
    expect(budget!.maxTokensPerDay).toBe(2000);
  });

  it('should support agent-specific config overrides', () => {
    const customTracker = new BudgetTracker(db, {
      defaultMaxTokensPerHour: 1000,
      defaultMaxTokensPerDay: 5000,
      agentOverrides: { 'special-agent': { maxTokensPerHour: 99, maxTokensPerDay: 199 } },
    });
    customTracker.ensureAgent('special-agent');
    const budget = customTracker.getBudget('special-agent');
    expect(budget!.maxTokensPerHour).toBe(99);
    expect(budget!.maxTokensPerDay).toBe(199);
  });

  it('should list all budgets', () => {
    tracker.ensureAgent('agent-1');
    tracker.ensureAgent('agent-2');
    tracker.recordUsage('agent-1', 100);
    const budgets = tracker.getAllBudgets();
    expect(budgets.length).toBe(2);
  });

  it('should not duplicate agents on repeated ensureAgent calls', () => {
    tracker.ensureAgent('agent-1');
    tracker.ensureAgent('agent-1');
    const budgets = tracker.getAllBudgets();
    expect(budgets.length).toBe(1);
  });
});
