import { MetricRegistry } from './metrics/registry.js';
import { EvalRunner, RunnerOptions } from './runner/runner.js';
import { EvalSuite, EvalRun, AgentAdapter } from './runner/types.js';
import { RegressionDetector, RegressionReport, RegressionTolerances } from './regression/detector.js';
import { ReleaseGate, GateConfig, GateDecision } from './gate/gate.js';
import { EvalStore } from './store/store.js';

/** Configuration for the MoltEval orchestrator. */
export interface MoltEvalConfig {
  /** SQLite database path. Default: ':memory:'. */
  dbPath?: string;
  /** Timeout per case in milliseconds. */
  timeoutMs?: number;
  /** Custom regression tolerances. */
  regressionTolerances?: Partial<RegressionTolerances>;
  /** Include default metrics. Default: true. */
  includeDefaultMetrics?: boolean;
}

/**
 * Main orchestrator tying together the runner, metrics, store, gate, and regression detector.
 *
 * This is the primary entry point for the @molt/eval package.
 */
export class MoltEval {
  readonly registry: MetricRegistry;
  readonly store: EvalStore;
  private runner: EvalRunner;
  private detector: RegressionDetector;
  private config: MoltEvalConfig;

  constructor(config: MoltEvalConfig = {}) {
    this.config = config;
    this.registry = new MetricRegistry(config.includeDefaultMetrics !== false);
    this.store = new EvalStore(config.dbPath);
    this.runner = new EvalRunner(this.registry, {
      timeoutMs: config.timeoutMs,
      useStaticTraces: true,
    });
    this.detector = new RegressionDetector(config.regressionTolerances);
  }

  /** Run an evaluation suite using static traces from the cases. */
  async run(suite: EvalSuite): Promise<EvalRun> {
    const evalRun = await this.runner.run(suite);
    this.store.saveRun(evalRun);
    return evalRun;
  }

  /** Run a suite with a live agent adapter. */
  async runWithAdapter(suite: EvalSuite, adapter: AgentAdapter): Promise<EvalRun> {
    const runner = new EvalRunner(this.registry, {
      timeoutMs: this.config.timeoutMs,
      useStaticTraces: false,
    });
    const evalRun = await runner.run(suite, adapter);
    this.store.saveRun(evalRun);
    return evalRun;
  }

  /** Retrieve a stored eval run. */
  getRun(runId: string): EvalRun | null {
    return this.store.getRun(runId);
  }

  /** List recent eval runs. */
  listRuns(suiteId?: string, limit?: number): Array<{ id: string; suiteName: string; verdict: string; timestamp: number }> {
    return this.store.listRuns(suiteId, limit);
  }

  /** Compare two runs for regressions. Returns null if either run is not found. */
  compareRuns(baselineId: string, currentId: string): RegressionReport | null {
    const baseline = this.store.getRun(baselineId);
    const current = this.store.getRun(currentId);
    if (!baseline || !current) return null;

    const report = this.detector.compare(baseline, current);
    this.store.saveRegressionReport(report);
    return report;
  }

  /** Evaluate a release gate for a run. Returns null if the run is not found. */
  gate(runId: string, overrides?: Partial<GateConfig>): GateDecision | null {
    const run = this.store.getRun(runId);
    if (!run) return null;

    const DEFAULT_GATE_MINIMUMS: Record<string, number> = {
      'tool-call-accuracy': 0.7,
      'tool-call-sequence': 0.8,
      'policy-adherence': 0.9,
      'task-completion': 0.7,
      'latency': 0.6,
      'cost-efficiency': 0.5,
      'safety-violation': 1.0,
    };

    // Build minimums from the run's own metric keys with reasonable defaults
    const requiredMinimums: Record<string, number> = {};
    for (const metricName of Object.keys(run.aggregateScores)) {
      requiredMinimums[metricName] = DEFAULT_GATE_MINIMUMS[metricName] ?? 0.5;
    }

    const gateConfig: GateConfig = {
      requiredMinimums,
      ...overrides,
    };

    const gate = new ReleaseGate(gateConfig);

    // Check for existing regression report
    const reports = this.store.getRegressionReports(runId);
    const latestReport = reports.length > 0 ? reports[0] : undefined;

    const decision = gate.evaluate(run, latestReport);
    this.store.saveGateDecision(decision);
    return decision;
  }

  /** Close the underlying store. */
  close(): void {
    this.store.close();
  }
}
