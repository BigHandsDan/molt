import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

/** Lifecycle status of a webhook registration. */
export type WebhookStatus = 'active' | 'disabled';

/** A registered webhook endpoint that receives event notifications. */
export interface WebhookRegistration {
  webhookId: string;
  orgId: string;
  url: string;
  secret: string;
  events: string[];
  status: WebhookStatus;
  failureCount: number;
  lastDeliveryAt?: string;
}

interface WebhookRow {
  webhook_id: string;
  org_id: string;
  url: string;
  secret: string;
  events: string;
  status: string;
  failure_count: number;
  last_delivery_at: string | null;
}

/** SQLite-backed registry for managing webhook registrations per organization. */
export class WebhookRegistry {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_registrations (
        webhook_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        failure_count INTEGER DEFAULT 0,
        last_delivery_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhook_registrations(org_id);
    `);
  }

  /** Register a new webhook for an organization, auto-generating a signing secret. */
  register(
    orgId: string,
    url: string,
    events: string[] = ['task.completed', 'task.failed']
  ): WebhookRegistration {
    const webhookId = uuidv4();
    const secret = randomBytes(32).toString('hex');

    const webhook: WebhookRegistration = {
      webhookId,
      orgId,
      url,
      secret,
      events,
      status: 'active',
      failureCount: 0,
    };

    this.db
      .prepare(
        `
      INSERT INTO webhook_registrations (webhook_id, org_id, url, secret, events, status, failure_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(webhookId, orgId, url, secret, JSON.stringify(events), 'active', 0);

    return webhook;
  }

  /** List all webhooks for an organization. */
  getWebhooks(orgId: string): WebhookRegistration[] {
    const rows = this.db
      .prepare('SELECT * FROM webhook_registrations WHERE org_id = ? ORDER BY webhook_id ASC')
      .all(orgId) as WebhookRow[];
    return rows.map(this.rowToWebhook);
  }

  /** Retrieve a single webhook by ID. */
  getWebhook(webhookId: string): WebhookRegistration | undefined {
    const row = this.db
      .prepare('SELECT * FROM webhook_registrations WHERE webhook_id = ?')
      .get(webhookId) as WebhookRow | undefined;
    if (!row) return undefined;
    return this.rowToWebhook(row);
  }

  /** Get all active webhooks for an org that subscribe to a given event type. */
  getActiveWebhooksForEvent(orgId: string, eventType: string): WebhookRegistration[] {
    const rows = this.db
      .prepare(`SELECT * FROM webhook_registrations WHERE org_id = ? AND status = 'active'`)
      .all(orgId) as WebhookRow[];

    return rows.map(this.rowToWebhook).filter((w) => w.events.includes(eventType));
  }

  /** Disable a webhook, preventing further deliveries. */
  disableWebhook(webhookId: string): boolean {
    const result = this.db
      .prepare(`UPDATE webhook_registrations SET status = 'disabled' WHERE webhook_id = ?`)
      .run(webhookId);
    return result.changes > 0;
  }

  /** Permanently delete a webhook registration. */
  deleteWebhook(webhookId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM webhook_registrations WHERE webhook_id = ?')
      .run(webhookId);
    return result.changes > 0;
  }

  /** Increment the failure count for a webhook and return the new count. */
  incrementFailureCount(webhookId: string): number {
    this.db
      .prepare(
        'UPDATE webhook_registrations SET failure_count = failure_count + 1 WHERE webhook_id = ?'
      )
      .run(webhookId);
    const webhook = this.getWebhook(webhookId);
    return webhook?.failureCount || 0;
  }

  /** Reset the failure count for a webhook back to zero. */
  resetFailureCount(webhookId: string): void {
    this.db
      .prepare('UPDATE webhook_registrations SET failure_count = 0 WHERE webhook_id = ?')
      .run(webhookId);
  }

  /** Update the last delivery timestamp for a webhook. */
  updateLastDelivery(webhookId: string): void {
    this.db
      .prepare('UPDATE webhook_registrations SET last_delivery_at = ? WHERE webhook_id = ?')
      .run(new Date().toISOString(), webhookId);
  }

  private rowToWebhook(row: WebhookRow): WebhookRegistration {
    return {
      webhookId: row.webhook_id,
      orgId: row.org_id,
      url: row.url,
      secret: row.secret,
      events: JSON.parse(row.events),
      status: row.status as WebhookStatus,
      failureCount: row.failure_count,
      lastDeliveryAt: row.last_delivery_at || undefined,
    };
  }
}
