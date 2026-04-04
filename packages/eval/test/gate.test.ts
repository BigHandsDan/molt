import { describe, it, expect } from 'vitest';
import { ReleaseGate } from '../src/gate/gate.js';
import { makeEvalRun } from './helpers.js';

describe('ReleaseGate', () => {
  it('promotes when all minimums are met', () => {
    const gate = new ReleaseGate({
      requiredMinimums: { 'tool-call-accuracy': 0.7, 'safety-violation': 0.9 },
    });
    const run = makeEvalRun({
      aggregateScores: { 'tool-call-accuracy': 0.9, 'safety-violation': 1.0 },
    });
    const decision = gate.evaluate(run);
    expect(decision.action).toBe('promote');
  });

  it('holds when a minimum is not met', () => {
    const gate = new ReleaseGate({
      requiredMinimums: { 'tool-call-accuracy': 0.95 },
    });
    const run = makeEvalRun({
      aggregateScores: { 'tool-call-accuracy': 0.8 },
    });
    const decision = gate.evaluate(run);
    expect(decision.action).toBe('hold');
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('rolls back on safety violations when blockOnSafetyViolation is true', () => {
    const gate = new ReleaseGate({
      requiredMinimums: {},
      blockOnSafetyViolation: true,
    });
    const run = makeEvalRun({
      aggregateScores: { 'safety-violation': 0.5 },
    });
    const decision = gate.evaluate(run);
    expect(decision.action).toBe('rollback');
  });

  it('does not roll back on safety if blockOnSafetyViolation is false', () => {
    const gate = new ReleaseGate({
      requiredMinimums: {},
      blockOnSafetyViolation: false,
    });
    const run = makeEvalRun({
      aggregateScores: { 'safety-violation': 0.5 },
    });
    const decision = gate.evaluate(run);
    expect(decision.action).toBe('promote');
  });

  it('handles regression counts', () => {
    const gate = new ReleaseGate({
      requiredMinimums: {},
      maxRegressions: { critical: 0 },
    });
    const run = makeEvalRun();
    const report = {
      baselineRunId: 'base',
      currentRunId: run.id,
      regressions: [{ metricName: 'x', baselineScore: 0.9, currentScore: 0.3, delta: -0.6, severity: 'critical' as const }],
      improvements: [],
      stable: [],
      overallStatus: 'critical-regressions' as const,
    };
    const decision = gate.evaluate(run, report);
    expect(decision.action).toBe('rollback');
  });

  it('holds on too many major regressions', () => {
    const gate = new ReleaseGate({
      requiredMinimums: {},
      maxRegressions: { major: 0 },
    });
    const run = makeEvalRun();
    const report = {
      baselineRunId: 'base',
      currentRunId: run.id,
      regressions: [{ metricName: 'x', baselineScore: 0.9, currentScore: 0.7, delta: -0.2, severity: 'major' as const }],
      improvements: [],
      stable: [],
      overallStatus: 'major-regressions' as const,
    };
    const decision = gate.evaluate(run, report);
    expect(decision.action).toBe('hold');
  });

  it('holds on too many minor regressions', () => {
    const gate = new ReleaseGate({
      requiredMinimums: {},
      maxRegressions: { minor: 0 },
    });
    const run = makeEvalRun();
    const report = {
      baselineRunId: 'base',
      currentRunId: run.id,
      regressions: [{ metricName: 'x', baselineScore: 0.9, currentScore: 0.84, delta: -0.06, severity: 'minor' as const }],
      improvements: [],
      stable: [],
      overallStatus: 'minor-regressions' as const,
    };
    const decision = gate.evaluate(run, report);
    expect(decision.action).toBe('hold');
  });

  it('escalates correctly (hold + rollback = rollback)', () => {
    const gate = new ReleaseGate({
      requiredMinimums: { accuracy: 0.99 },
      blockOnSafetyViolation: true,
    });
    const run = makeEvalRun({
      aggregateScores: { accuracy: 0.5, 'safety-violation': 0.5 },
    });
    const decision = gate.evaluate(run);
    expect(decision.action).toBe('rollback');
  });

  it('includes runId and timestamp in decision', () => {
    const gate = new ReleaseGate({ requiredMinimums: {} });
    const run = makeEvalRun({ id: 'my-run' });
    const decision = gate.evaluate(run);
    expect(decision.runId).toBe('my-run');
    expect(decision.timestamp).toBeGreaterThan(0);
  });

  it('reports "All gate checks passed" for clean promote', () => {
    const gate = new ReleaseGate({ requiredMinimums: { x: 0.5 } });
    const run = makeEvalRun({ aggregateScores: { x: 0.9 } });
    const decision = gate.evaluate(run);
    expect(decision.reasons).toContain('All gate checks passed.');
  });
});
