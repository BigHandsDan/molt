import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CostAccountant } from '../src/cost/accounting.js';

describe('CostAccountant', () => {
  let db: Database.Database;
  let accountant: CostAccountant;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    accountant = new CostAccountant(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should calculate cost for known model', () => {
    const cost = accountant.calculateCost(1000, 500, 'gpt-4');
    // gpt-4: input $0.03/1k, output $0.06/1k
    // 1000 * 0.03/1000 + 500 * 0.06/1000 = 0.03 + 0.03 = 0.06
    expect(cost).toBeCloseTo(0.06, 4);
  });

  it('should use default pricing for unknown model', () => {
    const cost = accountant.calculateCost(1000, 1000);
    // default: input $0.01/1k, output $0.03/1k
    expect(cost).toBeCloseTo(0.04, 4);
  });

  it('should record a cost step', () => {
    const step = accountant.recordStep({
      traceId: 'trace-1',
      spanId: 'span-1',
      agentId: 'agent-1',
      contractId: 'research',
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
      timestamp: new Date().toISOString(),
    });
    expect(step.estimatedCost).toBeGreaterThan(0);
  });

  it('should get trace cost summary', () => {
    accountant.recordStep({
      traceId: 'trace-1',
      spanId: 'span-1',
      agentId: 'agent-1',
      contractId: 'research',
      inputTokens: 100,
      outputTokens: 50,
      timestamp: new Date().toISOString(),
    });
    accountant.recordStep({
      traceId: 'trace-1',
      spanId: 'span-2',
      agentId: 'agent-2',
      contractId: 'review',
      inputTokens: 200,
      outputTokens: 100,
      timestamp: new Date().toISOString(),
    });
    const summary = accountant.getTraceCost('trace-1');
    expect(summary.traceId).toBe('trace-1');
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(150);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.steps.length).toBe(2);
  });

  it('should get agent spend summary', () => {
    accountant.recordStep({
      traceId: 'trace-1',
      spanId: 'span-1',
      agentId: 'agent-1',
      contractId: 'research',
      inputTokens: 100,
      outputTokens: 50,
      timestamp: new Date().toISOString(),
    });
    accountant.recordStep({
      traceId: 'trace-2',
      spanId: 'span-2',
      agentId: 'agent-1',
      contractId: 'research',
      inputTokens: 200,
      outputTokens: 100,
      timestamp: new Date().toISOString(),
    });
    const spend = accountant.getAgentSpend('agent-1');
    expect(spend.agentId).toBe('agent-1');
    expect(spend.totalInputTokens).toBe(300);
    expect(spend.totalOutputTokens).toBe(150);
    expect(spend.invocationCount).toBe(2);
    expect(spend.avgTokensPerInvocation).toBe(225);
  });

  it('should return zero for unknown agent spend', () => {
    const spend = accountant.getAgentSpend('unknown');
    expect(spend.totalCost).toBe(0);
    expect(spend.invocationCount).toBe(0);
  });

  it('should return empty trace cost for unknown trace', () => {
    const summary = accountant.getTraceCost('unknown');
    expect(summary.totalCost).toBe(0);
    expect(summary.steps.length).toBe(0);
  });

  it('should get all agent spend summaries', () => {
    accountant.recordStep({
      traceId: 'trace-1',
      spanId: 'span-1',
      agentId: 'agent-1',
      contractId: 'research',
      inputTokens: 100,
      outputTokens: 50,
      timestamp: new Date().toISOString(),
    });
    accountant.recordStep({
      traceId: 'trace-2',
      spanId: 'span-2',
      agentId: 'agent-2',
      contractId: 'review',
      inputTokens: 200,
      outputTokens: 100,
      timestamp: new Date().toISOString(),
    });
    const all = accountant.getAllAgentSpend();
    expect(all.length).toBe(2);
  });

  it('should use model-specific pricing', () => {
    const cost35 = accountant.calculateCost(1000, 1000, 'gpt-3.5-turbo');
    const cost4 = accountant.calculateCost(1000, 1000, 'gpt-4');
    expect(cost4).toBeGreaterThan(cost35);
  });
});
