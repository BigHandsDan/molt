import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  NegotiationProposal,
  NegotiationTerms,
  NegotiationEvent,
  NegotiationAgreement,
  NegotiationStatus,
} from './types.js';

/** Raw row shape from the proposals table. */
interface ProposalRow {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  task_json: string;
  terms_json: string;
  status: NegotiationStatus;
  created_at: number;
  expires_at: number;
  history_json: string;
}

/** Raw row shape from the agreements table. */
interface AgreementRow {
  id: string;
  proposal_id: string;
  from_agent_id: string;
  to_agent_id: string;
  agreed_terms_json: string;
  task_json: string;
  created_at: number;
}

/**
 * SQLite-backed negotiation engine for agent-to-agent proposals, counter-offers,
 * acceptance, rejection, cancellation, and expiration processing.
 *
 * @example
 * ```ts
 * const negotiator = new Negotiator();
 * const proposal = negotiator.propose('agent-a', 'agent-b', task, terms, 60_000);
 * const agreement = negotiator.accept(proposal.id, 'agent-b');
 * ```
 */
export class Negotiator {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS negotiation_proposals (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        task_json TEXT NOT NULL,
        terms_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        history_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_neg_from ON negotiation_proposals(from_agent_id);
      CREATE INDEX IF NOT EXISTS idx_neg_to ON negotiation_proposals(to_agent_id);
      CREATE INDEX IF NOT EXISTS idx_neg_status ON negotiation_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_neg_expires ON negotiation_proposals(expires_at);

      CREATE TABLE IF NOT EXISTS negotiation_agreements (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        agreed_terms_json TEXT NOT NULL,
        task_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agr_from ON negotiation_agreements(from_agent_id);
      CREATE INDEX IF NOT EXISTS idx_agr_to ON negotiation_agreements(to_agent_id);
      CREATE INDEX IF NOT EXISTS idx_agr_proposal ON negotiation_agreements(proposal_id);
    `);
  }

  /**
   * Create a negotiation proposal.
   * @param fromAgentId - The proposing agent.
   * @param toAgentId - The target agent.
   * @param task - What the proposer wants done.
   * @param terms - Proposed terms.
   * @param ttlMs - Time-to-live in milliseconds (default 5 minutes).
   */
  propose(
    fromAgentId: string,
    toAgentId: string,
    task: NegotiationProposal['task'],
    terms: NegotiationTerms,
    ttlMs: number = 300_000,
  ): NegotiationProposal {
    const now = Date.now();
    const id = randomUUID();
    const history: NegotiationEvent[] = [
      { type: 'propose', agentId: fromAgentId, terms, timestamp: now },
    ];

    const proposal: NegotiationProposal = {
      id,
      fromAgentId,
      toAgentId,
      task,
      terms,
      status: 'proposed',
      createdAt: now,
      expiresAt: now + ttlMs,
      history,
    };

    this.db.prepare(`
      INSERT INTO negotiation_proposals (id, from_agent_id, to_agent_id, task_json, terms_json, status, created_at, expires_at, history_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fromAgentId,
      toAgentId,
      JSON.stringify(task),
      JSON.stringify(terms),
      'proposed',
      now,
      now + ttlMs,
      JSON.stringify(history),
    );

    return proposal;
  }

  /**
   * Counter a proposal with new terms. Only the target agent can counter a
   * proposal in 'proposed' or 'countered' status.
   */
  counter(proposalId: string, agentId: string, newTerms: NegotiationTerms): NegotiationProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return null;
    if (proposal.status !== 'proposed' && proposal.status !== 'countered') return null;

    // Either party can counter
    if (agentId !== proposal.fromAgentId && agentId !== proposal.toAgentId) return null;

    const now = Date.now();
    if (now >= proposal.expiresAt) return null;

    const event: NegotiationEvent = { type: 'counter', agentId, terms: newTerms, timestamp: now };
    const history = [...proposal.history, event];

    this.db.prepare(`
      UPDATE negotiation_proposals SET status = ?, terms_json = ?, history_json = ? WHERE id = ?
    `).run('countered', JSON.stringify(newTerms), JSON.stringify(history), proposalId);

    return { ...proposal, status: 'countered', terms: newTerms, history };
  }

  /**
   * Accept a proposal, creating a binding agreement. The accepting agent must
   * be the one who did NOT make the most recent proposal/counter.
   */
  accept(proposalId: string, agentId: string): NegotiationAgreement | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return null;
    if (proposal.status !== 'proposed' && proposal.status !== 'countered') return null;

    // The accepting agent must be a party to this negotiation
    if (agentId !== proposal.fromAgentId && agentId !== proposal.toAgentId) return null;

    const now = Date.now();
    if (now >= proposal.expiresAt) return null;

    // The accepting agent must not be the last one who proposed/countered
    const lastEvent = proposal.history[proposal.history.length - 1];
    if (lastEvent && (lastEvent.type === 'propose' || lastEvent.type === 'counter') && lastEvent.agentId === agentId) {
      return null; // Can't accept your own proposal/counter
    }

    const event: NegotiationEvent = { type: 'accept', agentId, timestamp: now };
    const history = [...proposal.history, event];

