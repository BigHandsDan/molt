import { describe, it, expect, afterEach } from 'vitest';
import { MoltEval } from '../src/molteval.js';
import { makeSuite, makeEvalCase, makeTrace, makeToolCall } from './helpers.js';

describe('MoltEval', () => {
  let molteval: MoltEval;

  afterEach(() => {
    molteval?.close();
  });

  it('creates with default configuration', () => {
    molteval = new MoltEval();
    expect(molteval.registry.size).toBe(7);
  });

  it('creates without default metrics', () => {
    molteval = new MoltEval({ includeDefaultMetrics: false });
    expect(molteval.registry.size).toBe(0);
  });

  it('runs a suite and stores the result', async () => {
    molteval = new MoltEval();
    const suite = makeSuite();
    const run = await molteval.run(suite);
    expect(run.id).toBeTruthy();
    expect(run.verdict).toBeDefined();

    const stored = molteval.getRun(run.id);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(run.id);
  });

  it('lists runs', async () => {
    molteval = new MoltEval();
    await molteval.run(makeSuite({ name: 'suite-a' }));
    await molteval.run(makeSuite({ name: 'suite-b' }));
    const runs = molteval.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('compares two runs for regressions', async () => {
    molteval = new MoltEval();
    const tc = makeToolCall({ name: 'readFile', arguments: { path: '/a' } });
    const goodSuite = makeSuite({
      cases: [makeEvalCase({ trace: makeTrace({ success: true, expectedToolCalls: [tc], actualToolCalls: [tc] }) })],
    });
    const badSuite = makeSuite({
      cases: [makeEvalCase({ trace: makeTrace({ success: false, expectedToolCalls: [tc], actualToolCalls: [] }) })],
    });

    const baseline = await molteval.run(goodSuite);
    const current = await molteval.run(badSuite);
    const report = molteval.compareRuns(baseline.id, current.id);

    expect(report).not.toBeNull();
    expect(report!.baselineRunId).toBe(baseline.id);
    expect(report!.currentRunId).toBe(current.id);
  });

  it('returns null when comparing non-existent runs', () => {
    molteval = new MoltEval();
    expect(molteval.compareRuns('nope1', 'nope2')).toBeNull();
  });

  it('evaluates a gate for a run', async () => {
    molteval = new MoltEval();
    const suite = makeSuite();
    const run = await molteval.run(suite);
    const decision = molteval.gate(run.id);
    expect(decision).not.toBeNull();
    expect(['promote', 'hold', 'rollback']).toContain(decision!.action);
  });

  it('returns null gating non-existent run', () => {
    molteval = new MoltEval();
    expect(molteval.gate('nope')).toBeNull();
  });

  it('runs with adapter', async () => {
    molteval = new MoltEval();
    const suite = makeSuite();
    const adapter = async () => makeTrace({ success: true });
    const run = await molteval.runWithAdapter(suite, adapter);
    expect(run.id).toBeTruthy();
  });

  it('gate with safety block override', async () => {
    molteval = new MoltEval();
    const suite = makeSuite({
      cases: [makeEvalCase({ trace: makeTrace({ safetyViolations: ['injection'] }) })],
    });
    const run = await molteval.run(suite);
    const decision = molteval.gate(run.id, {
      blockOnSafetyViolation: true,
      requiredMinimums: {},
    });
    expect(decision!.action).toBe('rollback');
  });

  it('gate uses reasonable default minimums instead of run scores', async () => {
    molteval = new MoltEval();
    // Run with perfect scores — should still use default thresholds, not the run's own scores
    const tc = makeToolCall({ name: 'a', arguments: { x: 1 } });
    const suite = makeSuite({
      cases: [makeEvalCase({
        trace: makeTrace({
          success: true,
          safetyViolations: [],
          expectedToolCalls: [tc],
          actualToolCalls: [tc],
        }),
      })],
      thresholds: { 'safety-violation': 1.0, 'tool-call-accuracy': 0.5 },
    });
    const run = await molteval.run(suite);
    const decision = molteval.gate(run.id);
    expect(decision).not.toBeNull();
    // With good scores and reasonable defaults, should promote
    expect(decision!.action).toBe('promote');
  });

  it('gate with default minimums can hold on low scores', async () => {
    molteval = new MoltEval();
    const suite = makeSuite({
      cases: [makeEvalCase({
        trace: makeTrace({
          success: false,
          safetyViolations: ['injection'],
          expectedToolCalls: [makeToolCall({ name: 'a' })],
          actualToolCalls: [makeToolCall({ name: 'b' })],
        }),
      })],
      thresholds: { 'safety-violation': 1.0, 'tool-call-accuracy': 0.9 },
    });
    const run = await molteval.run(suite);
    const decision = molteval.gate(run.id);
    expect(decision).not.toBeNull();
    // Safety violation score=0 < default minimum 1.0, so should hold or rollback
    expect(['hold', 'rollback']).toContain(decision!.action);
  });
});
