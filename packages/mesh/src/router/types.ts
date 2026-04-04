import { AgentIdentity } from '../identity/types.js';

/** Inbound task request containing the contract, input, and caller identity. */
export interface TaskEnvelope {
  /** Unique identifier for this request. */
  envelopeId: string;
  /** The contract being invoked. */
  contractId: string;
  /** Version of the contract to use. */
  version: string;
  /** Task input payload, validated against the contract's input schema. */
  input: unknown;
  /** Identity of the agent submitting this task. */
  caller: AgentIdentity;
  /** Optional target agent ID for direct routing (bypasses capability lookup). */
  target?: string;
  /** Distributed trace ID for end-to-end observability. */
  traceId: string;
  /** Parent span ID for nested traces. */
  parentSpanId?: string;
  /** Arbitrary key-value metadata passed through the pipeline. */
  metadata: Record<string, unknown>;
}

/** Result returned after a task has been dispatched and executed. */
export interface TaskResult {
  envelopeId: string;
  contractId: string;
  output: unknown;
  status: 'success' | 'failure' | 'timeout' | 'denied';
  agentId: string;
  durationMs: number;
  tokenUsage?: { input: number; output: number };
  error?: string;
}

/** Configuration for routing tasks to a specific agent. */
export interface RouteConfig {
  agentId: string;
  capabilities: string[];
  priority: number;
}
