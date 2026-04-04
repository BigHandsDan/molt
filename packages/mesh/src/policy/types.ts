import { TrustTier } from '../contracts/schema.js';

/** Conditions that a policy rule matches against when evaluating a request. */
export interface PolicyConditions {
  trustTierIn?: TrustTier[];
  capabilityIn?: string[];
  toolsAllowed?: string[];
  toolsBlocked?: string[];
  maxTokenBudget?: number;
  requireApproval?: boolean;
  timeWindowStart?: string;
  timeWindowEnd?: string;
}

/** A single policy rule that either allows or denies requests matching its conditions. */
export interface PolicyRule {
  ruleId: string;
  effect: 'allow' | 'deny';
  priority: number;
  conditions: PolicyConditions;
  description: string;
}

/** The outcome of evaluating a request against the policy engine. */
export interface PolicyDecision {
  allowed: boolean;
  ruleId: string;
  reason: string;
  conditions: string[];
  timestamp: string;
}

/** Context about the current request, used by the policy engine to match rules. */
export interface PolicyContext {
  agentTrustTier: TrustTier;
  capability: string;
  requiredTools: string[];
  agentAllowedTools: string[];
  tokenBudget?: number;
  approvalRequired: boolean;
  agentCapabilities: string[];
}

/** Result of evaluating a cross-organization request through both org policies and federation grants. */
export interface CrossOrgPolicyResult {
  callerPolicy: PolicyDecision;
  targetPolicy: PolicyDecision;
  grantCheck: { valid: boolean; grantId?: string; reason?: string };
  finalDecision: PolicyDecision;
}

/** Token budget tracking for a single agent with hourly and daily limits. */
export interface AgentBudget {
  agentId: string;
  maxTokensPerHour: number;
  maxTokensPerDay: number;
  currentHourUsage: number;
  currentDayUsage: number;
  lastResetHour: string;
  lastResetDay: string;
}
