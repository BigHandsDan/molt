import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EvalStore } from '../src/store/store.js';
import { makeEvalRun } from './helpers.js';

describe('EvalStore', () => {
  let store: EvalStore;

  beforeEach(() => {
    store = new EvalStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('saves and retrieves an eval run', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    const retrieved = store.getRun(run.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(run.id);
    expect(retrieved!.suiteName).toBe(run.suiteName);
    expect(retrieved!.verdict).toBe(run.verdict);
  });

  it('returns null for non-existent run', () => {
    expect(store.getRun('nonexistent')).toBeNull();
  });

  it('retrieves case results for a run', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    const retrieved = store.getRun(run.id);
    expect(retrieved!.caseResults).toHaveLength(1);
    expect(retrieved!.caseResults[0].caseId).toBe('case-1');
  });

  it('retrieves metric scores for a case', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    const retrieved = store.getRun(run.id);
    const metrics = retrieved!.caseResults[0].metricResults;
    expect(metrics['tool-call-accuracy']).toBeDefined();
    expect(metrics['tool-call-accuracy'].score).toBe(0.9);
  });

  it('preserves aggregate scores', () => {
    const run = makeEvalRun({ aggregateScores: { a: 0.9, b: 0.8 } });
    store.saveRun(run);
    const retrieved = store.getRun(run.id);
    expect(retrieved!.aggregateScores).toEqual({ a: 0.9, b: 0.8 });
  });

  it('lists runs', () => {
    store.saveRun(makeEvalRun({ id: 'run-1' }));
    store.saveRun(makeEvalRun({ id: 'run-2' }));
    const runs = store.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('lists runs filtered by suite', () => {
    store.saveRun(makeEvalRun({ id: 'r1', suiteId: 'suite-a' }));
    store.saveRun(makeEvalRun({ id: 'r2', suiteId: 'suite-b' }));
    const runs = store.listRuns('suite-a');
    expect(runs).toHaveLength(1);
  });

  it('deletes a run and associated data', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    expect(store.deleteRun(run.id)).toBe(true);
    expect(store.getRun(run.id)).toBeNull();
  });

  it('returns false deleting non-existent run', () => {
    expect(store.deleteRun('nope')).toBe(false);
  });

  it('saves and retrieves regression reports', () => {
    const report = {
      baselineRunId: 'base',
      currentRunId: 'curr',
      regressions: [],
      improvements: [],
      stable: [],
      overallStatus: 'clean' as const,
    };
    store.saveRegressionReport(report);
    const retrieved = store.getRegressionReports('curr');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].overallStatus).toBe('clean');
  });

  it('saves and retrieves gate decisions', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    const decision = {
      action: 'promote' as const,
      reasons: ['All good'],
      runId: run.id,
      timestamp: Date.now(),
    };
    store.saveGateDecision(decision);
    const retrieved = store.getGateDecisions(run.id);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].action).toBe('promote');
  });

  it('handles multiple gate decisions for same run', () => {
    const run = makeEvalRun();
    store.saveRun(run);
    store.saveGateDecision({ action: 'hold', reasons: ['Wait'], runId: run.id, timestamp: Date.now() });
    store.saveGateDecision({ action: 'promote', reasons: ['OK now'], runId: run.id, timestamp: Date.now() + 1 });
    const retrieved = store.getGateDecisions(run.id);
    expect(retrieved).toHaveLength(2);
  });

  it('limits listed runs', () => {
    for (let i = 0; i < 10; i++) {
      store.saveRun(makeEvalRun({ id: `run-${i}` }));
    }
    const runs = store.listRuns(undefined, 5);
    expect(runs).toHaveLength(5);
  });
});
