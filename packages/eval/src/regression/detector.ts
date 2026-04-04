import { EvalRun } from '../runner/types.js';

/** Severity levels for regressions. */
export type RegressionSeverity = 'minor' | 'major' | 'critical';

/** A single regression finding. */
export interface Regression {
  metricName: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
  severity: RegressionSeverity;
}

/** An improvement finding. */
export interface Improvement {
  metricName: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

/** A metric that stayed within tolerance. */
export interface StableMetric {
  metricName: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

/** Result of comparing two eval runs. */
export interface RegressionReport {
  baselineRunId: string;
  currentRunId: string;
  regressions: Regression[];
  improvements: Improvement[];
  stable: StableMetric[];
  overallStatus: 'clean' | 'minor-regressions' | 'major-regressions' | 'critical-regressions';
}

export interface RegressionTolerances {
  /** Threshold for minor regression (default: 0.05 = 5%). */
  minor: number;
  /** Threshold for major regression (default: 0.15 = 15%). */
  major: number;
  /** Threshold for critical regression (default: 0.30 = 30%). */
  critical: number;
}

const DEFAULT_TOLERANCES: RegressionTolerances = {
  minor: 0.05,
  major: 0.15,
  critical: 0.30,
};

/** Compares two EvalRuns to detect regressions and improvements. */
export class RegressionDetector {
  private tolerances: RegressionTolerances;

  constructor(tolerances?: Partial<RegressionTolerances>) {
    this.tolerances = { ...DEFAULT_TOLERANCES, ...tolerances };
  }

  /** Compare a current run against a baseline. */
  compare(baseline: EvalRun, current: EvalRun): RegressionReport {
    const regressions: Regression[] = [];
    const improvements: Improvement[] = [];
    const stable: StableMetric[] = [];

    const allMetrics = new Set([
      ...Object.keys(baseline.aggregateScores),
      ...Object.keys(current.aggregateScores),
    ]);

    for (const metricName of allMetrics) {
      const baselineScore = baseline.aggregateScores[metricName] ?? 0;
      const currentScore = current.aggregateScores[metricName] ?? 0;
      const delta = currentScore - baselineScore;

      if (delta < -this.tolerances.critical) {
        regressions.push({ metricName, baselineScore, currentScore, delta, severity: 'critical' });
      } else if (delta < -this.tolerances.major) {
        regressions.push({ metricName, baselineScore, currentScore, delta, severity: 'major' });
      } else if (delta < -this.tolerances.minor) {
        regressions.push({ metricName, baselineScore, currentScore, delta, severity: 'minor' });
      } else if (delta > this.tolerances.minor) {
        improvements.push({ metricName, baselineScore, currentScore, delta });
      } else {
        stable.push({ metricName, baselineScore, currentScore, delta });
      }
    }

    let overallStatus: RegressionReport['overallStatus'] = 'clean';
    if (regressions.some((r) => r.severity === 'critical')) {
      overallStatus = 'critical-regressions';
    } else if (regressions.some((r) => r.severity === 'major')) {
      overallStatus = 'major-regressions';
    } else if (regressions.length > 0) {
      overallStatus = 'minor-regressions';
    }

    return {
      baselineRunId: baseline.id,
      currentRunId: current.id,
      regressions,
      improvements,
      stable,
      overallStatus,
    };
  }
}
