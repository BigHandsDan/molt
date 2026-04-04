import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Negotiator,
  NegotiationProposal,
  NegotiationTerms,
  NegotiationAgreement,
} from '../src/negotiation/index.js';

const TASK = { contractId: 'summarize', description: 'Summarize a document', input: { text: 'hello' } };
const TERMS: NegotiationTerms = { maxCost: 100, maxDurationMs: 5000, qualityTier: 'standard', priority: 'normal' };

describe('Negotiator', () => {
  let negotiator: Negotiator;

  beforeEach(() => {
    negotiator = new Negotiator(); // in-memory SQLite
  });

  afterEach(() => {
    negotiator.close();
  });

  // ── Proposal Creation ──────────────────────────────────────────────

  describe('propose', () => {
    it('should create a proposal with correct fields', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);

      expect(p.id).toBeTruthy();
      expect(p.fromAgentId).toBe('agent-a');
      expect(p.toAgentId).toBe('agent-b');
      expect(p.task).toEqual(TASK);
      expect(p.terms).toEqual(TERMS);
      expect(p.status).toBe('proposed');
      expect(p.expiresAt).toBe(p.createdAt + 60_000);
    });

    it('should record a propose event in history', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS);

      expect(p.history).toHaveLength(1);
      expect(p.history[0].type).toBe('propose');
      expect(p.history[0].agentId).toBe('agent-a');
      expect(p.history[0].terms).toEqual(TERMS);
    });

    it('should use default TTL of 5 minutes when not specified', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS);

      expect(p.expiresAt - p.createdAt).toBe(300_000);
    });

    it('should persist proposal to database', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS);
      const retrieved = negotiator.getProposal(p.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(p.id);
      expect(retrieved!.terms).toEqual(TERMS);
    });
  });

  // ── Counter ────────────────────────────────────────────────────────

  describe('counter', () => {
    it('should counter a proposal with new terms', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const newTerms: NegotiationTerms = { maxCost: 50, qualityTier: 'premium' };
      const countered = negotiator.counter(p.id, 'agent-b', newTerms);

      expect(countered).not.toBeNull();
      expect(countered!.status).toBe('countered');
      expect(countered!.terms).toEqual(newTerms);
      expect(countered!.history).toHaveLength(2);
      expect(countered!.history[1].type).toBe('counter');
    });

    it('should allow the original proposer to counter after a counter', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.counter(p.id, 'agent-b', { maxCost: 50 });
      const re = negotiator.counter(p.id, 'agent-a', { maxCost: 75 });

      expect(re).not.toBeNull();
      expect(re!.history).toHaveLength(3);
      expect(re!.terms).toEqual({ maxCost: 75 });
    });

    it('should reject counter from non-party agent', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const result = negotiator.counter(p.id, 'agent-c', { maxCost: 10 });

      expect(result).toBeNull();
    });

    it('should reject counter on already accepted proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.accept(p.id, 'agent-b');
      const result = negotiator.counter(p.id, 'agent-b', { maxCost: 10 });

      expect(result).toBeNull();
    });

    it('should reject counter on non-existent proposal', () => {
      const result = negotiator.counter('no-such-id', 'agent-a', { maxCost: 10 });
      expect(result).toBeNull();
    });
  });

  // ── Accept ─────────────────────────────────────────────────────────

  describe('accept', () => {
    it('should accept a proposal and create an agreement', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const agreement = negotiator.accept(p.id, 'agent-b');

      expect(agreement).not.toBeNull();
      expect(agreement!.proposalId).toBe(p.id);
      expect(agreement!.fromAgentId).toBe('agent-a');
      expect(agreement!.toAgentId).toBe('agent-b');
      expect(agreement!.agreedTerms).toEqual(TERMS);
      expect(agreement!.task).toEqual(TASK);
    });

    it('should mark proposal as accepted', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.accept(p.id, 'agent-b');
      const updated = negotiator.getProposal(p.id);

      expect(updated!.status).toBe('accepted');
      expect(updated!.history).toHaveLength(2);
      expect(updated!.history[1].type).toBe('accept');
    });

    it('should not allow proposer to accept their own proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const result = negotiator.accept(p.id, 'agent-a');

      expect(result).toBeNull();
    });

    it('should allow proposer to accept after a counter from target', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.counter(p.id, 'agent-b', { maxCost: 50 });
      const agreement = negotiator.accept(p.id, 'agent-a');

      expect(agreement).not.toBeNull();
      expect(agreement!.agreedTerms).toEqual({ maxCost: 50 });
    });

    it('should not accept an already rejected proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.reject(p.id, 'agent-b');
      const result = negotiator.accept(p.id, 'agent-b');

      expect(result).toBeNull();
    });

    it('should not allow non-party agent to accept', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const result = negotiator.accept(p.id, 'agent-c');

      expect(result).toBeNull();
    });

    it('should persist agreement to database', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.accept(p.id, 'agent-b');
      const agreements = negotiator.getAgreements('agent-a');

      expect(agreements).toHaveLength(1);
      expect(agreements[0].proposalId).toBe(p.id);
    });
  });

  // ── Reject ─────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should reject a proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const rejected = negotiator.reject(p.id, 'agent-b', 'Too expensive');

      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe('rejected');
      expect(rejected!.history).toHaveLength(2);
      expect(rejected!.history[1].type).toBe('reject');
      expect(rejected!.history[1].reason).toBe('Too expensive');
    });

    it('should allow proposer to reject their own proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const rejected = negotiator.reject(p.id, 'agent-a', 'Changed my mind');

      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe('rejected');
    });

    it('should not allow non-party agent to reject', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const result = negotiator.reject(p.id, 'agent-c');

      expect(result).toBeNull();
    });
  });

  // ── Cancel ─────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a proposal by the proposer', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const cancelled = negotiator.cancel(p.id, 'agent-a');

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
      expect(cancelled!.history).toHaveLength(2);
      expect(cancelled!.history[1].type).toBe('cancel');
    });

    it('should not allow target agent to cancel', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const result = negotiator.cancel(p.id, 'agent-b');

      expect(result).toBeNull();
    });

    it('should not cancel an already accepted proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.accept(p.id, 'agent-b');
      const result = negotiator.cancel(p.id, 'agent-a');

      expect(result).toBeNull();
    });
  });

  // ── Expiration ─────────────────────────────────────────────────────

  describe('processExpirations', () => {
    it('should expire proposals past their TTL', () => {
      // Create a proposal with TTL of 0 (expires immediately)
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 0);
      const expired = negotiator.processExpirations();

      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe(p.id);
      expect(expired[0].status).toBe('expired');
    });

    it('should not expire proposals that have not yet expired', () => {
      negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 600_000);
      const expired = negotiator.processExpirations();

      expect(expired).toHaveLength(0);
    });

    it('should not expire already accepted proposals', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.accept(p.id, 'agent-b');
      // Even if we could manipulate time, accepted proposals are not in proposed/countered status
      const expired = negotiator.processExpirations();

      expect(expired).toHaveLength(0);
    });

    it('should add expire event to history', () => {
      negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 0);
      const expired = negotiator.processExpirations();

      const last = expired[0].history[expired[0].history.length - 1];
      expect(last.type).toBe('expire');
      expect(last.agentId).toBe('system');
    });

    it('should expire countered proposals past their TTL', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 1);
      negotiator.counter(p.id, 'agent-b', { maxCost: 50 });

      // Small delay to ensure TTL passes
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      const expired = negotiator.processExpirations();
      expect(expired.length).toBeGreaterThanOrEqual(1);
      expect(expired[0].status).toBe('expired');
    });
  });

  // ── Queries ────────────────────────────────────────────────────────

  describe('getProposals', () => {
    it('should return proposals for an agent as sender', () => {
      negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.propose('agent-a', 'agent-c', TASK, TERMS, 60_000);
      negotiator.propose('agent-d', 'agent-e', TASK, TERMS, 60_000);

      const proposals = negotiator.getProposals('agent-a');
      expect(proposals).toHaveLength(2);
    });

    it('should return proposals for an agent as receiver', () => {
      negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.propose('agent-c', 'agent-b', TASK, TERMS, 60_000);

      const proposals = negotiator.getProposals('agent-b');
      expect(proposals).toHaveLength(2);
    });

    it('should filter proposals by status', () => {
      const p1 = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.propose('agent-a', 'agent-c', TASK, TERMS, 60_000);
      negotiator.accept(p1.id, 'agent-b');

      const accepted = negotiator.getProposals('agent-a', 'accepted');
      expect(accepted).toHaveLength(1);
      expect(accepted[0].id).toBe(p1.id);

      const proposed = negotiator.getProposals('agent-a', 'proposed');
      expect(proposed).toHaveLength(1);
    });
  });

  describe('getAgreements', () => {
    it('should return agreements for an agent', () => {
      const p1 = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const p2 = negotiator.propose('agent-c', 'agent-a', TASK, TERMS, 60_000);
      negotiator.accept(p1.id, 'agent-b');
      negotiator.accept(p2.id, 'agent-a');

      const agreements = negotiator.getAgreements('agent-a');
      expect(agreements).toHaveLength(2);
    });

    it('should return empty array for agent with no agreements', () => {
      const agreements = negotiator.getAgreements('agent-x');
      expect(agreements).toHaveLength(0);
    });
  });

  describe('getProposal', () => {
    it('should return null for non-existent proposal', () => {
      const result = negotiator.getProposal('no-such-id');
      expect(result).toBeNull();
    });
  });

  // ── History Tracking ───────────────────────────────────────────────

  describe('history tracking', () => {
    it('should track full negotiation history', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.counter(p.id, 'agent-b', { maxCost: 50 });
      negotiator.counter(p.id, 'agent-a', { maxCost: 75 });
      negotiator.accept(p.id, 'agent-b');

      const final = negotiator.getProposal(p.id)!;
      expect(final.history).toHaveLength(4);
      expect(final.history[0].type).toBe('propose');
      expect(final.history[1].type).toBe('counter');
      expect(final.history[2].type).toBe('counter');
      expect(final.history[3].type).toBe('accept');
    });

    it('should track rejection with reason in history', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      negotiator.reject(p.id, 'agent-b', 'Not interested');

      const final = negotiator.getProposal(p.id)!;
      expect(final.history[1].reason).toBe('Not interested');
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle proposal with custom terms', () => {
      const customTerms: NegotiationTerms = {
        maxCost: 200,
        priority: 'urgent',
        custom: { requireGPU: true, model: 'gpt-4' },
      };
      const p = negotiator.propose('agent-a', 'agent-b', TASK, customTerms, 60_000);
      const retrieved = negotiator.getProposal(p.id);

      expect(retrieved!.terms.custom).toEqual({ requireGPU: true, model: 'gpt-4' });
    });

    it('should handle proposal with minimal terms', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, {}, 60_000);
      expect(p.terms).toEqual({});
    });

    it('should not accept expired proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 0);

      // Small delay to ensure expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      const result = negotiator.accept(p.id, 'agent-b');
      expect(result).toBeNull();
    });

    it('should not counter expired proposal', () => {
      const p = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 0);

      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      const result = negotiator.counter(p.id, 'agent-b', { maxCost: 50 });
      expect(result).toBeNull();
    });

    it('should support multiple independent negotiations', () => {
      const p1 = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const p2 = negotiator.propose('agent-c', 'agent-d', TASK, { maxCost: 200 }, 60_000);

      negotiator.accept(p1.id, 'agent-b');
      negotiator.reject(p2.id, 'agent-d', 'No capacity');

      const a1 = negotiator.getProposal(p1.id)!;
      const a2 = negotiator.getProposal(p2.id)!;

      expect(a1.status).toBe('accepted');
      expect(a2.status).toBe('rejected');
    });

    it('should create unique agreement IDs', () => {
      const p1 = negotiator.propose('agent-a', 'agent-b', TASK, TERMS, 60_000);
      const p2 = negotiator.propose('agent-a', 'agent-c', TASK, TERMS, 60_000);

      const a1 = negotiator.accept(p1.id, 'agent-b')!;
      const a2 = negotiator.accept(p2.id, 'agent-c')!;

      expect(a1.id).not.toBe(a2.id);
    });
  });
});
