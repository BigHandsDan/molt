export type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EscalationStatus = 'pending' | 'claimed' | 'resolved' | 'expired' | 'auto-resolved';
export type EscalationChannel = 'webhook' | 'callback' | 'queue';

export interface EscalationPolicy {
  id: string;
  name: string;
  /** Conditions that trigger escalation */
  triggers: EscalationTrigger[];
  /** Who to notify and how */
  routing: EscalationRouting;
  /** How long before it expires */
  timeoutMs: number;
  /** What to do on timeout: 'deny' | 'allow-with-warning' | 're-escalate' */
  timeoutAction: 'deny' | 'allow-with-warning' | 're-escalate';
}

export interface EscalationTrigger {
  /** What caused the escalation */
  type: 'policy-deny' | 'confidence-low' | 'agent-request' | 'budget-exceeded' | 'safety-flag' | 'unknown-action';
  /** Optional: match specific actions or resources */
  actionPattern?: string;
  resourcePattern?: string;
}

export interface EscalationRouting {
  channel: EscalationChannel;
  /** For webhook: URL to POST to. For callback: function ref. For queue: queue name. */
  target: string;
  /** Severity determines notification urgency */
  severity: EscalationSeverity;
  /** Optional: specific team/person */
  assignee?: string;
}

export interface EscalationRequest {
  id: string;
  agentId: string;
  policyId?: string;
  trigger: EscalationTrigger;
  severity: EscalationSeverity;
  status: EscalationStatus;
  /** Packaged context for the human reviewer */
  context: EscalationContext;
  createdAt: number;
  claimedAt?: number;
  claimedBy?: string;
  resolvedAt?: number;
  resolution?: EscalationResolution;
}

export interface EscalationContext {
  /** What the agent was trying to do */
  action: string;
  /** Why it was escalated */
  reason: string;
  /** The agent's reasoning/chain-of-thought if available */
  agentReasoning?: string;
  /** Relevant trace data */
  traceData?: Record<string, unknown>;
  /** The specific policy that triggered the deny, if applicable */
  policyDetails?: { ruleId: string; reason: string };
  /** Any additional metadata */
  metadata: Record<string, unknown>;
}

export interface EscalationResolution {
  /** What the human decided */
  decision: 'approve' | 'deny' | 'approve-once' | 'modify-policy';
  /** Human's reasoning */
  reason: string;
  /** Who resolved it */
  resolvedBy: string;
  /** If 'modify-policy', what policy changes to apply */
  policyModification?: { ruleId: string; newConditions: Record<string, unknown> };
}
