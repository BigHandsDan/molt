import { describe, it, expect } from 'vitest';
import {
  ToolCallAccuracy,
  ToolCallSequence,
  PolicyAdherence,
  TaskCompletion,
  Latency,
  CostEfficiency,
  SafetyViolation,
  createDefaultMetrics,
} from '../src/metrics/builtin.js';
import { MetricRegistry } from '../src/metrics/registry.js';
import { makeTrace, makeToolCall } from './helpers.js';

describe('ToolCallAccuracy', () => {
  const metric = new ToolCallAccuracy();

  it('scores 1.0 when all expected calls match', async () => {
    const tc = makeToolCall({ name: 'readFile', arguments: { path: '/a' } });
    const trace = makeTrace({ expectedToolCalls: [tc], actualToolCalls: [tc] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('scores 0 when no calls match', async () => {
    const trace = makeTrace({
      expectedToolCalls: [makeToolCall({ name: 'readFile' })],
      actualToolCalls: [makeToolCall({ name: 'writeFile' })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('scores partial match correctly', async () => {
    const tc1 = makeToolCall({ name: 'readFile', arguments: { path: '/a' } });
    const tc2 = makeToolCall({ name: 'writeFile', arguments: { path: '/b' } });
    const trace = makeTrace({
      expectedToolCalls: [tc1, tc2],
      actualToolCalls: [tc1, makeToolCall({ name: 'deleteFile' })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0.5);
  });

  it('handles no expected calls gracefully', async () => {
    const trace = makeTrace({ expectedToolCalls: [], actualToolCalls: [] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('handles mismatched arguments', async () => {
    const trace = makeTrace({
      expectedToolCalls: [makeToolCall({ name: 'readFile', arguments: { path: '/a' } })],
      actualToolCalls: [makeToolCall({ name: 'readFile', arguments: { path: '/b' } })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0);
  });
});

describe('ToolCallSequence', () => {
  const metric = new ToolCallSequence();

  it('scores 1.0 for perfect sequence', async () => {
    const calls = [makeToolCall({ name: 'a' }), makeToolCall({ name: 'b' }), makeToolCall({ name: 'c' })];
    const trace = makeTrace({ expectedToolCalls: calls, actualToolCalls: calls });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores partial for reversed sequence', async () => {
    const expected = [makeToolCall({ name: 'a' }), makeToolCall({ name: 'b' }), makeToolCall({ name: 'c' })];
    const actual = [makeToolCall({ name: 'c' }), makeToolCall({ name: 'b' }), makeToolCall({ name: 'a' })];
    const trace = makeTrace({ expectedToolCalls: expected, actualToolCalls: actual });
    const result = await metric.evaluate(trace);
    expect(result.score).toBeCloseTo(1 / 3, 1);
  });

  it('handles empty expected sequence', async () => {
    const trace = makeTrace({ expectedToolCalls: [], actualToolCalls: [] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });
});

describe('PolicyAdherence', () => {
  const metric = new PolicyAdherence();

  it('scores 1.0 with no policy decisions', async () => {
    const trace = makeTrace({ policyDecisions: [] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores 1.0 when denied actions were not called', async () => {
    const trace = makeTrace({
      policyDecisions: [{ action: 'deleteDB', decision: 'deny', reason: 'not allowed' }],
      actualToolCalls: [makeToolCall({ name: 'readFile' })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('detects policy violations', async () => {
    const trace = makeTrace({
      policyDecisions: [{ action: 'deleteDB', decision: 'deny', reason: 'not allowed' }],
      actualToolCalls: [makeToolCall({ name: 'deleteDB' })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBeLessThan(1);
  });
});

describe('TaskCompletion', () => {
  const metric = new TaskCompletion();

  it('scores 1.0 for successful task with all tools completed', async () => {
    const tc = makeToolCall({ name: 'doTask' });
    const trace = makeTrace({ success: true, expectedToolCalls: [tc], actualToolCalls: [tc] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores 0.5 for successful task with no expected tools', async () => {
    const trace = makeTrace({ success: true, expectedToolCalls: undefined });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores 0 for failed task with no tools completed', async () => {
    const trace = makeTrace({
      success: false,
      expectedToolCalls: [makeToolCall({ name: 'a' })],
      actualToolCalls: [makeToolCall({ name: 'b' })],
    });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0);
  });
});

describe('Latency', () => {
  it('scores 1.0 when under budget', async () => {
    const metric = new Latency(10000);
    const now = Date.now();
    const trace = makeTrace({ startTime: now, endTime: now + 5000 });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores below 1 when over budget', async () => {
    const metric = new Latency(5000);
    const now = Date.now();
    const trace = makeTrace({ startTime: now, endTime: now + 8000 });
    const result = await metric.evaluate(trace);
    expect(result.score).toBeLessThan(1);
    expect(result.score).toBeGreaterThan(0);
  });

  it('scores 0 when way over budget', async () => {
    const metric = new Latency(1000);
    const now = Date.now();
    const trace = makeTrace({ startTime: now, endTime: now + 100000 });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0);
  });
});

describe('CostEfficiency', () => {
  it('scores 1.0 when under token budget', async () => {
    const metric = new CostEfficiency(10000);
    const trace = makeTrace({ tokenUsage: { inputTokens: 3000, outputTokens: 2000 } });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
  });

  it('scores below 1 when over budget', async () => {
    const metric = new CostEfficiency(1000);
    const trace = makeTrace({ tokenUsage: { inputTokens: 800, outputTokens: 500 } });
    const result = await metric.evaluate(trace);
    expect(result.score).toBeLessThan(1);
  });
});

describe('SafetyViolation', () => {
  const metric = new SafetyViolation();

  it('scores 1.0 with no violations', async () => {
    const trace = makeTrace({ safetyViolations: [] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('scores 0 with violations', async () => {
    const trace = makeTrace({ safetyViolations: ['prompt-injection'] });
    const result = await metric.evaluate(trace);
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });
});

describe('createDefaultMetrics', () => {
  it('returns 7 built-in metrics', () => {
    const metrics = createDefaultMetrics();
    expect(metrics).toHaveLength(7);
  });
});

describe('MetricRegistry', () => {
  it('includes defaults when created with includeDefaults=true', () => {
    const registry = new MetricRegistry(true);
    expect(registry.size).toBe(7);
  });

  it('is empty when created with includeDefaults=false', () => {
    const registry = new MetricRegistry(false);
    expect(registry.size).toBe(0);
  });

  it('registers and retrieves custom metrics', () => {
    const registry = new MetricRegistry(false);
    const metric = new ToolCallAccuracy();
    registry.register(metric);
    expect(registry.get('tool-call-accuracy')).toBe(metric);
  });

  it('unregisters metrics', () => {
    const registry = new MetricRegistry(false);
    registry.register(new ToolCallAccuracy());
    expect(registry.unregister('tool-call-accuracy')).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('filters by category', () => {
    const registry = new MetricRegistry(true);
    const toolCallMetrics = registry.getByCategory('tool-call');
    expect(toolCallMetrics.length).toBe(2);
  });

  it('lists all metric names', () => {
    const registry = new MetricRegistry(true);
    const names = registry.listNames();
    expect(names).toContain('tool-call-accuracy');
    expect(names).toContain('safety-violation');
  });

  it('overwrites on re-register', () => {
    const registry = new MetricRegistry(false);
    registry.register(new ToolCallAccuracy());
    registry.register(new ToolCallAccuracy());
    expect(registry.size).toBe(1);
  });
});
