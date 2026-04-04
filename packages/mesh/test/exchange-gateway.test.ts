import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { MoltMesh } from '../src/bus.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';
import { AgentIdentity } from '../src/identity/types.js';
import { OrgTier } from '../src/federation/organization.js';
import { DEFAULT_NAMESPACE_QUOTAS } from '../src/federation/namespace.js';
import {
  ServiceListing,
  ServiceCategory,
  ServicePricing,
  ServiceSLA,
} from '../src/exchange/catalog.js';
import { createAuthMiddleware } from '../src/gateway/auth.js';
import { createExchangeRouter } from '../src/exchange/exchange-router.js';

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    contractId: 'research',
    version: '1.0.0',
    capability: 'research',
    description: 'Research contract',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    outputSchema: { type: 'object' },
    securityClass: TrustTier.INTERNAL_TRUSTED,
    requiredTools: [],
    timeout: 5000,
    retryPolicy: { maxRetries: 0, backoffMs: 100 },
    approvalRequired: false,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: 'agent-1',
    name: 'Agent 1',
    description: 'Test agent',
    trustTier: TrustTier.INTERNAL_TRUSTED,
    capabilities: ['research'],
    allowedTools: [],
    metadata: {},
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePricing(overrides: Partial<ServicePricing> = {}): ServicePricing {
  return {
    model: 'per_request',
    currency: 'credits',
    perRequestCost: 10,
    subscriptionRate: 50,
    freeQuota: 100,
    ...overrides,
  };
}

function makeSLA(overrides: Partial<ServiceSLA> = {}): ServiceSLA {
  return {
    maxLatencyMs: 5000,
    availabilityPct: 99.5,
    maxConcurrent: 10,
    supportTier: 'standard',
    ...overrides,
  };
}

