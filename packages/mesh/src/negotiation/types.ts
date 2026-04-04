/** Status of a negotiation proposal through its lifecycle. */
export type NegotiationStatus = 'proposed' | 'countered' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

/** A negotiation proposal between two agents. */
export interface NegotiationProposal {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  /** What the proposer wants done. */
  task: { contractId: string; description: string; input: unknown };
  /** Proposed terms. */
  terms: NegotiationTerms;
  status: NegotiationStatus;
  createdAt: number;
  expiresAt: number;
  history: NegotiationEvent[];
}

/** Terms of a negotiation — cost, duration, quality, priority, and custom. */
export interface NegotiationTerms {
  /** Max cost in credits. */
  maxCost?: number;
  /** Max execution time in ms. */
  maxDurationMs?: number;
  /** Required quality/SLA tier. */
  qualityTier?: 'best-effort' | 'standard' | 'premium';
  /** Priority level. */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Custom terms. */
  custom?: Record<string, unknown>;
}

/** A single event in the negotiation history. */
export interface NegotiationEvent {
  type: 'propose' | 'counter' | 'accept' | 'reject' | 'expire' | 'cancel';
  agentId: string;
  terms?: NegotiationTerms;
  reason?: string;
  timestamp: number;
}

/** A binding agreement created when a proposal is accepted. */
export interface NegotiationAgreement {
  id: string;
  proposalId: string;
  fromAgentId: string;
  toAgentId: string;
  agreedTerms: NegotiationTerms;
  task: { contractId: string; description: string; input: unknown };
  createdAt: number;
}
