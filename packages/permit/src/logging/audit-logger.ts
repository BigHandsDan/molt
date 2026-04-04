import { v4 as uuidv4 } from 'uuid';
import { ActionRequest, PolicyDecision } from '../engine/types.js';
import { AuditEntry, AuditQuery } from './types.js';
import { SqliteAuditStore } from './sqlite-store.js';

export class AuditLogger {
  private store: SqliteAuditStore;

  constructor(store: SqliteAuditStore) {
    this.store = store;
  }

  log(
    actionRequest: ActionRequest,
    decision: PolicyDecision,
    options?: {
      reversible?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): AuditEntry {
    const entry: AuditEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      actionRequest,
      decision: { ...decision, auditId: '' },
      outcome: 'pending',
      reversible: options?.reversible ?? false,
      metadata: options?.metadata,
    };

    // Set the auditId to match the entry id
    entry.decision.auditId = entry.id;

    this.store.insert(entry);
    return entry;
  }

  recordOutcome(auditId: string, outcome: AuditEntry['outcome']): void {
    this.store.updateOutcome(auditId, outcome);
  }

  markRolledBack(auditId: string, reverseActionId: string): void {
    this.store.updateOutcome(auditId, 'rolled_back', reverseActionId);
  }

  query(query: AuditQuery): AuditEntry[] {
    return this.store.query(query);
  }

  getById(id: string): AuditEntry | null {
    return this.store.getById(id);
  }
}
