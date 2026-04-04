import { TraceEvent, TraceEventType, TraceFilter } from '@molt/mesh';
import { EvalTrace, ToolCall, TokenUsage } from '../metrics/types.js';

export type { TraceEvent, TraceEventType, TraceFilter };

/** Convert MoltMesh trace events into an EvalTrace for evaluation. */
export function meshEventsToEvalTrace(events: TraceEvent[], taskDescription = ''): EvalTrace {
  if (events.length === 0) {
    throw new Error('Cannot convert empty events array to EvalTrace');
  }

  const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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
      timestamp: new Date(e.timestamp).getTime(),
      durationMs: e.durationMs ?? 0,
      error: e.data.error,
    }));

  const tokenUsage: TokenUsage = events.reduce(
    (acc, e) => {
      if (e.data.tokenUsage) {
        acc.inputTokens += e.data.tokenUsage.input;
        acc.outputTokens += e.data.tokenUsage.output;
      }
      return acc;
    },
    { inputTokens: 0, outputTokens: 0 },
  );

  const policyDecisions = sorted
    .filter((e) => e.eventType === 'policy' || e.eventType === 'cross_org_policy')
    .map((e) => {
      const pd = e.data.policyDecision;
      return {
        action: e.data.contractId ?? 'unknown',
        decision: (pd?.allowed ? 'allow' : 'deny') as 'allow' | 'deny',
        reason: pd?.reason ?? e.data.error ?? '',
      };
    });

  const errors = sorted.filter((e) => e.eventType === 'error' || e.data.error);
  const hasError = errors.length > 0;

  const startTime = new Date(sorted[0].timestamp).getTime();
  const lastEvent = sorted[sorted.length - 1];
  const endTime = new Date(lastEvent.timestamp).getTime() + (lastEvent.durationMs ?? 0);

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
