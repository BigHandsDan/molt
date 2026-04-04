import { createHmac } from 'crypto';
import { WebhookRegistration, WebhookRegistry } from './webhooks.js';

/** Payload delivered to webhook endpoints when events occur. */
export interface WebhookPayload {
  eventType: string;
  timestamp: string;
  traceId: string;
  orgId: string;
  data: unknown;
}

/** Record of a single webhook delivery attempt. */
export interface DeliveryAttempt {
  webhookId: string;
  timestamp: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  attempt: number;
}

/** HTTP client function for making webhook delivery requests. */
export type HttpFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number }>;

/** Configuration options for the webhook delivery system. */
export interface WebhookDelivererOptions {
  fetcher?: HttpFetcher;
  backoffDelays?: number[];
}

/** Delivers webhook payloads to registered endpoints with retry logic and automatic disabling on repeated failures. */
export class WebhookDeliverer {
  private deliveryLog: DeliveryAttempt[] = [];
  private webhookRegistry: WebhookRegistry;
  private maxRetries = 3;
  private maxFailuresBeforeDisable = 5;
  private fetcher: HttpFetcher;
  private backoffDelays: number[];

  constructor(
    webhookRegistry: WebhookRegistry,
    fetcherOrOptions?: HttpFetcher | WebhookDelivererOptions
  ) {
    this.webhookRegistry = webhookRegistry;
    if (typeof fetcherOrOptions === 'function') {
      this.fetcher = fetcherOrOptions;
      this.backoffDelays = [0, 1000, 4000, 16000];
    } else if (fetcherOrOptions && typeof fetcherOrOptions === 'object') {
      this.fetcher = fetcherOrOptions.fetcher || defaultFetcher;
      this.backoffDelays = fetcherOrOptions.backoffDelays || [0, 1000, 4000, 16000];
    } else {
      this.fetcher = defaultFetcher;
      this.backoffDelays = [0, 1000, 4000, 16000];
    }
  }

  /** Compute an HMAC-SHA256 signature for a webhook payload. */
  static signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /** Deliver a payload to a single webhook, retrying on failure. Returns true if delivery succeeded. */
  async deliver(webhook: WebhookRegistration, payload: WebhookPayload): Promise<boolean> {
    const body = JSON.stringify(payload);
    const signature = WebhookDeliverer.signPayload(body, webhook.secret);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0 && this.backoffDelays[attempt]) {
        await this.sleep(this.backoffDelays[attempt]);
      }

      try {
        const response = await this.fetcher(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-MoltMesh-Signature': signature,
            'X-MoltMesh-Webhook-Id': webhook.webhookId,
          },
          body,
        });

        this.deliveryLog.push({
          webhookId: webhook.webhookId,
          timestamp: new Date().toISOString(),
          success: response.ok,
          statusCode: response.status,
          attempt: attempt + 1,
        });

        if (response.ok) {
          this.webhookRegistry.resetFailureCount(webhook.webhookId);
          this.webhookRegistry.updateLastDelivery(webhook.webhookId);
          return true;
        }
      } catch (err) {
        this.deliveryLog.push({
          webhookId: webhook.webhookId,
          timestamp: new Date().toISOString(),
          success: false,
          error: (err as Error).message,
          attempt: attempt + 1,
        });
      }
    }

    // All retries failed
    const failureCount = this.webhookRegistry.incrementFailureCount(webhook.webhookId);
    if (failureCount >= this.maxFailuresBeforeDisable) {
      this.webhookRegistry.disableWebhook(webhook.webhookId);
    }

    return false;
  }

  /** Deliver a payload to all active webhooks for an organization that match the event type. */
  async deliverToOrg(orgId: string, payload: WebhookPayload): Promise<void> {
    const webhooks = this.webhookRegistry.getActiveWebhooksForEvent(orgId, payload.eventType);
    for (const webhook of webhooks) {
      await this.deliver(webhook, payload);
    }
  }

  /** Get the in-memory delivery log. */
  getDeliveryLog(): DeliveryAttempt[] {
    return [...this.deliveryLog];
  }

  /** Clear the in-memory delivery log. */
  clearDeliveryLog(): void {
    this.deliveryLog = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function defaultFetcher(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
): Promise<{ ok: boolean; status: number }> {
  // Use dynamic import for Node's http/https
  const { request } = await import('http');
  const { request: httpsRequest } = await import('https');
  const { URL } = await import('url');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : request;

    const req = reqFn(
      url,
      {
        method: init.method,
        headers: init.headers,
      },
      (res) => {
        // Drain the response
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            status: res.statusCode || 500,
          });
        });
      }
    );

    req.on('error', reject);
    req.write(init.body);
    req.end();
  });
}
