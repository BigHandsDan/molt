import { EvalRun } from '../runner/types.js';
import { RegressionReport } from '../regression/detector.js';

/** Possible gate actions. */
export type GateAction = 'promote' | 'hold' | 'rollback';

/** Configuration for release gating. */
export interface GateConfig {
  /** Required minimum aggregate score per metric. */
  requiredMinimums: Record<string, number>;
  /** Maximum allowed regressions by severity before holding/rolling back. */
  maxRegressions?: {
    minor?: number;
    major?: number;
    critical?: number;
  };
  /** If true, any safety violation triggers rollback. */
  blockOnSafetyViolation?: boolean;
}

/** Result of a gate evaluation. */
export interface GateDecision {
  action: GateAction;
  reasons: string[];
  runId: string;
  timestamp: number;
}

/** Evaluates an eval run against gate configuration to decide promote/hold/rollback. */
export class ReleaseGate {
  private config: GateConfig;

  constructor(config: GateConfig) {
    this.config = config;
  }

  /** Evaluate a run and produce a gate decision. */
  evaluate(run: EvalRun, regressionReport?: RegressionReport): GateDecision {
    const reasons: string[] = [];
    let action: GateAction = 'promote';

    // Check required minimums
    for (const [metric, minimum] of Object.entries(this.config.requiredMinimums)) {
      const score = run.aggregateScores[metric];
      if (score == null || score < minimum) {
        reasons.push(`Metric "${metric}" score ${score?.toFixed(3) ?? 'N/A'} below minimum ${minimum}.`);
        action = this.escalate(action, 'hold');
      }
    }

    // Check safety violations
    if (this.config.blockOnSafetyViolation) {
      const safetyScore = run.aggregateScores['safety-violation'];
      if (safetyScore != null && safetyScore < 1) {
        reasons.push('Safety violations detected — blocking release.');
        action = this.escalate(action, 'rollback');
      }
    }

    // Check regressions
    if (regressionReport && this.config.maxRegressions) {
      const limits = this.config.maxRegressions;
      const criticalCount = regressionReport.regressions.filter((r) => r.severity === 'critical').length;
      const majorCount = regressionReport.regressions.filter((r) => r.severity === 'major').length;
      const minorCount = regressionReport.regressions.filter((r) => r.severity === 'minor').length;

      if (limits.critical != null && criticalCount > limits.critical) {
        reasons.push(`${criticalCount} critical regressions exceed limit of ${limits.critical}.`);
        action = this.escalate(action, 'rollback');
      }
      if (limits.major != null && majorCount > limits.major) {
        reasons.push(`${majorCount} major regressions exceed limit of ${limits.major}.`);
        action = this.escalate(action, 'hold');
      }
      if (limits.minor != null && minorCount > limits.minor) {
        reasons.push(`${minorCount} minor regressions exceed limit of ${limits.minor}.`);
        action = this.escalate(action, 'hold');
      }
    }

    if (reasons.length === 0) {
      reasons.push('All gate checks passed.');
    }

    return { action, reasons, runId: run.id, timestamp: Date.now() };
  }

  private escalate(current: GateAction, proposed: GateAction): GateAction {
    const severity: Record<GateAction, number> = { promote: 0, hold: 1, rollback: 2 };
    return severity[proposed] > severity[current] ? proposed : current;
  }
}
