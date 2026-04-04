import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { createHmac } from 'crypto';
import Database from 'better-sqlite3';
import { WebhookRegistry } from '../src/gateway/webhooks.js';
import {
  WebhookDeliverer,
  WebhookPayload,
  HttpFetcher,
} from '../src/gateway/webhook-delivery.js';

describe('WebhookRegistry', () => {
  let db: Database.Database;
  let registry: WebhookRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new WebhookRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should register a webhook with generated id and secret', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook', ['task.completed']);
    expect(webhook.webhookId).toBeDefined();
    expect(webhook.secret).toBeDefined();
    expect(webhook.secret.length).toBe(64); // 32 bytes hex
    expect(webhook.orgId).toBe('acme-corp');
    expect(webhook.url).toBe('http://example.com/hook');
    expect(webhook.events).toEqual(['task.completed']);
    expect(webhook.status).toBe('active');
    expect(webhook.failureCount).toBe(0);
  });

  it('should list webhooks for an org', () => {
    registry.register('acme-corp', 'http://example.com/hook1', ['task.completed']);
    registry.register('acme-corp', 'http://example.com/hook2', ['task.failed']);
    registry.register('widget-inc', 'http://widget.com/hook', ['task.completed']);

    const acmeHooks = registry.getWebhooks('acme-corp');
    expect(acmeHooks).toHaveLength(2);
    const widgetHooks = registry.getWebhooks('widget-inc');
    expect(widgetHooks).toHaveLength(1);
  });

  it('should get a webhook by id', () => {
    const created = registry.register('acme-corp', 'http://example.com/hook');
    const fetched = registry.getWebhook(created.webhookId);
    expect(fetched).toBeDefined();
    expect(fetched!.url).toBe('http://example.com/hook');
  });

  it('should return undefined for non-existent webhook', () => {
    expect(registry.getWebhook('non-existent')).toBeUndefined();
  });

  it('should disable a webhook', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    expect(registry.disableWebhook(webhook.webhookId)).toBe(true);
    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.status).toBe('disabled');
  });

  it('should delete a webhook', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    expect(registry.deleteWebhook(webhook.webhookId)).toBe(true);
    expect(registry.getWebhook(webhook.webhookId)).toBeUndefined();
  });

  it('should return false deleting non-existent webhook', () => {
    expect(registry.deleteWebhook('non-existent')).toBe(false);
  });

  it('should increment failure count', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    registry.incrementFailureCount(webhook.webhookId);
    registry.incrementFailureCount(webhook.webhookId);
    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.failureCount).toBe(2);
  });

  it('should reset failure count', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    registry.incrementFailureCount(webhook.webhookId);
    registry.incrementFailureCount(webhook.webhookId);
    registry.resetFailureCount(webhook.webhookId);
    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.failureCount).toBe(0);
  });

  it('should get active webhooks for event', () => {
    registry.register('acme-corp', 'http://example.com/hook1', ['task.completed']);
    const disabled = registry.register('acme-corp', 'http://example.com/hook2', ['task.completed']);
    registry.disableWebhook(disabled.webhookId);
    registry.register('acme-corp', 'http://example.com/hook3', ['task.failed']);

    const active = registry.getActiveWebhooksForEvent('acme-corp', 'task.completed');
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe('http://example.com/hook1');
  });

  it('should update last delivery time', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    expect(webhook.lastDeliveryAt).toBeUndefined();
    registry.updateLastDelivery(webhook.webhookId);
    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.lastDeliveryAt).toBeDefined();
  });

  it('should default events to task.completed and task.failed', () => {
    const webhook = registry.register('acme-corp', 'http://example.com/hook');
    expect(webhook.events).toEqual(['task.completed', 'task.failed']);
  });
});