    this.db.prepare(`
      UPDATE negotiation_proposals SET status = ?, history_json = ? WHERE id = ?
    `).run('accepted', JSON.stringify(history), proposalId);

    const agreementId = randomUUID();
    const agreement: NegotiationAgreement = {
      id: agreementId,
      proposalId,
      fromAgentId: proposal.fromAgentId,
      toAgentId: proposal.toAgentId,
      agreedTerms: proposal.terms,
      task: proposal.task,
      createdAt: now,
    };

    this.db.prepare(`
      INSERT INTO negotiation_agreements (id, proposal_id, from_agent_id, to_agent_id, agreed_terms_json, task_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agreementId,
      proposalId,
      proposal.fromAgentId,
      proposal.toAgentId,
      JSON.stringify(proposal.terms),
      JSON.stringify(proposal.task),
      now,
    );

    return agreement;
  }

  /**
   * Reject a proposal. Either party can reject.
   */
  reject(proposalId: string, agentId: string, reason?: string): NegotiationProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return null;
    if (proposal.status !== 'proposed' && proposal.status !== 'countered') return null;
    if (agentId !== proposal.fromAgentId && agentId !== proposal.toAgentId) return null;

    const now = Date.now();
    const event: NegotiationEvent = { type: 'reject', agentId, reason, timestamp: now };
    const history = [...proposal.history, event];

    this.db.prepare(`
      UPDATE negotiation_proposals SET status = ?, history_json = ? WHERE id = ?
    `).run('rejected', JSON.stringify(history), proposalId);

    return { ...proposal, status: 'rejected', history };
  }

  /**
   * Cancel a proposal. Only the original proposer can cancel, and only if the
   * proposal is still in 'proposed' or 'countered' status.
   */
  cancel(proposalId: string, agentId: string): NegotiationProposal | null {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return null;
    if (proposal.status !== 'proposed' && proposal.status !== 'countered') return null;
    if (agentId !== proposal.fromAgentId) return null; // Only proposer can cancel

    const now = Date.now();
    const event: NegotiationEvent = { type: 'cancel', agentId, timestamp: now };
    const history = [...proposal.history, event];

    this.db.prepare(`
      UPDATE negotiation_proposals SET status = ?, history_json = ? WHERE id = ?
    `).run('cancelled', JSON.stringify(history), proposalId);

    return { ...proposal, status: 'cancelled', history };
  }

  /**
   * Get proposals for an agent (as sender or receiver), optionally filtered by status.
   */
  getProposals(agentId: string, status?: NegotiationStatus): NegotiationProposal[] {
    let sql = 'SELECT * FROM negotiation_proposals WHERE (from_agent_id = ? OR to_agent_id = ?)';
    const params: unknown[] = [agentId, agentId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as ProposalRow[];
    return rows.map(this.rowToProposal);
  }

  /**
   * Get agreements for an agent (as sender or receiver).
   */
  getAgreements(agentId: string): NegotiationAgreement[] {
    const rows = this.db.prepare(
      'SELECT * FROM negotiation_agreements WHERE from_agent_id = ? OR to_agent_id = ? ORDER BY created_at DESC',
    ).all(agentId, agentId) as AgreementRow[];
    return rows.map(this.rowToAgreement);
  }

  /**
   * Get a specific proposal by ID.
   */
  getProposal(proposalId: string): NegotiationProposal | null {
    const row = this.db.prepare(
      'SELECT * FROM negotiation_proposals WHERE id = ?',
    ).get(proposalId) as ProposalRow | undefined;
    return row ? this.rowToProposal(row) : null;
  }

  /**
   * Process expired proposals — marks any active proposals past their expiresAt
   * as 'expired' and records the event. Returns the newly expired proposals.
   */
  processExpirations(): NegotiationProposal[] {
    const now = Date.now();
    const rows = this.db.prepare(
      "SELECT * FROM negotiation_proposals WHERE status IN ('proposed', 'countered') AND expires_at <= ?",
    ).all(now) as ProposalRow[];

    const expired: NegotiationProposal[] = [];

    for (const row of rows) {
      const proposal = this.rowToProposal(row);
      const event: NegotiationEvent = { type: 'expire', agentId: 'system', timestamp: now };
      const history = [...proposal.history, event];

      this.db.prepare(
        'UPDATE negotiation_proposals SET status = ?, history_json = ? WHERE id = ?',
      ).run('expired', JSON.stringify(history), row.id);

      expired.push({ ...proposal, status: 'expired', history });
    }

    return expired;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private rowToProposal(row: ProposalRow): NegotiationProposal {
    return {
      id: row.id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      task: JSON.parse(row.task_json),
      terms: JSON.parse(row.terms_json),
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      history: JSON.parse(row.history_json),
    };
  }

  private rowToAgreement(row: AgreementRow): NegotiationAgreement {
    return {
      id: row.id,
      proposalId: row.proposal_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      agreedTerms: JSON.parse(row.agreed_terms_json),
      task: JSON.parse(row.task_json),
      createdAt: row.created_at,
    };
  }
}
