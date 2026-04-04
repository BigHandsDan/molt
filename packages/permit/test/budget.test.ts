import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { BudgetTracker } from '../src/credentials/budget-tracker';

describe('BudgetTracker', () => {
  let db: Database.Database;
  let tracker: BudgetTracker;

  beforeEach(() => {
    db = new Database(':memory:');
    tracker = new BudgetTracker(db);
  });

  it('should allow actions when no budget is configured', () => {
    const result = tracker.check('agent-1', 'some-action');
    expect(result.allowed).toBe(true);
  });

  it('should enforce lifetime budget limits', () => {
    tracker.setBudget('read', { perAgent: 3 });

    // First 3 should be allowed
    for (let i = 0; i < 3; i++) {
      expect(tracker.check('agent-1', 'read').allowed).toBe(true);
      tracker.record('agent-1', 'read');
    }

    // 4th should be denied
    const result = tracker.check('agent-1', 'read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Lifetime budget exhausted');
  });

  it('should track budgets per agent independently', () => {
    tracker.setBudget('read', { perAgent: 2 });

    tracker.record('agent-1', 'read');
    tracker.record('agent-1', 'read');

    // Agent 1 exhausted
    expect(tracker.check('agent-1', 'read').allowed).toBe(false);

    // Agent 2 still has budget
    expect(tracker.check('agent-2', 'read').allowed).toBe(true);
  });

  it('should enforce per-hour budget limits', () => {
    tracker.setBudget('write', { perAgent: 100, perHour: 2 });

    tracker.record('agent-1', 'write');
    tracker.record('agent-1', 'write');

    const result = tracker.check('agent-1', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Hourly budget exhausted');
  });

  it('should enforce per-day budget limits', () => {
    tracker.setBudget('execute', { perAgent: 100, perDay: 2 });

    tracker.record('agent-1', 'execute');
    tracker.record('agent-1', 'execute');

    const result = tracker.check('agent-1', 'execute');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily budget exhausted');
  });

  it('should enforce max value per action', () => {
    tracker.setBudget('refund', { perAgent: 100, maxValuePerAction: 50 });

    const result = tracker.check('agent-1', 'refund', 75);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds max per-action value');
  });

  it('should allow value under max', () => {
    tracker.setBudget('refund', { perAgent: 100, maxValuePerAction: 50 });

    const result = tracker.check('agent-1', 'refund', 25);
    expect(result.allowed).toBe(true);
  });

  it('should return remaining budget info', () => {
    tracker.setBudget('read', { perAgent: 10, perHour: 5 });

    tracker.record('agent-1', 'read');
    tracker.record('agent-1', 'read');

    const result = tracker.check('agent-1', 'read');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeDefined();
    expect(result.remaining!.lifetime).toBe(8);
    expect(result.remaining!.hourly).toBe(3);
  });

  it('should report usage via getUsage', () => {
    tracker.setBudget('read', { perAgent: 10 });
    tracker.setBudget('write', { perAgent: 5 });

    tracker.record('agent-1', 'read');
    tracker.record('agent-1', 'read');
    tracker.record('agent-1', 'write');

    const usage = tracker.getUsage('agent-1');
    expect(usage.read.used).toBe(2);
    expect(usage.read.limit).toBe(10);
    expect(usage.write.used).toBe(1);
    expect(usage.write.limit).toBe(5);
  });

  it('should set multiple budgets at once', () => {
    tracker.setBudgets({
      'tools/call': { perAgent: 100, perHour: 50 },
      'tools/dangerous': { perAgent: 10, perHour: 5 },
    });

    const result1 = tracker.check('agent-1', 'tools/call');
    expect(result1.allowed).toBe(true);

    const result2 = tracker.check('agent-1', 'tools/dangerous');
    expect(result2.allowed).toBe(true);
  });
});
