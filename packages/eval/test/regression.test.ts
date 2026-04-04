import { describe, it, expect } from 'vitest';
import { RegressionDetector } from '../src/regression/detector.js';
import { makeEvalRun } from './helpers.js';

describe('RegressionDetector', () => {
  const detector = new RegressionDetector();

  it('detects no regressions for identical runs', () => {
    const run = makeEvalRun();
    const report = detector.compare(run, { ...run, id: 'run-2' });
    expect(report.regressions).toHaveLength(0);
    expect(report.overallStatus).toBe('clean');
  });

  it('detects minor regression', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.84 } });
    const report = detector.compare(baseline, current);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0].severity).toBe('minor');
    expect(report.overallStatus).toBe('minor-regressions');
  });

  it('detects major regression', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.7 } });
    const report = detector.compare(baseline, current);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0].severity).toBe('major');
    expect(report.overallStatus).toBe('major-regressions');
  });

  it('detects critical regression', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.5 } });
    const report = detector.compare(baseline, current);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0].severity).toBe('critical');
    expect(report.overallStatus).toBe('critical-regressions');
  });

  it('detects improvements', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.7 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.9 } });
    const report = detector.compare(baseline, current);
    expect(report.improvements).toHaveLength(1);
    expect(report.improvements[0].delta).toBeGreaterThan(0);
  });

  it('detects stable metrics', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.89 } });
    const report = detector.compare(baseline, current);
    expect(report.stable).toHaveLength(1);
  });

  it('handles multiple metrics', () => {
    const baseline = makeEvalRun({ aggregateScores: { a: 0.9, b: 0.8, c: 0.7 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { a: 0.5, b: 0.85, c: 0.7 } });
    const report = detector.compare(baseline, current);
    expect(report.regressions.length).toBeGreaterThanOrEqual(1);
    expect(report.improvements.length + report.stable.length).toBeGreaterThanOrEqual(1);
  });

  it('uses custom tolerances', () => {
    const strict = new RegressionDetector({ minor: 0.01, major: 0.05, critical: 0.1 });
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.88 } });
    const report = strict.compare(baseline, current);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0].severity).toBe('minor');
  });

  it('handles new metrics in current run', () => {
    const baseline = makeEvalRun({ aggregateScores: { accuracy: 0.9 } });
    const current = makeEvalRun({ id: 'run-2', aggregateScores: { accuracy: 0.9, newMetric: 0.8 } });
    const report = detector.compare(baseline, current);
    expect(report.improvements.length + report.stable.length + report.regressions.length).toBe(2);
  });

  it('populates report IDs correctly', () => {
    const baseline = makeEvalRun({ id: 'base-123' });
    const current = makeEvalRun({ id: 'curr-456' });
    const report = detector.compare(baseline, current);
    expect(report.baselineRunId).toBe('base-123');
    expect(report.currentRunId).toBe('curr-456');
  });
});
