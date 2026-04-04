import { ActionRequest, PolicyDecision } from '../engine/types.js';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actionRequest: ActionRequest;
  decision: PolicyDecision;
  outcome?: 'success' | 'failure' | 'pending' | 'rolled_back';
  reversible: boolean;
  reverseActionId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  agentId?: string;
  decision?: 'allow' | 'deny';
  since?: string;
  until?: string;
  actionType?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}
