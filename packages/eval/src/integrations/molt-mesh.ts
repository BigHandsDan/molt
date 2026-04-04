import { EvalTrace, ToolCall, TokenUsage } from '../metrics/types.js';

/** A MoltMesh trace event — matches the shape from @molt/mesh TraceEvent. */
export interface MeshTraceEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  eventType: string;
  timestamp: number;
  durationMs: number;
  data: {
    contractId?: string;
    agentId?: string;
    policyDecision?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    estimatedCost?: number;
    adapterProtocol?: string;
    [key: string]: unknown;
  };
}

/** Convert MoltMesh trace events into an EvalTrace for evaluation. */
export function meshEventsToEvalTrace(events: MeshTraceEvent[], taskDescription = ''): EvalTrace {
  if (events.length === 0) {
    throw new Error('Cannot convert empty events array to EvalTrace');
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const traceId = sorted[0].traceId;
  const agentId = sorted.find((e) => e.data.agentId)?.data.agentId ?? 'unknown';

  const toolCalls: ToolCall[] = sorted
    .filter((e) => e.eventType === 'dispatch' || e.eventType === 'translate')
    .map((e) => ({
      name: e.data.contractId ?? e.eventType,
      arguments: typeof e.data.input === 'object' && e.data.input !== null
        ? e.data.input as Record<string, unknown>
        : {},
      result: e.data.output,
      timestamp: e.timestamp,
      durationMs: e.durationMs,
      error: e.data.error,
    }));

  const tokenUsage: TokenUsage = events.reduce(
    (acc, e) => {
      if (e.data.tokenUsage) {
        acc.inputTokens += e.data.tokenUsage.inputTokens;
        acc.outputTokens += e.data.tokenUsage.outputTokens;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0 },
  );

  const policyDecisions = sorted
    .filter((e) => e.eventType === 'policy' || e.eventType === 'cross_org_policy')
    .map((e) => ({
      action: e.data.contractId ?? 'unknown',
      decision: (e.data.policyDecision === 'allow' ? 'allow' : 'deny') as 'allow' | 'deny',
      reason: e.data.error ?? e.data.policyDecision ?? '',
    }));

  const errors = sorted.filter((e) => e.eventType === 'error' || e.data.error);
  const hasError = errors.length > 0;

  const startTime = sorted[0].timestamp;
  const lastEvent = sorted[sorted.length - 1];
  const endTime = lastEvent.timestamp + lastEvent.durationMs;

  return {
    traceId,
    agentId,
    taskDescription,
    actualToolCalls: toolCalls,
    reasoningSteps: [],
    tokenUsage,
    startTime,
    endTime,
    success: !hasError,
    safetyViolations: [],
    policyDecisions,
    metadata: { source: 'molt-mesh', eventCount: events.length },
  };
}
