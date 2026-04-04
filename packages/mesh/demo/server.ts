import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { OrgTier } from '../src/index.js';
import { setupDemo } from './scenario.js';
import { PLANNER_IDENTITY, plannerHandler } from './agents/planner.js';
import { createAuthMiddleware } from '../src/gateway/auth.js';
import { createGatewayRouter } from '../src/gateway/router.js';
import { createExchangeRouter } from '../src/exchange/exchange-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3456;

async function main() {
  const { bus, cleanup } = await setupDemo();

  const app = express();
  app.use(express.json());

  // Serve operator console
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'console', 'index.html'));
  });

  // Submit a task to the bus
  app.post('/api/submit', async (req, res) => {
    try {
      const { request } = req.body;
      if (!request || typeof request !== 'string') {
        res.status(400).json({ error: 'Missing "request" string in body' });
        return;
      }

      // Run the planner
      const plan = plannerHandler({ request });

      // Submit each subtask
      const results = [];
      const traceIds: string[] = [];
      for (const subtask of plan.subtasks) {
        const contract = bus.getContracts().find((c) => c.contractId === subtask.contractId);
        if (!contract) continue;

        const envelope = bus.createEnvelope(
          subtask.contractId,
          contract.version,
          subtask.input,
          PLANNER_IDENTITY
        );

        const result = await bus.submit(envelope);
        results.push({ contractId: subtask.contractId, result });
        traceIds.push(envelope.traceId);
      }

      res.json({ plan: plan.subtasks, results, traceIds });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List recent traces
  app.get('/api/traces', (_req, res) => {
    const traces = bus.getRecentTraces(50);
    res.json(traces);
  });

  // Get trace detail
  app.get('/api/traces/:id', (req, res) => {
    const events = bus.getTrace(req.params.id);
    if (events.length === 0) {
      res.status(404).json({ error: 'Trace not found' });
      return;
    }
    res.json(events);
  });

  // List contracts
  app.get('/api/contracts', (_req, res) => {
    res.json(bus.getContracts());
  });

  // List agents
  app.get('/api/agents', (_req, res) => {
    const agents = bus.getAgents();
    const budgets = bus.getAllBudgets();
    const circuitStates = bus.getCircuitStates();
    const spendData = bus.getAllAgentSpend();

    const enriched = agents.map((a) => ({
      ...a,
      budget: budgets.find((b) => b.agentId === a.agentId),
      circuitState: circuitStates[a.agentId] || 'closed',
      spend: spendData.find((s) => s.agentId === a.agentId) || {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        invocationCount: 0,
        avgTokensPerInvocation: 0,
      },
    }));
    res.json(enriched);
  });

  // Dead letters
  app.get('/api/dead-letters', (req, res) => {
    const includeResolved = req.query.includeResolved === 'true';
    res.json(bus.getDeadLetters(includeResolved));
  });

  // Cost per agent
  app.get('/api/costs/:agentId', (req, res) => {
    const spend = bus.getAgentSpend(req.params.agentId);
    res.json(spend);
  });

  // All agent costs
  app.get('/api/costs', (_req, res) => {
    res.json(bus.getAllAgentSpend());
  });

  // Approve an approval request
  app.post('/api/approve/:id', (req, res) => {
    const result = bus.approve(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    res.json(result);
  });

  // Deny an approval request
  app.post('/api/deny/:id', (req, res) => {
    const reason = req.body?.reason || 'Denied by operator';
    const result = bus.deny(req.params.id, reason);
    if (!result) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    res.json(result);
  });

  // Pending approvals
  app.get('/api/approvals', (_req, res) => {
    res.json(bus.getPendingApprovals());
  });

  // Circuit breaker states
  app.get('/api/circuit-states', (_req, res) => {
    res.json(bus.getCircuitStates());
  });

  // Agent budgets
  app.get('/api/budgets', (_req, res) => {
    res.json(bus.getAllBudgets());
  });

  // Resolve dead letter
  app.post('/api/dead-letters/:id/resolve', (req, res) => {
    const resolved = bus.resolveDeadLetter(req.params.id);
    res.json({ resolved });
  });

  // Trace cost
  app.get('/api/trace-cost/:traceId', (req, res) => {
    res.json(bus.getTraceCost(req.params.traceId));
  });

  // Policy decisions (query traces for policy events)
  app.get('/api/policy-log', (_req, res) => {
    const policyEvents = bus.getTraces({ eventType: 'policy', limit: 100 });
    res.json(policyEvents);
  });

  // --- Admin endpoints (Phase 2) ---

  // Register org
  app.post('/api/v1/orgs', (req, res) => {
    try {
      const { orgId, name, tier, metadata } = req.body;
      if (!orgId || !name) {
        res.status(400).json({ success: false, error: 'Missing orgId or name' });
        return;
      }
      bus.registerOrg({
        orgId,
        name,
        tier: tier || OrgTier.VENDOR,
        metadata: metadata || {},
        createdAt: new Date().toISOString(),
      });
      res.json({ success: true, data: bus.getOrg(orgId) });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // List orgs
  app.get('/api/v1/orgs', (_req, res) => {
    res.json({ success: true, data: bus.listOrgs() });
  });

  // Create namespace
  app.post('/api/v1/orgs/:orgId/namespaces', (req, res) => {
    try {
      const { orgId } = req.params;
      const { name, quotas, metadata } = req.body;
      if (!name) {
        res.status(400).json({ success: false, error: 'Missing name' });
        return;
      }
      const namespaceId = `${orgId}/${name}`;
      bus.createNamespace({
        namespaceId,
        orgId,
        name,
        quotas: quotas || {
          maxAgents: 100,
          maxContractsPerHour: 1000,
          maxTokensPerDay: 1_000_000,
          maxCostPerDay: 100,
        },
        metadata: metadata || {},
      });
      res.json({ success: true, data: bus.getNamespace(namespaceId) });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // Create grant
  app.post('/api/v1/grants', (req, res) => {
    try {
      const grant = req.body;
      if (!grant.grantId || !grant.fromOrgId || !grant.toOrgId) {
        res.status(400).json({ success: false, error: 'Missing required grant fields' });
        return;
      }
      bus.createGrant({
        contractIds: [],
        capabilities: [],
        maxTokensPerDay: 100000,
        maxCostPerDay: 10,
        conditions: {
          requireApproval: false,
          allowedTools: [],
          blockedTools: [],
          maxConcurrent: 10,
        },
        status: 'active',
        createdAt: new Date().toISOString(),
        ...grant,
      });
      res.json({ success: true, data: bus.getGrant(grant.grantId) });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // List grants
  app.get('/api/v1/grants', (req, res) => {
    const orgId = req.query.orgId as string;
    if (orgId) {
      res.json({ success: true, data: bus.listGrants(orgId) });
    } else {
      // List all orgs' grants
      const allOrgs = bus.listOrgs();
      const seen = new Set<string>();
      const all: any[] = [];
      for (const org of allOrgs) {
        for (const g of bus.listGrants(org.orgId)) {
          if (!seen.has(g.grantId)) {
            seen.add(g.grantId);
            all.push(g);
          }
        }
      }
      res.json({ success: true, data: all });
    }
  });

  // Update grant status
  app.patch('/api/v1/grants/:grantId', (req, res) => {
    try {
      const { grantId } = req.params;
      const { status } = req.body;
      let result;
      if (status === 'suspended') {
        result = bus.suspendGrant(grantId);
      } else if (status === 'revoked') {
        result = bus.revokeGrant(grantId);
      } else {
        res
          .status(400)
          .json({ success: false, error: 'Invalid status. Use suspended or revoked.' });
        return;
      }
      if (!result) {
        res.status(404).json({ success: false, error: 'Grant not found' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // Grant usage stats
  app.get('/api/v1/grants/:grantId/usage', (req, res) => {
    const usage = bus.getGrantUsage(req.params.grantId);
    res.json({ success: true, data: usage });
  });

  // List namespaces for org
  app.get('/api/v1/orgs/:orgId/namespaces', (req, res) => {
    res.json({ success: true, data: bus.listNamespaces(req.params.orgId) });
  });

  // Create API key
  app.post('/api/v1/api-keys', (req, res) => {
    try {
      const { orgId, scopes, rateLimit, expiresAt } = req.body;
      if (!orgId) {
        res.status(400).json({ success: false, error: 'Missing orgId' });
        return;
      }
      const result = bus.createApiKey(orgId, scopes, rateLimit, expiresAt);
      res.json({ success: true, data: { rawKey: result.rawKey, apiKey: result.apiKey } });
    } catch (err) {
      res.status(400).json({ success: false, error: (err as Error).message });
    }
  });

  // List API keys for org (no secret values)
  app.get('/api/v1/api-keys/:orgId', (req, res) => {
    const keys = bus.listApiKeys(req.params.orgId);
    res.json({ success: true, data: keys });
  });

  // --- Gateway API (auth-protected) ---
  const authMiddleware = createAuthMiddleware(
    bus.getApiKeyRegistry(),
    bus.getOrgRegistry(),
    bus.getRateLimiter()
  );

  const gatewayRouter = createGatewayRouter({
    bus,
    webhookRegistry: bus.getWebhookRegistry(),
  });

  app.use('/gateway/v1', authMiddleware, gatewayRouter);

  // --- Exchange API (auth-protected) ---
  const exchangeRouter = createExchangeRouter({ bus });
  app.use('/exchange/v1', authMiddleware, exchangeRouter);

  // --- Public catalog browsing (unauthenticated) ---
  app.get('/api/catalog', (req, res) => {
    try {
      const q = (req.query.q as string) || '';
      const category = req.query.category as string | undefined;
      const listings = bus.searchCatalog(q, {
        category: category as any,
        status: 'published',
      });
      res.json({ success: true, data: listings });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // --- Exchange console endpoints (unauthenticated) ---

  // All published listings
  app.get('/api/exchange/listings', (_req, res) => {
    try {
      const listings = bus.searchCatalog('', { status: 'published' });
      res.json({ success: true, data: listings });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // Reviews for a listing
  app.get('/api/exchange/reviews/:id', (req, res) => {
    try {
      const reviews = bus.getReviews(req.params.id);
      res.json({ success: true, data: reviews });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // Exchange stats
  app.get('/api/exchange/stats', (_req, res) => {
    try {
      const listings = bus.searchCatalog('', { status: 'published' });
      const totalListings = listings.length;

      // Aggregate transaction stats across all orgs
      const orgs = bus.listOrgs();
      const seenTxns = new Set<string>();
      let totalCredits = 0;
      for (const org of orgs) {
        const txns = bus.getBillingEngine().getTransactions(org.orgId, { limit: 10000 });
        for (const txn of txns) {
          if (!seenTxns.has(txn.transactionId)) {
            seenTxns.add(txn.transactionId);
            if (txn.transactionType === 'usage') {
              totalCredits += txn.amount;
            }
          }
        }
      }

      res.json({
        success: true,
        data: {
          totalListings,
          totalTransactions: seenTxns.size,
          totalCredits,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`MoltMesh operator console: http://localhost:${PORT}`);
    console.log(`\nAPI endpoints:`);
    console.log(`  POST /api/submit            — Submit a task`);
    console.log(`  GET  /api/traces            — List traces`);
    console.log(`  GET  /api/traces/:id        — Trace detail`);
    console.log(`  GET  /api/contracts         — List contracts`);
    console.log(`  GET  /api/agents            — List agents (enriched)`);
    console.log(`  GET  /api/dead-letters      — Dead letter queue`);
    console.log(`  GET  /api/costs/:agentId    — Agent cost summary`);
    console.log(`  GET  /api/costs             — All agent costs`);
    console.log(`  POST /api/approve/:id       — Approve request`);
    console.log(`  POST /api/deny/:id          — Deny request`);
    console.log(`  GET  /api/approvals         — Pending approvals`);
    console.log(`  GET  /api/circuit-states    — Circuit breaker states`);
    console.log(`  GET  /api/budgets           — Agent budgets`);
    console.log(`  GET  /api/policy-log        — Policy decision log`);
    console.log(`  GET  /api/trace-cost/:id    — Trace cost summary`);
    console.log(`\nAdmin endpoints (Phase 2):`);
    console.log(`  POST /api/v1/orgs           — Register org`);
    console.log(`  GET  /api/v1/orgs           — List orgs`);
    console.log(`  POST /api/v1/orgs/:id/ns    — Create namespace`);
    console.log(`  POST /api/v1/grants         — Create grant`);
    console.log(`  GET  /api/v1/grants         — List grants`);
    console.log(`  PATCH /api/v1/grants/:id    — Update grant`);
    console.log(`  GET  /api/v1/grants/:id/use — Grant usage`);
    console.log(`  POST /api/v1/api-keys       — Create API key`);
    console.log(`\nExchange console endpoints:`);
    console.log(`  GET  /api/exchange/listings  — All published listings`);
    console.log(`  GET  /api/exchange/reviews/:id — Reviews for a listing`);
    console.log(`  GET  /api/exchange/stats     — Exchange stats`);
    console.log(`\nGateway API (auth required):`);
    console.log(`  POST /gateway/v1/submit     — Submit cross-org task`);
    console.log(`  GET  /gateway/v1/contracts  — List federated contracts`);
    console.log(`  GET  /gateway/v1/status/:id — Check task status`);
    console.log(`  POST /gateway/v1/webhooks   — Register webhook`);
    console.log(`  GET  /gateway/v1/webhooks   — List webhooks`);
    console.log(`  DEL  /gateway/v1/webhooks/:id — Delete webhook`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    server.close();
    await cleanup();
    process.exit(0);
  });
}

main().catch(console.error);
