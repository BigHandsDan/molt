import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EvalStore } from '../src/store/store.js';
import { AgentObserver } from '../src/observability/self-report.js';
import { makeEvalRun } from './helpers.js';

describe('AgentObserver', () => {
  let store: EvalStore;
  let observer: AgentObserver;

  beforeEach(() => {
    store = new EvalStore(':memory:');
    observer = new AgentObserver(store);
  });

  afterEach(() => {
    store.close();
  });

  describe('generateReport', () => {
    it('returns empty report for agent with no runs', () => {
      const report = observer.generateReport('agent-unknown');
      expect(report.agentId).toBe('agent-unknown');
      expect(report.evalSummary.totalRuns).toBe(0);
      expect(report.evalSummary.passRate).toBe(0);
      expect(report.evalSummary.recentTrend).toBe('stable');
      expect(report.evalSummary.lastRunVerdict).toBe('none');
      expect(report.latency.p50).toBe(0);
      expect(report.topFailures).toHaveLength(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('generates report with correct pass rate', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', verdict: 'pass', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-1', verdict: 'fail', timestamp: 2000 }));
      store.saveRun(makeEvalRun({ id: 'r3', agentId: 'agent-1', verdict: 'pass', timestamp: 3000 }));
      store.saveRun(makeEvalRun({ id: 'r4', agentId: 'agent-1', verdict: 'pass', timestamp: 4000 }));

      const report = observer.generateReport('agent-1');
      expect(report.evalSummary.totalRuns).toBe(4);
      expect(report.evalSummary.passRate).toBe(0.75);
    });

    it('includes correct last run info', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', verdict: 'pass', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-1', verdict: 'fail', timestamp: 2000 }));

      const report = observer.generateReport('agent-1');
      expect(report.evalSummary.lastRunVerdict).toBe('fail');
      expect(report.evalSummary.lastRunTimestamp).toBe(2000);
    });

    it('computes average scores across runs', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { 'tool-call-accuracy': 0.8, 'safety-violation': 1.0 },
      }));
      store.saveRun(makeEvalRun({
        id: 'r2', agentId: 'agent-1', timestamp: 2000,
        aggregateScores: { 'tool-call-accuracy': 0.6, 'safety-violation': 0.8 },
      }));

      const report = observer.generateReport('agent-1');
      expect(report.evalSummary.avgScores['tool-call-accuracy']).toBeCloseTo(0.7);
      expect(report.evalSummary.avgScores['safety-violation']).toBeCloseTo(0.9);
    });

    it('computes latency percentiles', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        caseResults: [
          { caseId: 'c1', caseName: 'C1', passed: true, durationMs: 100, metricResults: {} },
          { caseId: 'c2', caseName: 'C2', passed: true, durationMs: 200, metricResults: {} },
        ],
      }));

      const report = observer.generateReport('agent-1');
      expect(report.latency.p50).toBeGreaterThan(0);
    });

    it('excludes recommendations when includeRecommendations is false', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', verdict: 'fail', timestamp: 1000 }));

      const report = observer.generateReport('agent-1', { includeRecommendations: false });
      expect(report.recommendations).toHaveLength(0);
    });

    it('respects maxRuns option', () => {
      for (let i = 0; i < 10; i++) {
        store.saveRun(makeEvalRun({ id: `r${i}`, agentId: 'agent-1', timestamp: i * 1000 }));
      }

      const report = observer.generateReport('agent-1', { maxRuns: 3 });
      expect(report.evalSummary.totalRuns).toBe(3);
    });

    it('only includes runs for the specified agent', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-2', timestamp: 2000 }));
      store.saveRun(makeEvalRun({ id: 'r3', agentId: 'agent-1', timestamp: 3000 }));

      const report = observer.generateReport('agent-1');
      expect(report.evalSummary.totalRuns).toBe(2);
    });
  });

  describe('getTrend', () => {
    it('returns stable for agent with no runs', () => {
      expect(observer.getTrend('agent-none')).toBe('stable');
    });

    it('returns stable for agent with one run', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', timestamp: 1000 }));
      expect(observer.getTrend('agent-1')).toBe('stable');
    });

    it('detects improving trend', () => {
      // Older runs with low scores
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `old-${i}`, agentId: 'agent-1', timestamp: i * 1000,
          aggregateScores: { accuracy: 0.4, safety: 0.5 },
        }));
      }
      // Recent runs with high scores
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `new-${i}`, agentId: 'agent-1', timestamp: 10000 + i * 1000,
          aggregateScores: { accuracy: 0.9, safety: 0.95 },
        }));
      }

      expect(observer.getTrend('agent-1', 5)).toBe('improving');
    });

    it('detects declining trend', () => {
      // Older runs with high scores
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `old-${i}`, agentId: 'agent-1', timestamp: i * 1000,
          aggregateScores: { accuracy: 0.95, safety: 0.98 },
        }));
      }
      // Recent runs with low scores
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `new-${i}`, agentId: 'agent-1', timestamp: 10000 + i * 1000,
          aggregateScores: { accuracy: 0.4, safety: 0.5 },
        }));
      }

      expect(observer.getTrend('agent-1', 5)).toBe('declining');
    });

    it('detects stable trend when scores are similar', () => {
      for (let i = 0; i < 10; i++) {
        store.saveRun(makeEvalRun({
          id: `r-${i}`, agentId: 'agent-1', timestamp: i * 1000,
          aggregateScores: { accuracy: 0.85, safety: 0.9 },
        }));
      }

      expect(observer.getTrend('agent-1', 5)).toBe('stable');
    });

    it('uses custom window size', () => {
      // 2 old low-score runs
      store.saveRun(makeEvalRun({
        id: 'old-1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { accuracy: 0.3 },
      }));
      store.saveRun(makeEvalRun({
        id: 'old-2', agentId: 'agent-1', timestamp: 2000,
        aggregateScores: { accuracy: 0.3 },
      }));
      // 2 new high-score runs
      store.saveRun(makeEvalRun({
        id: 'new-1', agentId: 'agent-1', timestamp: 3000,
        aggregateScores: { accuracy: 0.95 },
      }));
      store.saveRun(makeEvalRun({
        id: 'new-2', agentId: 'agent-1', timestamp: 4000,
        aggregateScores: { accuracy: 0.95 },
      }));

      expect(observer.getTrend('agent-1', 2)).toBe('improving');
    });
  });

  describe('getWeaknesses', () => {
    it('returns empty array for agent with no runs', () => {
      expect(observer.getWeaknesses('agent-none')).toEqual([]);
    });

    it('returns metrics sorted by lowest score first', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { accuracy: 0.9, safety: 0.5, latency: 0.7 },
      }));

      const weaknesses = observer.getWeaknesses('agent-1');
      expect(weaknesses[0].metric).toBe('safety');
      expect(weaknesses[0].avgScore).toBeCloseTo(0.5);
      expect(weaknesses[1].metric).toBe('latency');
    });

    it('respects limit parameter', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 },
      }));

      const weaknesses = observer.getWeaknesses('agent-1', 2);
      expect(weaknesses).toHaveLength(2);
      expect(weaknesses[0].metric).toBe('a');
      expect(weaknesses[1].metric).toBe('b');
    });
  });

  describe('getStrengths', () => {
    it('returns empty array for agent with no runs', () => {
      expect(observer.getStrengths('agent-none')).toEqual([]);
    });

    it('returns metrics sorted by highest score first', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { accuracy: 0.9, safety: 0.5, latency: 0.7 },
      }));

      const strengths = observer.getStrengths('agent-1');
      expect(strengths[0].metric).toBe('accuracy');
      expect(strengths[0].avgScore).toBeCloseTo(0.9);
    });

    it('respects limit parameter', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { a: 0.9, b: 0.8, c: 0.7, d: 0.6, e: 0.5 },
      }));

      const strengths = observer.getStrengths('agent-1', 2);
      expect(strengths).toHaveLength(2);
      expect(strengths[0].metric).toBe('a');
      expect(strengths[1].metric).toBe('b');
    });
  });

  describe('getRecommendations', () => {
    it('returns baseline recommendation for agent with no runs', () => {
      const recs = observer.getRecommendations('agent-none');
      expect(recs).toHaveLength(1);
      expect(recs[0]).toContain('No eval runs found');
    });

    it('recommends improvement for low pass rate', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', verdict: 'fail', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-1', verdict: 'fail', timestamp: 2000 }));
      store.saveRun(makeEvalRun({ id: 'r3', agentId: 'agent-1', verdict: 'fail', timestamp: 3000 }));

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('pass rate'))).toBe(true);
    });

    it('recommends action for critically low metrics', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { accuracy: 0.3, safety: 0.9 },
      }));

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('accuracy') && r.includes('critically low'))).toBe(true);
    });

    it('recommends addressing declining trend', () => {
      // Older high-score runs
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `old-${i}`, agentId: 'agent-1', timestamp: i * 1000,
          aggregateScores: { accuracy: 0.95 },
        }));
      }
      // Recent low-score runs
      for (let i = 0; i < 5; i++) {
        store.saveRun(makeEvalRun({
          id: `new-${i}`, agentId: 'agent-1', timestamp: 10000 + i * 1000,
          aggregateScores: { accuracy: 0.4 },
        }));
      }

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('declining'))).toBe(true);
    });

    it('gives positive feedback when everything is passing', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', verdict: 'pass', timestamp: 1000,
        aggregateScores: { accuracy: 0.95, safety: 0.98 },
        caseResults: [{
          caseId: 'c1', caseName: 'C1', passed: true, durationMs: 100,
          metricResults: {
            accuracy: { score: 0.95, passed: true, threshold: 0.7, explanation: 'Good', evidence: [] },
            safety: { score: 0.98, passed: true, threshold: 0.9, explanation: 'Clean', evidence: [] },
          },
        }],
      }));

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('solid') || r.includes('monitoring'))).toBe(true);
    });

    it('recommends variance reduction when metric scores differ widely', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        aggregateScores: { accuracy: 0.95, safety: 0.5 },
      }));
      store.saveRun(makeEvalRun({
        id: 'r2', agentId: 'agent-1', timestamp: 2000,
        aggregateScores: { accuracy: 0.95, safety: 0.5 },
      }));
      store.saveRun(makeEvalRun({
        id: 'r3', agentId: 'agent-1', timestamp: 3000,
        aggregateScores: { accuracy: 0.95, safety: 0.5 },
      }));

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('variance') || r.includes('weaker metrics'))).toBe(true);
    });

    it('recommends investigating high failure rate metrics', () => {
      store.saveRun(makeEvalRun({
        id: 'r1', agentId: 'agent-1', timestamp: 1000,
        caseResults: [
          {
            caseId: 'c1', caseName: 'C1', passed: false, durationMs: 100,
            metricResults: {
              accuracy: { score: 0.3, passed: false, threshold: 0.7, explanation: 'Low', evidence: [] },
            },
          },
          {
            caseId: 'c2', caseName: 'C2', passed: false, durationMs: 100,
            metricResults: {
              accuracy: { score: 0.4, passed: false, threshold: 0.7, explanation: 'Low', evidence: [] },
            },
          },
        ],
        aggregateScores: { accuracy: 0.35 },
      }));

      const recs = observer.getRecommendations('agent-1');
      expect(recs.some((r) => r.includes('accuracy') && r.includes('fails'))).toBe(true);
    });
  });

  describe('EvalStore agentId support', () => {
    it('saves and retrieves agentId on eval runs', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1' }));
      const run = store.getRun('r1');
      expect(run).not.toBeNull();
      expect(run!.agentId).toBe('agent-1');
    });

    it('handles runs without agentId (backward compat)', () => {
      store.saveRun(makeEvalRun({ id: 'r1' }));
      const run = store.getRun('r1');
      expect(run).not.toBeNull();
      expect(run!.agentId).toBeUndefined();
    });

    it('getRunsByAgent returns only matching runs', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-2', timestamp: 2000 }));
      store.saveRun(makeEvalRun({ id: 'r3', agentId: 'agent-1', timestamp: 3000 }));

      const runs = store.getRunsByAgent('agent-1');
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.agentId === 'agent-1')).toBe(true);
    });

    it('getRunsByAgent returns runs in descending timestamp order', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1', timestamp: 1000 }));
      store.saveRun(makeEvalRun({ id: 'r2', agentId: 'agent-1', timestamp: 3000 }));
      store.saveRun(makeEvalRun({ id: 'r3', agentId: 'agent-1', timestamp: 2000 }));

      const runs = store.getRunsByAgent('agent-1');
      expect(runs[0].id).toBe('r2');
      expect(runs[1].id).toBe('r3');
      expect(runs[2].id).toBe('r1');
    });

    it('getRunsByAgent respects limit', () => {
      for (let i = 0; i < 10; i++) {
        store.saveRun(makeEvalRun({ id: `r${i}`, agentId: 'agent-1', timestamp: i * 1000 }));
      }

      const runs = store.getRunsByAgent('agent-1', 3);
      expect(runs).toHaveLength(3);
    });

    it('getRunsByAgent returns empty for unknown agent', () => {
      store.saveRun(makeEvalRun({ id: 'r1', agentId: 'agent-1' }));
      const runs = store.getRunsByAgent('agent-unknown');
      expect(runs).toHaveLength(0);
    });
  });
});
