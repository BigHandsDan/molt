/** Categories for grouping metrics. */
export type MetricCategory = 'tool-call' | 'reasoning' | 'safety' | 'performance' | 'policy' | 'cost';

/** A single tool call within a trace. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  timestamp: number;
  durationMs: number;
  error?: string;
}

/** A reasoning step within a trace. */
export interface ReasoningStep {
  content: string;
  timestamp: number;
}

/** Token usage for cost tracking. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

/** A trace captures the full execution of an agent task. */
export interface EvalTrace {
  traceId: string;
  agentId: string;
  taskDescription: string;
  expectedToolCalls?: ToolCall[];
  actualToolCalls: ToolCall[];
  reasoningSteps: ReasoningStep[];
  tokenUsage: TokenUsage;
  startTime: number;
  endTime: number;
  success: boolean;
  safetyViolations: string[];
  policyDecisions: Array<{ action: string; decision: 'allow' | 'deny'; reason: string }>;
  metadata: Record<string, unknown>;
}

/** Result of evaluating a single metric against a trace. */
export interface MetricResult {
  score: number;
  passed: boolean;
  threshold: number;
  explanation: string;
  evidence: unknown[];
}

/** Interface all metrics must implement. */
export interface Metric {
  name: string;
  description: string;
  category: MetricCategory;
  /** Evaluate a trace and return a scored result. */
  evaluate(trace: EvalTrace): Promise<MetricResult>;
}