function makeListing(overrides: Partial<ServiceListing> = {}): ServiceListing {
  return {
    listingId: 'listing-1',
    orgId: 'acme-corp',
    name: 'Acme Research Agent',
    description: 'AI-powered research service',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research'],
    contractIds: ['research'],
    pricing: makePricing(),
    sla: makeSLA(),
    tags: ['research', 'ai'],
    status: 'published',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
    ...overrides,
  };
}

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Exchange Gateway', () => {
  let bus: MoltMesh;
  let app: ReturnType<typeof express>;
  let server: http.Server;
  let buyerApiKey: string;
  let sellerApiKey: string;

  beforeEach(async () => {
    bus = new MoltMesh();

    // Setup orgs
    bus.registerOrg({
      orgId: 'acme-corp',
      name: 'Acme Corp',
      tier: OrgTier.OWNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.registerOrg({
      orgId: 'widget-inc',
      name: 'Widget Inc',
      tier: OrgTier.PARTNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    // Setup namespaces
    bus.createNamespace({
      namespaceId: 'acme-corp/default',
      orgId: 'acme-corp',
      name: 'default',
      quotas: DEFAULT_NAMESPACE_QUOTAS,
      metadata: {},
    });
    bus.createNamespace({
      namespaceId: 'widget-inc/default',
      orgId: 'widget-inc',
      name: 'default',
      quotas: DEFAULT_NAMESPACE_QUOTAS,
      metadata: {},
    });

    // Register contract and agent
    bus.registerContract(
      makeContract({
        ownerOrgId: 'acme-corp',
        ownerNamespace: 'acme-corp/default',
        visibility: 'federated',
      })
    );
    bus.registerAgent(makeAgent({ orgId: 'acme-corp', namespaceId: 'acme-corp/default' }), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    // Create grant from acme to widget
    bus.createGrant({
      grantId: 'grant-1',
      fromOrgId: 'acme-corp',
      toOrgId: 'widget-inc',
      contractIds: ['research'],
      capabilities: ['research'],
      maxTokensPerDay: 100000,
      maxCostPerDay: 100,
      conditions: { requireApproval: false, allowedTools: [], blockedTools: [], maxConcurrent: 10 },
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    // Setup credit accounts
    bus.createCreditAccount('acme-corp', 0);
    bus.createCreditAccount('widget-inc', 1000);

    // Publish listing
    bus.publishService(makeListing());

    // Create API keys
    buyerApiKey = bus.createApiKey('widget-inc', ['submit', 'read']).rawKey;
    sellerApiKey = bus.createApiKey('acme-corp', ['submit', 'read']).rawKey;

    // Build Express app
    app = express();
    app.use(express.json());

    const authMiddleware = createAuthMiddleware(
      bus.getApiKeyRegistry(),
      bus.getOrgRegistry(),
      bus.getRateLimiter()
    );
    const exchangeRouter = createExchangeRouter({ bus });
    app.use('/exchange/v1', authMiddleware, exchangeRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  afterEach(() => {
    server.close();
    bus.close();
  });

  // --- Catalog endpoints ---

  it('should browse catalog and return published listings', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0].name).toBe('Acme Research Agent');
  });

  it('should search catalog with keyword', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog?q=research', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should search catalog with category filter', async () => {
    // Publish another listing in a different category
    bus.publishService(
      makeListing({
        listingId: 'listing-2',
        name: 'Code Review Agent',
        category: ServiceCategory.CODE,
        contractIds: ['research'],
      })
    );

    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog?category=code', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0].category).toBe('code');
  });

  it('should get service detail with reviews', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog/listing-1', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data.listingId).toBe('listing-1');
    expect(res.data.data.reviews).toBeDefined();
  });

  it('should return 404 for nonexistent listing', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog/nonexistent', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(404);
  });

  it('should get categories with counts', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/catalog/categories', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toBeInstanceOf(Array);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  // --- Invoke endpoints ---

  it('should invoke-by-listing happy path (per-request pricing)', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-1',
      {
        input: { query: 'test research query' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.traceId).toBeDefined();
    expect(res.data.data.status).toBeDefined();
    expect(res.data.data.cost).toBeDefined();
  });

  it('should invoke-by-listing with subscription (no charge if within quota)', async () => {
    // Subscribe first
    await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-1',
      {
        plan: 'monthly',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const balanceBefore = bus.getBalance('widget-inc');

    // Invoke — should be free since within quota
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-1',
      {
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.data.cost).toBe(0);

    const balanceAfter = bus.getBalance('widget-inc');
    expect(balanceAfter).toBe(balanceBefore);
  });

  it('should charge overage for invoke when over subscription quota', async () => {
    // Publish a listing with very small quota
    bus.publishService(
      makeListing({
        listingId: 'listing-small',
        name: 'Small Quota Service',
        pricing: makePricing({ freeQuota: 1, perRequestCost: 5 }),
      })
    );

    // Subscribe
    const subRes = await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-small',
      {
        plan: 'monthly',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(subRes.status).toBe(200);

    // Use the one included request
    await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-small',
      {
        input: { query: 'first' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    // This should be overage
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-small',
      {
        input: { query: 'overage' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.data.cost).toBeGreaterThan(0);
  });

  it('should return 402 when insufficient balance for invoke', async () => {
    // Create a poor org
    bus.registerOrg({
      orgId: 'poor-org',
      name: 'Poor Org',
      tier: OrgTier.VENDOR,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.createCreditAccount('poor-org', 0);
    const poorKey = bus.createApiKey('poor-org', ['submit', 'read']).rawKey;

    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-1',
      {
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${poorKey}` }
    );

    expect(res.status).toBe(402);
  });

  it('should return 404 when invoking nonexistent listing', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/nonexistent',
      {
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(res.status).toBe(404);
  });

  // --- Subscription endpoints ---

  it('should subscribe to a listing and get auto-grant', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-1',
      {
        plan: 'monthly',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.subscriptionId).toBeDefined();
    expect(res.data.data.status).toBe('active');
    expect(res.data.data.grantId).toBeTruthy();
  });

  it('should list my subscriptions', async () => {
    // Subscribe first
    await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-1',
      {
        plan: 'monthly',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const res = await httpRequest(server, 'GET', '/exchange/v1/subscriptions', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toHaveLength(1);
  });

  it('should cancel a subscription', async () => {
    const subRes = await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-1',
      {
        plan: 'monthly',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const subId = subRes.data.data.subscriptionId;
    const delRes = await httpRequest(
      server,
      'DELETE',
      `/exchange/v1/subscriptions/${subId}`,
      null,
      {
        Authorization: `Bearer ${buyerApiKey}`,
      }
    );

    expect(delRes.status).toBe(200);
    expect(delRes.data.data.status).toBe('cancelled');
  });

  it('should return 400 for invalid plan', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/subscribe/listing-1',
      {
        plan: 'invalid',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(res.status).toBe(400);
  });

  // --- Billing endpoints ---

  it('should get balance', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/billing/balance', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data.balance).toBe(1000);
  });

  it('should get transactions', async () => {
    // Create a transaction first by invoking
    await httpRequest(
      server,
      'POST',
      '/exchange/v1/invoke/listing-1',
      {
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const res = await httpRequest(server, 'GET', '/exchange/v1/billing/transactions', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toBeInstanceOf(Array);
  });

  it('should get earnings as provider', async () => {
    const res = await httpRequest(server, 'GET', '/exchange/v1/billing/earnings', null, {
      Authorization: `Bearer ${sellerApiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toBeDefined();
    expect(typeof res.data.data.totalEarned).toBe('number');
  });

  it('should add credits via topup', async () => {
    const balanceBefore = bus.getBalance('widget-inc');
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/billing/topup',
      {
        amount: 500,
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);

    const balanceAfter = bus.getBalance('widget-inc');
    expect(balanceAfter).toBe(balanceBefore + 500);
  });

  it('should reject invalid topup amount', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/billing/topup',
      {
        amount: -100,
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(res.status).toBe(400);
  });

  // --- Review endpoints ---

  it('should submit a review', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews',
      {
        listingId: 'listing-1',
        rating: 4,
        title: 'Great service',
        body: 'Works well for research tasks',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.rating).toBe(4);
    expect(res.data.data.reviewerOrgId).toBe('widget-inc');
  });

  it('should get reviews for a listing', async () => {
    // Submit a review first
    await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews',
      {
        listingId: 'listing-1',
        rating: 5,
        title: 'Excellent',
        body: 'Top-notch',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const res = await httpRequest(server, 'GET', '/exchange/v1/reviews/listing-1', null, {
      Authorization: `Bearer ${buyerApiKey}`,
    });

    expect(res.status).toBe(200);
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0].rating).toBe(5);
  });

  it('should allow provider to respond to a review', async () => {
    // Submit review from buyer
    const reviewRes = await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews',
      {
        listingId: 'listing-1',
        rating: 4,
        title: 'Good',
        body: 'Pretty good',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );

    const reviewId = reviewRes.data.data.reviewId;

    // Respond as seller
    const respondRes = await httpRequest(
      server,
      'POST',
      `/exchange/v1/reviews/${reviewId}/respond`,
      {
        body: 'Thank you for your feedback!',
      },
      { Authorization: `Bearer ${sellerApiKey}` }
    );

    expect(respondRes.status).toBe(200);
    expect(respondRes.data.data.response).toBeDefined();
    expect(respondRes.data.data.response.body).toBe('Thank you for your feedback!');
  });

  it('should reject review with missing fields', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews',
      {
        listingId: 'listing-1',
        rating: 4,
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(res.status).toBe(400);
  });

  it('should reject review with invalid rating', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews',
      {
        listingId: 'listing-1',
        rating: 0,
        title: 'Bad',
        body: 'Should fail',
      },
      { Authorization: `Bearer ${buyerApiKey}` }
    );
    expect(res.status).toBe(400);
  });

  it('should return 404 responding to nonexistent review', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/exchange/v1/reviews/nonexistent/respond',
      {
        body: 'Hello',
      },
      { Authorization: `Bearer ${sellerApiKey}` }
    );
    expect(res.status).toBe(404);
  });
});
