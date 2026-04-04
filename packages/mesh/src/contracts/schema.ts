/** Security classification tiers for agents, from most-trusted to least-trusted. */
export enum TrustTier {
  /** Full access to all contracts and tools. */
  INTERNAL_TRUSTED = 'internal_trusted',
  /** Internal agent with limited tool access; may require approval. */
  INTERNAL_RESTRICTED = 'internal_restricted',
  /** Partner organization agent with scoped capabilities. */
  EXTERNAL_PARTNER = 'external_partner',
  /** Untrusted public agent; heavily restricted by default. */
  PUBLIC_VENDOR = 'public_vendor',
}

/** Retry configuration for failed task dispatches. */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

/** Visibility scope of a contract within the federation. */
export type ContractVisibility = 'private' | 'org' | 'federated';

/** Immutable definition of a task that can be dispatched through the bus. */
export interface TaskContract {
  /** Unique identifier for this contract. */
  contractId: string;
  /** Semantic version string (e.g. "1.0.0"). */
  version: string;
  /** The capability this contract provides (used for agent routing). */
  capability: string;
  /** Human-readable description of what the contract does. */
  description: string;
  /** JSON Schema for validating task input. */
  inputSchema: object;
  /** JSON Schema for validating task output. */
  outputSchema: object;
  /** Minimum trust tier required to invoke this contract. */
  securityClass: TrustTier;
  /** Tools an agent must have access to in order to fulfill this contract. */
  requiredTools: string[];
  /** Maximum time in milliseconds before the dispatch times out. */
  timeout: number;
  /** Retry configuration for failed dispatches. */
  retryPolicy: RetryPolicy;
  /** Contract ID to try if this contract's dispatch fails. */
  fallbackContract?: string;
  /** Whether human approval is required before dispatch. */
  approvalRequired: boolean;
  /** Organization that owns this contract (for federation). */
  ownerOrgId?: string;
  /** Namespace within the owning organization. */
  ownerNamespace?: string;
  /** Whether this contract is private, org-wide, or federated. */
  visibility?: ContractVisibility;
}
