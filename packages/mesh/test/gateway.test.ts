import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { MoltMesh } from '../src/bus.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';
import { AgentIdentity } from '../src/identity/types.js';
import { OrgTier } from '../src/federation/organization.js';
import { DEFAULT_NAMESPACE_QUOTAS } from '../src/federation/namespace.js';
import { GrantConditions } from '../src/federation/grants.js';
import { createAuthMiddleware } from '../src/gateway/auth.js';
import { createGatewayRouter } from '../src/gateway/router.js';


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

function makeGrantConditions(): GrantConditions {
  return {
    requireApproval: false,
    allowedTools: [],
    blockedTools: [],
    maxConcurrent: 10,
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

describe('Gateway API', () => {
  let bus: MoltMesh;
  let app: ReturnType<typeof express>;
  let server: http.Server;
  let apiKey: string;

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

    // Register contract
    bus.registerContract(
      makeContract({
        ownerOrgId: 'acme-corp',
        ownerNamespace: 'acme-corp/default',
        visibility: 'federated',
      })
    );

    // Register agent
    bus.registerAgent(makeAgent({ orgId: 'acme-corp', namespaceId: 'acme-corp/default' }), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    // Create grant from acme to widget
    bus.createGrant({
      grantId: 'grant-1',
      fromOrgId: 'acme-corp',
      toOrgId: 'widget-inc',
      contractIds: [],
      capabilities: ['research'],
      maxTokensPerDay: 100000,
      maxCostPerDay: 10,
      conditions: makeGrantConditions(),
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    // Create API key for widget
    const keyResult = bus.createApiKey('widget-inc', ['submit', 'read']);
    apiKey = keyResult.rawKey;

    // Build Express app
    app = express();
    app.use(express.json());

    const authMiddleware = createAuthMiddleware(
      bus.getApiKeyRegistry(),
      bus.getOrgRegistry(),
      bus.getRateLimiter()
    );
    const gatewayRouter = createGatewayRouter({ bus, webhookRegistry: bus.getWebhookRegistry() });
    app.use('/gateway/v1', authMiddleware, gatewayRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  afterEach(() => {
    server.close();
    bus.close();
  });

  // --- Auth tests ---

  it('should return 401 with no auth header', async () => {
    const res = await httpRequest(server, 'POST', '/gateway/v1/submit', { contractId: 'research' });
    expect(res.status).toBe(401);
    expect(res.data.success).toBe(false);
  });

  it('should return 401 with invalid key', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      { contractId: 'research' },
      {
        Authorization: 'Bearer mm_00000000000000000000000000000000',
      }
    );
    expect(res.status).toBe(401);
  });

  it('should return 401 with expired key', async () => {
    const expired = bus.createApiKey(
      'widget-inc',
      ['submit'],
      60,
      new Date(Date.now() - 86400000).toISOString()
    );
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      { contractId: 'research' },
      {
        Authorization: `Bearer ${expired.rawKey}`,
      }
    );
    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limit exceeded', async () => {
    // Create key with rate limit of 2
    const { rawKey } = bus.createApiKey('widget-inc', ['submit', 'read'], 2);

    // First 2 should succeed (or at least not be 429)
    await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${rawKey}`,
    });
    await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${rawKey}`,
    });

    // Third should be rate limited
    const res = await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${rawKey}`,
    });
    expect(res.status).toBe(429);
    expect(res.data.error).toContain('Rate limit');
  });

  // --- Submit tests ---

  it('should submit a cross-org task with valid key', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      {
        contractId: 'research',
        input: { query: 'test query' },
      },
      { Authorization: `Bearer ${apiKey}` }
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.traceId).toBeDefined();
    expect(res.data.data.status).toBeDefined();
  });

  it('should return 400 when contractId is missing', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      {},
      { Authorization: `Bearer ${apiKey}` }
    );
    expect(res.status).toBe(400);
    expect(res.data.error).toContain('contractId');
  });

  it('should return 404 for non-existent contract', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      {
        contractId: 'non-existent',
      },
      { Authorization: `Bearer ${apiKey}` }
    );
    expect(res.status).toBe(404);
  });

  it('should return 403 when key lacks submit scope', async () => {
    const { rawKey } = bus.createApiKey('widget-inc', ['read']);
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      {
        contractId: 'research',
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${rawKey}` }
    );
    expect(res.status).toBe(403);
  });

  // --- Contracts listing ---

  it('should list federated contracts visible to the caller org', async () => {
    const res = await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0].contractId).toBe('research');
  });

  it('should not list private contracts', async () => {
    bus.registerContract(
      makeContract({
        contractId: 'private-contract',
        capability: 'private',
        ownerOrgId: 'acme-corp',
        visibility: 'private',
      })
    );
    const res = await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.data.data.every((c: any) => c.visibility === 'federated')).toBe(true);
  });

  it('should not list federated contracts without a grant', async () => {
    // Register a new org and create contract for it
    bus.registerOrg({
      orgId: 'other-corp',
      name: 'Other Corp',
      tier: OrgTier.VENDOR,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.registerContract(
      makeContract({
        contractId: 'other-research',
        capability: 'other-research',
        ownerOrgId: 'other-corp',
        visibility: 'federated',
      })
    );
    // No grant between other-corp and widget-inc
    const res = await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    const contractIds = res.data.data.map((c: any) => c.contractId);
    expect(contractIds).not.toContain('other-research');
  });

  it('should return 403 when key lacks read scope for contracts', async () => {
    const { rawKey } = bus.createApiKey('widget-inc', ['submit']);
    const res = await httpRequest(server, 'GET', '/gateway/v1/contracts', null, {
      Authorization: `Bearer ${rawKey}`,
    });
    expect(res.status).toBe(403);
  });

  // --- Status check ---

  it('should check status of own trace', async () => {
    // Submit first
    const submitRes = await httpRequest(
      server,
      'POST',
      '/gateway/v1/submit',
      {
        contractId: 'research',
        input: { query: 'test' },
      },
      { Authorization: `Bearer ${apiKey}` }
    );

    const traceId = submitRes.data.data.traceId;
    const statusRes = await httpRequest(server, 'GET', `/gateway/v1/status/${traceId}`, null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.data.success).toBe(true);
    expect(statusRes.data.data.traceId).toBe(traceId);
  });

  it('should return 404 for non-existent trace', async () => {
    const res = await httpRequest(server, 'GET', '/gateway/v1/status/non-existent', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(404);
  });

  // --- Webhook endpoints ---

  it('should register a webhook', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/webhooks',
      {
        url: 'http://example.com/hook',
        events: ['task.completed'],
      },
      { Authorization: `Bearer ${apiKey}` }
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.url).toBe('http://example.com/hook');
    expect(res.data.data.secret).toBeDefined();
  });

  it('should list webhooks for org', async () => {
    await httpRequest(
      server,
      'POST',
      '/gateway/v1/webhooks',
      {
        url: 'http://example.com/hook1',
      },
      { Authorization: `Bearer ${apiKey}` }
    );
    await httpRequest(
      server,
      'POST',
      '/gateway/v1/webhooks',
      {
        url: 'http://example.com/hook2',
      },
      { Authorization: `Bearer ${apiKey}` }
    );

    const res = await httpRequest(server, 'GET', '/gateway/v1/webhooks', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(200);
    expect(res.data.data).toHaveLength(2);
  });

  it('should delete a webhook', async () => {
    const createRes = await httpRequest(
      server,
      'POST',
      '/gateway/v1/webhooks',
      {
        url: 'http://example.com/hook',
      },
      { Authorization: `Bearer ${apiKey}` }
    );
    const webhookId = createRes.data.data.webhookId;

    const delRes = await httpRequest(server, 'DELETE', `/gateway/v1/webhooks/${webhookId}`, null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.data.data.deleted).toBe(true);

    // Verify deleted
    const listRes = await httpRequest(server, 'GET', '/gateway/v1/webhooks', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(listRes.data.data).toHaveLength(0);
  });

  it('should return 404 deleting non-existent webhook', async () => {
    const res = await httpRequest(server, 'DELETE', '/gateway/v1/webhooks/non-existent', null, {
      Authorization: `Bearer ${apiKey}`,
    });
    expect(res.status).toBe(404);
  });

  it('should return 400 registering webhook without url', async () => {
    const res = await httpRequest(
      server,
      'POST',
      '/gateway/v1/webhooks',
      {},
      { Authorization: `Bearer ${apiKey}` }
    );
    expect(res.status).toBe(400);
  });
});
