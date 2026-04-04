export interface AgentInfo {
  id: string;
  name?: string;
  verificationTier: VerificationTier;
  reputationScore?: number;
  onChainId?: string;
}

export type VerificationTier = 'unverified' | 'moltcaptcha' | 'blockchain' | 'reputation';

export interface ActionInfo {
  type: string;
  method?: string;
  resource: string;
  parameters: Record<string, unknown>;
}

export interface ActionContext {
  sessionId?: string;
  taskId?: string;
  timestamp: string;
  environment: 'production' | 'staging' | 'development';
  humanSponsor?: string;
  customAttributes?: Record<string, unknown>;
}

export interface ActionRequest {
  agent: AgentInfo;
  action: ActionInfo;
  context: ActionContext;
}

export interface ScopedCredential {
  token: string;
  expiresAt: string;
  scopes: string[];
  restrictions: Record<string, unknown>;
}

export interface PolicyDecision {
  decision: 'allow' | 'deny';
  reasons: string[];
  matchedPolicies: string[];
  scopedCredential?: ScopedCredential;
  auditId: string;
}

export interface ActionBudget {
  perAgent: number;
  perHour?: number;
  perDay?: number;
  requireApproval?: boolean;
  maxValuePerAction?: number;
}
