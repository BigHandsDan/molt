import { describe, it, expect } from 'vitest';
import { EvalRunner } from '../src/runner/runner.js';
import { MetricRegistry } from '../src/metrics/registry.js';
import { makeEvalCase, makeSuite, makeTrace, makeToolCall } from './helpers.js';

describe('EvalRunner', () => {
  it('runs a suite with static traces and produces results', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite();
    const run = await runner.run(suite);

    expect(run.id).toBeTruthy();
    expect(run.suiteName).toBe('test-suite');
    expect(run.caseResults).toHaveLength(1);
    expect(run.aggregateScores).toBeDefined();
    expect(['pass', 'warn', 'fail']).toContain(run.verdict);
  });

  it('runs multiple cases', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite({
      cases: [
        makeEvalCase({ id: 'c1', name: 'Case 1' }),
        makeEvalCase({ id: 'c2', name: 'Case 2' }),
        makeEvalCase({ id: 'c3', name: 'Case 3' }),
      ],
    });
    const run = await runner.run(suite);
    expect(run.caseResults).toHaveLength(3);
  });

  it('computes aggregate scores across cases', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite({
      cases: [
        makeEvalCase({ id: 'c1', trace: makeTrace({ success: true, safetyViolations: [] }) }),
        makeEvalCase({ id: 'c2', trace: makeTrace({ success: true, safetyViolations: [] }) }),
      ],
    });
    const run = await runner.run(suite);
    expect(run.aggregateScores['safety-violation']).toBe(1);
  });

  it('passes verdict as pass when thresholds are met', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const tc = makeToolCall({ name: 'a', arguments: { x: 1 } });
    const suite = makeSuite({
      cases: [
        makeEvalCase({
          id: 'c1',
          trace: makeTrace({
            success: true,
            safetyViolations: [],
            expectedToolCalls: [tc],
            actualToolCalls: [tc],
          }),
        }),
      ],
      thresholds: { 'safety-violation': 1.0, 'tool-call-accuracy': 0.5 },
    });
    const run = await runner.run(suite);
    expect(run.verdict).toBe('pass');
  });

  it('fails when thresholds are not met', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite({
      cases: [
        makeEvalCase({
          id: 'c1',
          trace: makeTrace({
            success: false,
            safetyViolations: ['injection'],
            expectedToolCalls: [makeToolCall({ name: 'a' })],
            actualToolCalls: [makeToolCall({ name: 'b' })],
          }),
        }),
      ],
      thresholds: { 'safety-violation': 1.0, 'tool-call-accuracy': 0.9 },
    });
    const run = await runner.run(suite);
    expect(run.verdict).toBe('fail');
  });

  it('uses specific metrics when metricNames provided', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite({
      metricNames: ['safety-violation', 'latency'],
      thresholds: { 'safety-violation': 1.0 },
    });
    const run = await runner.run(suite);
    const metricNames = Object.keys(run.caseResults[0].metricResults);
    expect(metricNames).toContain('safety-violation');
    expect(metricNames).toContain('latency');
    expect(metricNames).not.toContain('tool-call-accuracy');
  });

  it('runs with an agent adapter', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: false });
    const adapter = async () => makeTrace({ success: true });
    const suite = makeSuite();
    const run = await runner.run(suite, adapter);
    expect(run.caseResults).toHaveLength(1);
  });

  it('handles adapter timeout', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: false, timeoutMs: 50 });
    const adapter = () => new Promise<ReturnType<typeof makeTrace>>((resolve) => {
      setTimeout(() => resolve(makeTrace()), 200);
    });
    const suite = makeSuite();
    const run = await runner.run(suite, adapter);
    expect(run.caseResults[0].error).toContain('Timeout');
    expect(run.caseResults[0].passed).toBe(false);
  });

  it('handles adapter errors gracefully', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: false });
    const adapter = async () => { throw new Error('Agent crashed'); };
    const suite = makeSuite();
    const run = await runner.run(suite, adapter);
    expect(run.caseResults[0].error).toBe('Agent crashed');
    expect(run.caseResults[0].passed).toBe(false);
  });

  it('produces a run with durationMs', async () => {
    const registry = new MetricRegistry(true);
    const runner = new EvalRunner(registry, { useStaticTraces: true });
    const suite = makeSuite();
    const run = await runner.run(suite);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });
});
