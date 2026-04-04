import { v4 as uuidv4 } from 'uuid';
import { MetricRegistry } from '../metrics/registry.js';
import { MetricResult } from '../metrics/types.js';
import { EvalSuite, EvalCase, AgentAdapter, CaseResult, EvalRun, EvalVerdict } from './types.js';

export interface RunnerOptions {
  /** Timeout per case in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** If true, uses the trace from the case directly instead of calling the adapter. */
  useStaticTraces?: boolean;
}

/** Runs an evaluation suite against an agent adapter and produces scored results. */
export class EvalRunner {
  private registry: MetricRegistry;
  private options: RunnerOptions;

  constructor(registry: MetricRegistry, options: RunnerOptions = {}) {
    this.registry = registry;
    this.options = options;
  }

  /** Run a full evaluation suite. */
  async run(suite: EvalSuite, adapter?: AgentAdapter): Promise<EvalRun> {
    const runId = uuidv4();
    const runStart = Date.now();
    const caseResults: CaseResult[] = [];

    const metrics = suite.metricNames
      ? suite.metricNames.map((n) => this.registry.get(n)).filter((m): m is NonNullable<typeof m> => m != null)
      : this.registry.getAll();

    for (const evalCase of suite.cases) {
      const result = await this.runCase(evalCase, metrics, suite.thresholds, adapter);
      caseResults.push(result);
    }

    const aggregateScores = this.computeAggregates(caseResults, metrics.map((m) => m.name));
    const verdict = this.computeVerdict(aggregateScores, suite.thresholds, caseResults);

    return {
      id: runId,
      suiteId: suite.name,
      suiteName: suite.name,
      timestamp: runStart,
      caseResults,
      aggregateScores,
      verdict,
      durationMs: Date.now() - runStart,
      metadata: {},
    };
  }

  private async runCase(
    evalCase: EvalCase,
    metrics: { name: string; evaluate: (trace: import('../metrics/types.js').EvalTrace) => Promise<MetricResult> }[],
    thresholds: Record<string, number>,
    adapter?: AgentAdapter,
  ): Promise<CaseResult> {
    const start = Date.now();
    const metricResults: Record<string, MetricResult> = {};

    try {
      const trace = this.options.useStaticTraces || !adapter
        ? evalCase.trace
        : await this.withTimeout(adapter(evalCase), this.options.timeoutMs ?? 30000);

      for (const metric of metrics) {
        try {
          const result = await metric.evaluate(trace);
          const threshold = thresholds[metric.name] ?? result.threshold;
          metricResults[metric.name] = {
            ...result,
            threshold,
            passed: result.score >= threshold,
          };
        } catch (err) {
          metricResults[metric.name] = {
            score: 0,
            passed: false,
            threshold: thresholds[metric.name] ?? 0.5,
            explanation: `Metric error: ${err instanceof Error ? err.message : String(err)}`,
            evidence: [],
          };
        }
      }

      const passed = Object.values(metricResults).every((r) => r.passed);
      return { caseId: evalCase.id, caseName: evalCase.name, metricResults, passed, durationMs: Date.now() - start };
    } catch (err) {
      return {
        caseId: evalCase.id,
        caseName: evalCase.name,
        metricResults,
        passed: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private computeAggregates(results: CaseResult[], metricNames: string[]): Record<string, number> {
    const aggregates: Record<string, number> = {};
    for (const name of metricNames) {
      const scores = results
        .map((r) => r.metricResults[name]?.score)
        .filter((s): s is number => s != null);
      aggregates[name] = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }
    return aggregates;
  }

  private computeVerdict(aggregates: Record<string, number>, thresholds: Record<string, number>, results: CaseResult[]): EvalVerdict {
    const hasErrors = results.some((r) => r.error != null);
    const allPassed = Object.entries(thresholds).every(([name, threshold]) => (aggregates[name] ?? 0) >= threshold);

    if (allPassed && !hasErrors) return 'pass';

    const anyFailed = Object.entries(thresholds).some(([name, threshold]) => (aggregates[name] ?? 0) < threshold * 0.8);
    if (anyFailed) return 'fail';

    return 'warn';
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout: case exceeded ${ms}ms`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }
}
