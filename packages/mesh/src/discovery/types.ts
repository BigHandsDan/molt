/** Availability status of an agent capability. */
export type CapabilityStatus = 'available' | 'busy' | 'offline' | 'degraded';

/** Performance metadata for a registered capability. */
export interface CapabilityPerformance {
  avgLatencyMs?: number;
  successRate?: number;
  costPerCall?: number;
}

/** A registered agent capability describing what an agent can do. */
export interface AgentCapability {
  id: string;
  agentId: string;
  /** What the agent can do — maps to contract IDs */
  contractIds: string[];
  /** Human-readable description */
  description: string;
  /** Input schema summary */
  inputSchema?: Record<string, unknown>;
  /** Output schema summary */
  outputSchema?: Record<string, unknown>;
  /** Availability status */
  status: CapabilityStatus;
  /** Performance metadata */
  performance?: CapabilityPerformance;
  /** When this capability was registered */
  registeredAt: number;
  /** Last heartbeat/update */
  lastSeenAt: number;
  /** TTL — capability expires if no heartbeat within this window */
  ttlMs: number;
}

/** Query parameters for discovering capabilities. */
export interface CapabilityQuery {
  contractId?: string;
  agentId?: string;
  status?: CapabilityStatus;
  minSuccessRate?: number;
  maxLatencyMs?: number;
  maxCostPerCall?: number;
}
