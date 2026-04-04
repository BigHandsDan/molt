import { EvalTrace, MetricResult } from '../metrics/types.js';

/** An individual test case in an evaluation suite. */
export interface EvalCase {
  id: string;
  name: string;
  description: string;
  trace: EvalTrace;
  tags?: string[];
}

/** Metric thresholds for the suite. */
export interface MetricThresholds {
  [metricName: string]: number;
}

/** A collection of eval cases with shared configuration. */
export interface EvalSuite {
  name: string;
  description?: string;
  cases: EvalCase[];
  thresholds: MetricThresholds;
  metricNames?: string[];
}

/** Adapter function that runs an agent and returns a trace. */
export type AgentAdapter = (caseData: EvalCase) => Promise<EvalTrace>;

/** Result for a single case. */
export interface CaseResult {
  caseId: string;
  caseName: string;
  metricResults: Record<string, MetricResult>;
  passed: boolean;
  durationMs: number;
  error?: string;
}

/** Verdict for an evaluation run. */
export type EvalVerdict = 'pass' | 'fail' | 'warn';

/** Complete result of an evaluation run. */
export interface EvalRun {
  id: string;
  suiteId: string;
  suiteName: string;
  timestamp: number;
  caseResults: CaseResult[];
  aggregateScores: Record<string, number>;
  verdict: EvalVerdict;
  durationMs: number;
  metadata: Record<string, unknown>;
}
