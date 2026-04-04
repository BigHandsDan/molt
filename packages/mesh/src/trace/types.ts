import { PolicyDecision } from '../policy/types.js';

/** Discriminated event types emitted during task processing. */
export type TraceEventType =
  | 'ingress'
  | 'validate'
  | 'policy'
  | 'route'
  | 'dispatch'
  | 'translate'
  | 'response'
  | 'error'
  | 'timeout'
  | 'pending_approval'
  | 'budget_exceeded'
  | 'circuit_open'
  | 'dead_letter'
  | 'retry'
  | 'federation_check'
  | 'cross_org_policy'
  | 'namespace_resolve';

/** A single span in a distributed trace, capturing one step of task processing. */
export interface TraceEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  eventType: TraceEventType;
  timestamp: string;
  durationMs?: number;
  data: {
    contractId?: string;
    agentId?: string;
    policyDecision?: PolicyDecision;
    input?: unknown;
    output?: unknown;
    error?: string;
    tokenUsage?: { input: number; output: number };
    estimatedCost?: number;
    adapterProtocol?: string;
    transformations?: string[];
    approvalId?: string;
    circuitState?: string;
    attempt?: number;
    budgetType?: string;
    // Federation fields
    sourceOrgId?: string;
    targetOrgId?: string;
    sourceNamespace?: string;
    targetNamespace?: string;
    grantId?: string;
    grantValid?: boolean;
    grantReason?: string;
    callerPolicyAllowed?: boolean;
    targetPolicyAllowed?: boolean;
    finalDecision?: boolean;
  };
}

/** Filter criteria for querying trace events. */
export interface TraceFilter {
  traceId?: string;
  agentId?: string;
  contractId?: string;
  eventType?: TraceEventType;
  startTime?: string;
  endTime?: string;
  limit?: number;
}
