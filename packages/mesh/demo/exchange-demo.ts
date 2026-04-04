import {
  MoltMesh,
  TrustTier,
  AgentIdentity,
  TaskContract,
  OrgTier,
  ServiceCategory,
} from '../src/index.js';
import { reviewerMockHandler } from './agents/reviewer.js';
import { createResearcherServer } from './agents/researcher.js';

const RESEARCH_PORT = 9879;

// Colors for terminal output
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function narrate(icon: string, msg: string) {
  console.log(`\n${BOLD}${CYAN}${icon}  ${msg}${RESET}`);
}

function detail(msg: string) {
  console.log(`${DIM}   ${msg}${RESET}`);
}

function success(msg: string) {
  console.log(`${GREEN}   ✓ ${msg}${RESET}`);
}

function fail(msg: string) {
  console.log(`${RED}   ✗ ${msg}${RESET}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Acme Corp agents ---
const ACME_RESEARCHER: AgentIdentity = {
  agentId: 'acme-researcher',
  name: 'Acme Research Agent',
  description: 'Acme Corp deep research agent',
  trustTier: TrustTier.INTERNAL_TRUSTED,
  orgId: 'acme-corp',
  namespaceId: 'acme-corp/engineering',
  capabilities: ['research', 'deep_research'],
  allowedTools: ['web_search'],
  metadata: { framework: 'http-express' },
  registeredAt: new Date().toISOString(),
};

const ACME_REVIEWER: AgentIdentity = {
  agentId: 'acme-reviewer',
  name: 'Acme Review Agent',
  description: 'Acme Corp code review agent',
  trustTier: TrustTier.INTERNAL_TRUSTED,
  orgId: 'acme-corp',
  namespaceId: 'acme-corp/engineering',
  capabilities: ['review'],
  allowedTools: [],
  metadata: { framework: 'openai' },
  registeredAt: new Date().toISOString(),
};

const RESEARCH_CONTRACT: TaskContract = {
  contractId: 'exchange-research',
  version: '1.0.0',
  capability: 'research',
  description: 'Deep research contract for the exchange',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, maxSources: { type: 'number' } },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, summary: { type: 'string' } },
          required: ['title', 'summary'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['sources', 'summary'],
  },
  securityClass: TrustTier.INTERNAL_RESTRICTED,
  requiredTools: ['web_search'],
  timeout: 10000,
  retryPolicy: { maxRetries: 0, backoffMs: 100 },
  approvalRequired: false,
  visibility: 'federated',
  ownerOrgId: 'acme-corp',
  ownerNamespace: 'acme-corp/engineering',
};

const REVIEW_CONTRACT: TaskContract = {
  contractId: 'exchange-review',
  version: '1.0.0',
  capability: 'review',
  description: 'Code review contract',
  inputSchema: {
    type: 'object',
    properties: { code: { type: 'string' }, language: { type: 'string' } },
    required: ['code'],
  },
  outputSchema: {
    type: 'object',
  },
  securityClass: TrustTier.INTERNAL_RESTRICTED,
  requiredTools: [],
  timeout: 10000,
  retryPolicy: { maxRetries: 0, backoffMs: 100 },
  approvalRequired: false,
  visibility: 'federated',
  ownerOrgId: 'acme-corp',
  ownerNamespace: 'acme-corp/engineering',
};

export async function runExchangeDemo() {
  console.log(`\n${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${MAGENTA}    MoltMesh Phase 3 — Exchange Demo${RESET}`);
  console.log(`${BOLD}${MAGENTA}    Inter-Organization Service Marketplace${RESET}`);
  console.log(`${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}\n`);

  // Start researcher HTTP server
  const researcher = createResearcherServer();
  await researcher.start(RESEARCH_PORT);

  // Create bus
  const bus = new MoltMesh({
    openAIHandler: reviewerMockHandler,
  });

  // --- SETUP ---
  narrate('⚙️', 'Setup: Organizations, Agents, Contracts, Credit Accounts');

  // Register orgs
  bus.registerOrg({
    orgId: 'acme-corp',
    name: 'Acme Corp',
    tier: OrgTier.OWNER,
    metadata: { industry: 'technology' },
    createdAt: new Date().toISOString(),
  });
  success('Registered Acme Corp (owner)');

  bus.registerOrg({
    orgId: 'widget-inc',
    name: 'Widget Inc',
    tier: OrgTier.PARTNER,
    metadata: { industry: 'manufacturing' },
    createdAt: new Date().toISOString(),
  });
  success('Registered Widget Inc (partner)');

  // Create namespaces
  bus.createNamespace({
    namespaceId: 'acme-corp/engineering',
    orgId: 'acme-corp',
    name: 'engineering',
    quotas: {
      maxAgents: 50,
      maxContractsPerHour: 500,
      maxTokensPerDay: 500_000,
      maxCostPerDay: 50,
    },
    metadata: {},
  });
  success('Created namespace: acme-corp/engineering');

  bus.createNamespace({
    namespaceId: 'widget-inc/product',
    orgId: 'widget-inc',
    name: 'product',
    quotas: {
      maxAgents: 20,
      maxContractsPerHour: 200,
      maxTokensPerDay: 100_000,
      maxCostPerDay: 20,
    },
    metadata: {},
  });
  success('Created namespace: widget-inc/product');

  // Register contracts
  bus.registerContract(RESEARCH_CONTRACT);
  bus.registerContract(REVIEW_CONTRACT);
  success('Registered contracts: exchange-research, exchange-review');

  // Register agents
  bus.registerAgent(ACME_RESEARCHER, {
    agentId: ACME_RESEARCHER.agentId,
    endpoint: `http://localhost:${RESEARCH_PORT}/task`,
    metadata: { protocol: 'http' },
  });
  success('Registered Acme researcher (HTTP adapter)');

  bus.registerAgent(ACME_REVIEWER, {
    agentId: ACME_REVIEWER.agentId,
    metadata: { protocol: 'openai' },
  });
  success('Registered Acme reviewer (OpenAI adapter)');

  // Create credit accounts
  bus.createCreditAccount('acme-corp', 500);
  bus.createCreditAccount('widget-inc', 1000);
  success('Created credit accounts: Acme (500 credits), Widget (1000 credits)');

  await sleep(500);

  // ====== SCENARIO 15: Service Publication ======
  narrate('📦', 'SCENARIO 15: Service Publication');
  detail('Acme publishes "Deep Research Agent" service to the exchange catalog');

  const listing = bus.publishService({
    listingId: 'acme-deep-research',
    orgId: 'acme-corp',
    name: 'Deep Research Agent',
    description: 'AI-powered deep research with multi-source synthesis and fact verification',
    category: ServiceCategory.RESEARCH,
    capabilities: ['research', 'deep_research'],
    contractIds: ['exchange-research'],
    pricing: {
      model: 'per_request',
      currency: 'credits',
      perRequestCost: 5,
      subscriptionRate: 50,
      freeQuota: 10,
    },
    sla: {
      maxLatencyMs: 5000,
      availabilityPct: 99.5,
      maxConcurrent: 10,
      supportTier: 'standard',
    },
    tags: ['research', 'ai', 'deep-learning', 'multi-source'],
    status: 'published',
    version: '1.0.0',
    metadata: {},
    ratingAvg: 0,
    ratingCount: 0,
    usageCount: 0,
  });

  success(`Published: ${listing.name} (${listing.listingId})`);
  detail(`Category: ${listing.category}`);
  detail(`Pricing: ${listing.pricing.perRequestCost} credits/request`);
  detail(
    `SLA: ${listing.sla.maxLatencyMs}ms latency, ${listing.sla.availabilityPct}% availability`
  );
  detail(`Capabilities: ${listing.capabilities.join(', ')}`);
  await sleep(500);

  // ====== SCENARIO 16: Catalog Discovery ======
  narrate('🔍', 'SCENARIO 16: Catalog Discovery');
  detail('Search the catalog for "research" — should find Acme\'s listing');

  const searchResults = bus.searchCatalog('research', { status: 'published' });
  success(`Search for "research": ${searchResults.length} result(s) found`);
  for (const r of searchResults) {
    detail(
      `  → ${r.name} by ${r.orgId} (${r.category}) — ${r.pricing.perRequestCost || 0} credits/req`
    );
  }

  const categories = bus.getCatalogRegistry().getCategories();
  success(`Categories: ${categories.map((c) => `${c.category} (${c.count})`).join(', ')}`);

  // Search by capability
  const capResults = bus.getCatalogRegistry().getByCapability('deep_research');
  detail(`Services with "deep_research" capability: ${capResults.length}`);
  await sleep(500);

  // ====== SCENARIO 17: Credit Setup ======
  narrate('💰', 'SCENARIO 17: Credit Setup');
  detail('Show initial balances, then Widget adds 500 more credits');

  const acmeBalance1 = bus.getBalance('acme-corp');
  const widgetBalance1 = bus.getBalance('widget-inc');
  success(`Acme Corp balance: ${acmeBalance1} credits`);
  success(`Widget Inc balance: ${widgetBalance1} credits`);

  // Widget adds credits
  const topupTxn = bus.addCredits('widget-inc', 500, 'purchase');
  success(`Widget added 500 credits (txn: ${topupTxn.transactionId.substring(0, 8)}...)`);

  const widgetBalance2 = bus.getBalance('widget-inc');
  success(`Widget Inc new balance: ${widgetBalance2} credits`);
  await sleep(500);

  // ====== SCENARIO 18: Per-Request Invoke ======
  narrate('⚡', 'SCENARIO 18: Per-Request Invocation');
  detail("Widget invokes Acme's research service — 5 credits charged, 10% platform fee");

  const widgetBefore = bus.getBalance('widget-inc');
  const acmeBefore = bus.getBalance('acme-corp');

  // Create a federation grant so Widget can access Acme's service
  bus.createGrant({
    grantId: 'exchange-grant-research',
    fromOrgId: 'acme-corp',
    toOrgId: 'widget-inc',
    contractIds: ['exchange-research'],
    capabilities: ['research', 'deep_research'],
    maxTokensPerDay: 500_000,
    maxCostPerDay: 100,
    conditions: {
      requireApproval: false,
      allowedTools: [],
      blockedTools: [],
      maxConcurrent: 10,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
  });

  // Create Widget caller identity
  const widgetCaller: AgentIdentity = {
    agentId: 'widget-exchange-caller',
    name: 'Widget Exchange Caller',
    description: 'Widget calling via exchange',
    trustTier: TrustTier.EXTERNAL_PARTNER,
    orgId: 'widget-inc',
    namespaceId: 'widget-inc/product',
    capabilities: [],
    allowedTools: ['web_search'],
    metadata: { exchangeListingId: 'acme-deep-research' },
    registeredAt: new Date().toISOString(),
  };
  bus.registerAgent(widgetCaller, {
    agentId: widgetCaller.agentId,
    metadata: { protocol: 'echo' },
  });

  // Invoke through the bus
  const envelope = bus.createEnvelope(
    'exchange-research',
    '1.0.0',
    { query: 'Current state of large language model architectures' },
    widgetCaller,
    { target: 'acme-researcher' }
  );
  const result = await bus.submit(envelope);

  if (result.status === 'success') {
    // Charge credits
    const cost = 5;
    const billingEngine = bus.getBillingEngine();
    const txn = billingEngine.chargeForUsage(
      envelope.traceId,
      'widget-inc',
      'acme-corp',
      cost,
      'acme-deep-research'
    );
    bus.getCatalogRegistry().incrementUsage('acme-deep-research');

    const widgetAfter = bus.getBalance('widget-inc');
    const acmeAfter = bus.getBalance('acme-corp');

    success(`Invocation successful — Trace: ${envelope.traceId.substring(0, 8)}...`);
    success(`Cost charged to Widget: ${cost} credits`);
    success(`Acme earnings: ${txn.netAmount} credits (after ${txn.platformFee} platform fee)`);
    success(`Platform fee: ${txn.platformFee} credits (10%)`);
    detail(`Widget balance: ${widgetBefore} → ${widgetAfter}`);
    detail(`Acme balance: ${acmeBefore} → ${acmeAfter}`);
  } else {
    fail(`Invocation failed: ${result.error}`);
  }
  await sleep(500);

  // ====== SCENARIO 19: Subscription Flow ======
  narrate('📋', 'SCENARIO 19: Subscription Flow');
  detail("Widget subscribes to Acme's service: daily plan, 50 credits/day, 10 requests included");

  const subscription = bus.subscribe('widget-inc', 'acme-deep-research', 'daily');
  success(`Subscription created: ${subscription.subscriptionId.substring(0, 8)}...`);
  detail(`Plan: ${subscription.plan}`);
  detail(`Credits/period: ${subscription.creditsPerPeriod}`);
  detail(`Requests included: ${subscription.requestsIncluded}`);
  detail(`Overage rate: ${subscription.overageRate} credits/request`);
  detail(`Grant ID: ${subscription.grantId || 'auto-created'}`);
  detail(
    `Period: ${subscription.currentPeriodStart.substring(0, 10)} — ${subscription.currentPeriodEnd.substring(0, 10)}`
  );

  // Make 3 invocations within subscription
  const subscriptionRegistry = bus.getSubscriptionRegistry();
  for (let i = 1; i <= 3; i++) {
    subscriptionRegistry.incrementUsage(subscription.subscriptionId);
  }
  const subAfter = subscriptionRegistry.get(subscription.subscriptionId)!;
  success(`Made 3 invocations within subscription`);
  detail(`Requests used: ${subAfter.requestsUsed}/${subAfter.requestsIncluded}`);
  detail(`Within quota: ${!subscriptionRegistry.isOverage(subscription.subscriptionId)}`);
  await sleep(500);

  // ====== SCENARIO 20: Overage Billing ======
  narrate('📈', 'SCENARIO 20: Overage Billing');
  detail('Widget exceeds the 10-request quota — overage charged per-request');

  // Use remaining quota
  const remaining = subAfter.requestsIncluded - subAfter.requestsUsed;
  for (let i = 0; i < remaining; i++) {
    subscriptionRegistry.incrementUsage(subscription.subscriptionId);
  }
  detail(`Used remaining ${remaining} included requests`);

  // Now make overage requests
  const overageRequests = 3;
  const billingEngine = bus.getBillingEngine();
  const widgetBeforeOverage = bus.getBalance('widget-inc');
  let totalOverageCharged = 0;

  for (let i = 0; i < overageRequests; i++) {
    subscriptionRegistry.incrementUsage(subscription.subscriptionId);
    const isOverage = subscriptionRegistry.isOverage(subscription.subscriptionId);
    if (isOverage) {
      const overageCost = subscription.overageRate;
      billingEngine.chargeForUsage(
        `overage-${i}`,
        'widget-inc',
        'acme-corp',
        overageCost,
        'acme-deep-research'
      );
      totalOverageCharged += overageCost;
      bus.getCatalogRegistry().incrementUsage('acme-deep-research');
    }
  }

  const subFinal = subscriptionRegistry.get(subscription.subscriptionId)!;
  const widgetAfterOverage = bus.getBalance('widget-inc');

  success(`Requests used: ${subFinal.requestsUsed} (quota: ${subFinal.requestsIncluded})`);
  success(`Overage requests: ${overageRequests}`);
  success(
    `Overage charges: ${totalOverageCharged} credits (${subscription.overageRate} credits × ${overageRequests} requests)`
  );
  detail(`Widget balance: ${widgetBeforeOverage.toFixed(1)} → ${widgetAfterOverage.toFixed(1)}`);
  await sleep(500);

  // ====== SCENARIO 21: Rating & Review ======
  narrate('⭐', 'SCENARIO 21: Rating & Review');
  detail('Widget submits a 4-star review, Acme responds');

  const review = bus.submitReview({
    listingId: 'acme-deep-research',
    reviewerOrgId: 'widget-inc',
    rating: 4,
    title: 'Solid research capabilities',
    body: 'Solid research capabilities, fast turnaround. Multi-source synthesis is impressive.',
    traceId: envelope.traceId,
  });
  success(`Review submitted: "${review.title}" — ${review.rating}/5 stars`);
  detail(`Review body: "${review.body}"`);

  // Acme responds
  const responded = bus.respondToReview(
    review.reviewId,
    "Thanks! We're adding more data sources soon."
  );
  if (responded?.response) {
    success(`Provider response: "${responded.response.body}"`);
  }

  // Check updated listing rating
  const updatedListing = bus.getService('acme-deep-research');
  if (updatedListing) {
    success(
      `Listing rating updated: ${updatedListing.ratingAvg.toFixed(1)}/5 (${updatedListing.ratingCount} review(s))`
    );
  }

  const reviews = bus.getReviews('acme-deep-research');
  detail(`Total reviews for listing: ${reviews.length}`);
  await sleep(500);

  // ====== SUMMARY ======
  console.log(`\n${BOLD}${MAGENTA}${'─'.repeat(60)}${RESET}`);
  narrate('📊', 'Exchange Demo Summary');

  const allListings = bus.searchCatalog('', { status: 'published' });
  detail(`Published services: ${allListings.length}`);

  const acmeTxns = billingEngine.getTransactions('acme-corp', { limit: 100 });
  const widgetTxns = billingEngine.getTransactions('widget-inc', { limit: 100 });
  const allTxnIds = new Set([
    ...acmeTxns.map((t) => t.transactionId),
    ...widgetTxns.map((t) => t.transactionId),
  ]);
  detail(`Total transactions: ${allTxnIds.size}`);

  const totalCreditsTransacted = widgetTxns
    .filter((t) => t.transactionType === 'usage')
    .reduce((s, t) => s + t.amount, 0);
  detail(`Total credits transacted: ${totalCreditsTransacted.toFixed(1)}`);

  for (const l of allListings) {
    detail(
      `  ${l.name}: ${l.ratingAvg.toFixed(1)}/5 stars (${l.ratingCount} reviews), ${l.usageCount} invocations`
    );
  }

  detail(`\nFinal balances:`);
  detail(`  Acme Corp: ${bus.getBalance('acme-corp').toFixed(1)} credits`);
  detail(`  Widget Inc: ${bus.getBalance('widget-inc').toFixed(1)} credits`);

  console.log(`\n${BOLD}${GREEN}All 7 exchange scenarios completed.${RESET}`);
  console.log(
    `${DIM}Open the operator console at http://localhost:3456 to see the Exchange tab.${RESET}\n`
  );

  // Cleanup
  bus.close();
  await researcher.stop();
}

// Run if executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('exchange-demo.ts') || process.argv[1].endsWith('exchange-demo.js'));
if (isMain) {
  runExchangeDemo().catch(console.error);
}
