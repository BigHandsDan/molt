/** Strategy types for self-healing dispatch recovery. */
export type HealingStrategy = 'retry-alternate' | 'fallback-chain' | 'simplify' | 'decompose' | 'escalate';

/** Failure types that healing policies can match against. */
export type FailureType = 'timeout' | 'error' | 'policy-deny' | 'budget-exceeded' | 'circuit-open' | 'validation-failure';

/** Policy defining which failures to heal and what strategies to attempt. */
export interface HealingPolicy {
  id: string;
  /** Glob-like pattern to match contract IDs (uses simple prefix/suffix matching). */
  contractPattern?: string;
  /** Glob-like pattern to match agent IDs. */
  agentPattern?: string;
  /** Which failure types this policy handles. */
  failureTypes: FailureType[];
  /** Ordered list of strategies to attempt. */
  strategies: HealingStrategyConfig[];
  /** Maximum total healing attempts before giving up. */
  maxAttempts: number;
}

/** Configuration for a specific healing strategy. */
export interface HealingStrategyConfig {
  strategy: HealingStrategy;
  /** For retry-alternate: which agent to try next. */
  alternateAgentId?: string;
  /** For fallback-chain: ordered list of fallback agents. */
  fallbackChain?: string[];
  /** For simplify: how to reduce task complexity. */
  simplifyRules?: { dropOptionalFields?: boolean; reduceScope?: boolean; lowerQuality?: boolean };
  /** For decompose: function that breaks the task into subtasks. */
  decomposer?: (envelope: unknown) => unknown[];
  /** For escalate: escalation target identifier. */
  escalateTarget?: string;
}

/** Record of a single healing attempt. */
export interface HealingAttempt {
  id: string;
  originalTraceId: string;
  strategy: HealingStrategy;
  attemptNumber: number;
  agentId: string;
  contractId: string;
  success: boolean;
  durationMs: number;
  error?: string;
  timestamp: number;
}

/** Complete report of a healing session for a failed trace. */
export interface HealingReport {
  originalTraceId: string;
  failureType: string;
  attempts: HealingAttempt[];
  finalOutcome: 'healed' | 'exhausted' | 'escalated';
  healedBy?: { strategy: HealingStrategy; agentId: string };
  totalDurationMs: number;
}

/** Aggregated healing statistics. */
export interface HealingStats {
  totalAttempts: number;
  healedCount: number;
  exhaustedCount: number;
  escalatedCount: number;
  avgAttemptsToHeal: number;
}

/** Failure descriptor passed to the heal method. */
export interface HealingFailure {
  traceId: string;
  contractId: string;
  agentId: string;
  failureType: string;
  error?: string;
  envelope: unknown;
}

/** Dispatch function signature used by the healer. */
export type HealingDispatchFn = (
  agentId: string,
  envelope: unknown
) => Promise<{ success: boolean; result?: unknown; error?: string }>;