describe('WebhookDeliverer', () => {
  let db: Database.Database;
  let registry: WebhookRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new WebhookRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
    return {
      eventType: 'task.completed',
      timestamp: new Date().toISOString(),
      traceId: 'trace-1',
      orgId: 'acme-corp',
      data: { result: 'success' },
      ...overrides,
    };
  }

  it('should sign payload with HMAC-SHA256', () => {
    const body = JSON.stringify({ test: 'data' });
    const secret = 'my-secret';
    const signature = WebhookDeliverer.signPayload(body, secret);
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(signature).toBe(expected);
  });

  it('should deliver successfully to a working endpoint', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: true, status: 200 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });

    const result = await deliverer.deliver(webhook, makePayload());
    expect(result).toBe(true);
  });

  it('should reset failure count on success', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    registry.incrementFailureCount(webhook.webhookId);
    registry.incrementFailureCount(webhook.webhookId);

    const fetcher: HttpFetcher = async () => ({ ok: true, status: 200 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliver(webhook, makePayload());

    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.failureCount).toBe(0);
  });

  it('should update lastDeliveryAt on success', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: true, status: 200 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliver(webhook, makePayload());

    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.lastDeliveryAt).toBeDefined();
  });

  it('should retry on failure and eventually give up', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    let attempts = 0;
    const fetcher: HttpFetcher = async () => {
      attempts++;
      return { ok: false, status: 500 };
    };
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    const result = await deliverer.deliver(webhook, makePayload());

    expect(result).toBe(false);
    expect(attempts).toBe(4); // 1 initial + 3 retries
  });

  it('should retry on exception and eventually give up', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    let attempts = 0;
    const fetcher: HttpFetcher = async () => {
      attempts++;
      throw new Error('Connection refused');
    };
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    const result = await deliverer.deliver(webhook, makePayload());

    expect(result).toBe(false);
    expect(attempts).toBe(4);
  });

  it('should increment failure count on persistent failure', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: false, status: 500 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliver(webhook, makePayload());

    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.failureCount).toBe(1);
  });

  it('should auto-disable after 5 consecutive failures', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: false, status: 500 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });

    // Deliver 5 times — each counts as 1 failure after all retries
    for (let i = 0; i < 5; i++) {
      await deliverer.deliver(webhook, makePayload());
    }

    const updated = registry.getWebhook(webhook.webhookId);
    expect(updated!.status).toBe('disabled');
    expect(updated!.failureCount).toBe(5);
  });

  it('should record delivery attempts in log', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: true, status: 200 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliver(webhook, makePayload());

    const log = deliverer.getDeliveryLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].success).toBe(true);
    expect(log[0].statusCode).toBe(200);
  });

  it('should clear delivery log', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    const fetcher: HttpFetcher = async () => ({ ok: true, status: 200 });
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliver(webhook, makePayload());
    deliverer.clearDeliveryLog();
    expect(deliverer.getDeliveryLog()).toHaveLength(0);
  });

  it('should succeed on retry after initial failure', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    let attempts = 0;
    const fetcher: HttpFetcher = async () => {
      attempts++;
      if (attempts <= 2) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    };
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    const result = await deliverer.deliver(webhook, makePayload());

    expect(result).toBe(true);
    expect(attempts).toBe(3);
  });

  it('should deliver to org with matching event webhooks', async () => {
    registry.register('acme-corp', 'http://localhost/hook1', ['task.completed']);
    registry.register('acme-corp', 'http://localhost/hook2', ['task.failed']);

    const deliveredUrls: string[] = [];
    const fetcher: HttpFetcher = async (url) => {
      deliveredUrls.push(url);
      return { ok: true, status: 200 };
    };
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    await deliverer.deliverToOrg('acme-corp', makePayload({ eventType: 'task.completed' }));

    expect(deliveredUrls).toHaveLength(1);
    expect(deliveredUrls[0]).toBe('http://localhost/hook1');
  });

  it('should send correct signature header', async () => {
    const webhook = registry.register('acme-corp', 'http://localhost/hook');
    let receivedHeaders: Record<string, string> = {};
    let receivedBody = '';
    const fetcher: HttpFetcher = async (_url, init) => {
      receivedHeaders = init.headers;
      receivedBody = init.body;
      return { ok: true, status: 200 };
    };
    const deliverer = new WebhookDeliverer(registry, { fetcher, backoffDelays: [0, 0, 0, 0] });
    const payload = makePayload();
    await deliverer.deliver(webhook, payload);

    const expectedSig = createHmac('sha256', webhook.secret).update(receivedBody).digest('hex');
    expect(receivedHeaders['X-MoltMesh-Signature']).toBe(expectedSig);
  });
});

describe('Webhook delivery with mock HTTP server', () => {
  let db: Database.Database;
  let registry: WebhookRegistry;
  let mockServer: http.Server;
  let mockPort: number;
  let receivedRequests: Array<{ method: string; url: string; headers: any; body: string }>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new WebhookRegistry(db);
    receivedRequests = [];

    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method!,
          url: req.url!,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        mockPort = (mockServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    mockServer.close();
    db.close();
  });

  it('should deliver webhook to mock server with HMAC signature', async () => {
    const webhook = registry.register('acme-corp', `http://127.0.0.1:${mockPort}/webhook`);
    const deliverer = new WebhookDeliverer(registry);
    const payload: WebhookPayload = {
      eventType: 'task.completed',
      timestamp: new Date().toISOString(),
      traceId: 'trace-123',
      orgId: 'acme-corp',
      data: { result: 'done' },
    };

    const result = await deliverer.deliver(webhook, payload);
    expect(result).toBe(true);
    expect(receivedRequests).toHaveLength(1);

    const req = receivedRequests[0];
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-moltmesh-signature']).toBeDefined();

    // Verify signature
    const expectedSig = createHmac('sha256', webhook.secret).update(req.body).digest('hex');
    expect(req.headers['x-moltmesh-signature']).toBe(expectedSig);

    // Verify body
    const parsed = JSON.parse(req.body);
    expect(parsed.eventType).toBe('task.completed');
    expect(parsed.traceId).toBe('trace-123');
  });
});
