import { describe, it, expect } from 'vitest';
import { LatencyAggregator } from '../src/metrics/latency-aggregator.js';
import { makeEvalRun } from './helpers.js';

describe('LatencyAggregator', () => {
  const aggregator = new LatencyAggregator();

  it('returns zeros for empty runs', () => {
    const result = aggregator.compute([]);
    expect(result.p50).toBe(0);
    expect(result.p95).toBe(0);
    expect(result.p99).toBe(0);
    expect(result.count).toBe(0);
  });

  it('computes percentiles for a single run', () => {
    const run = makeEvalRun({
      caseResults: [
        { caseId: 'c1', caseName: 'Case 1', metricResults: {}, passed: true, durationMs: 100 },
        { caseId: 'c2', caseName: 'Case 2', metricResults: {}, passed: true, durationMs: 200 },
        { caseId: 'c3', caseName: 'Case 3', metricResults: {}, passed: true, durationMs: 300 },
      ],
    });
    const result = aggregator.compute([run]);
    expect(result.count).toBe(3);
    expect(result.min).toBe(100);
    expect(result.max).toBe(300);
    expect(result.p50).toBe(200);
    expect(result.mean).toBe(200);
  });

  it('computes percentiles across multiple runs', () => {
    const runs = Array.from({ length: 100 }, (_, i) =>
      makeEvalRun({
        id: `run-${i}`,
        caseResults: [
          { caseId: `c-${i}`, caseName: `Case ${i}`, metricResults: {}, passed: true, durationMs: (i + 1) * 10 },
        ],
      }),
    );
    const result = aggregator.compute(runs);
    expect(result.count).toBe(100);
    expect(result.min).toBe(10);
    expect(result.max).toBe(1000);
    expect(result.p50).toBeCloseTo(505, -1);
    expect(result.p95).toBeCloseTo(955, -1);
    expect(result.p99).toBeCloseTo(991, -1);
  });

  it('handles single case', () => {
    const run = makeEvalRun({
      caseResults: [
        { caseId: 'c1', caseName: 'Case 1', metricResults: {}, passed: true, durationMs: 42 },
      ],
    });
    const result = aggregator.compute([run]);
    expect(result.p50).toBe(42);
    expect(result.p95).toBe(42);
    expect(result.p99).toBe(42);
    expect(result.count).toBe(1);
  });
});
