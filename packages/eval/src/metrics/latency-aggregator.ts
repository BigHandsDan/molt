import { EvalRun } from '../runner/types.js';

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  count: number;
}

/** Computes p50/p95/p99 latency percentiles across multiple eval runs. */
export class LatencyAggregator {
  /** Compute latency percentiles from one or more eval runs. */
  compute(runs: EvalRun[]): LatencyPercentiles {
    const durations = runs.flatMap((run) =>
      run.caseResults.map((cr) => cr.durationMs),
    );

    if (durations.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, count: 0 };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const count = sorted.length;
    const mean = sorted.reduce((a, b) => a + b, 0) / count;

    return {
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      min: sorted[0],
      max: sorted[count - 1],
      mean,
      count,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 1) return sorted[0];
    const idx = p * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  }
}
