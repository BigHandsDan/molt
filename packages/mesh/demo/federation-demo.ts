import { MoltMesh, TrustTier, AgentIdentity, TaskContract, OrgTier } from '../src/index.js';
import { createResearcherServer } from './agents/researcher.js';
import { reviewerMockHandler } from './agents/reviewer.js';

const RESEARCH_PORT = 9878;

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
  description: 'Acme Corp internal research agent',
  trustTier: TrustTier.INTERNAL_TRUSTED,
  orgId: 'acme-corp',
  namespaceId: 'acme-corp/engineering',
  capabilities: ['research'],
  allowedTools: ['web_search'],
  metadata: { framework: 'http-express' },
  registeredAt: new Date().toISOString(),
};

// --- Widget Inc agents ---
const WIDGET_CALLER: AgentIdentity = {
  agentId: 'widget-caller',
  name: 'Widget Task Caller',
  description: 'Widget Inc agent that delegates tasks to other orgs',
  trustTier: TrustTier.EXTERNAL_PARTNER,
  orgId: 'widget-inc',
  namespaceId: 'widget-inc/product',
  capabilities: ['planning'],
  allowedTools: ['web_search'],
  metadata: { framework: 'direct-ts' },
  registeredAt: new Date().toISOString(),
};

// --- Research contract scoped to Acme ---
const FEDERATED_RESEARCH_CONTRACT: TaskContract = {
  contractId: 'fed-research',
  version: '1.0.0',
  capability: 'research',
  description: 'Federated research contract (Acme Corp)',
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

export async function runFederationDemo() {
  console.log(`\n${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${MAGENTA}    MoltMesh Phase 2 — Federation Demo${RESET}`);
  console.log(`${BOLD}${MAGENTA}    Cross-Organization Agent Interoperability${RESET}`);
  console.log(`${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}\n`);

  // Start researcher HTTP server for Acme's agent
  const researcher = createResearcherServer();
  await researcher.start(RESEARCH_PORT);

  // Create bus
  const bus = new MoltMesh({
    openAIHandler: reviewerMockHandler,
  });

  // Register the federated research contract
  bus.registerContract(FEDERATED_RESEARCH_CONTRACT);

  // Register Acme's researcher agent (HTTP adapter)
  bus.registerAgent(ACME_RESEARCHER, {
    agentId: ACME_RESEARCHER.agentId,
    endpoint: `http://localhost:${RESEARCH_PORT}/task`,
    metadata: { protocol: 'http' },
  });

  // Register Widget's caller agent (echo adapter — used as caller identity only)
  bus.registerAgent(WIDGET_CALLER, {
    agentId: WIDGET_CALLER.agentId,
    metadata: { protocol: 'echo' },
  });

  // ====== SCENARIO 8: Org Registration ======
  narrate('🏢', 'SCENARIO 8: Organization Registration');
  detail('Register "Acme Corp" (owner tier) and "Widget Inc" (partner tier) with namespaces');
  await sleep(300);

  bus.registerOrg({
    orgId: 'acme-corp',
    name: 'Acme Corp',
    tier: OrgTier.OWNER,
    metadata: { industry: 'technology' },
    createdAt: new Date().toISOString(),
  });
  success('Registered Acme Corp (owner tier)');

  bus.registerOrg({
    orgId: 'widget-inc',
    name: 'Widget Inc',
    tier: OrgTier.PARTNER,
    metadata: { industry: 'manufacturing' },
    createdAt: new Date().toISOString(),
  });
  success('Registered Widget Inc (partner tier)');

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

  const orgs = bus.listOrgs();
  detail(`Total organizations: ${orgs.length}`);
  detail(`Acme namespaces: ${bus.listNamespaces('acme-corp').length}`);
  detail(`Widget namespaces: ${bus.listNamespaces('widget-inc').length}`);
  await sleep(500);

  // ====== SCENARIO 9: Namespace Isolation ======
  narrate('🔒', 'SCENARIO 9: Namespace Isolation');
  detail("Widget's agent tries to invoke Acme's researcher — DENIED (no grant)");

  const isolationEnvelope = bus.createEnvelope(
    'fed-research',
    '1.0.0',
    { query: 'Attempt cross-org without grant' },
    WIDGET_CALLER,
    { target: 'acme-researcher' }
  );
  const isolationResult = await bus.submit(isolationEnvelope);

  if (
    isolationResult.status === 'denied' &&
    isolationResult.error?.includes('NAMESPACE_ISOLATION')
  ) {
    success(`Cross-org request DENIED: ${isolationResult.error}`);
  } else {
    fail(
      `Expected namespace isolation denial, got: ${isolationResult.status} — ${isolationResult.error}`
    );
  }
  detail(`Trace ID: ${isolationEnvelope.traceId}`);
  await sleep(500);

  // ====== SCENARIO 10: Grant Creation ======
  narrate('🤝', 'SCENARIO 10: Grant Creation');
  detail('Acme creates a grant giving Widget access to the "research" capability');
  detail('Token limit: 50,000/day, Cost limit: $5/day');

  bus.createGrant({
    grantId: 'grant-acme-to-widget',
    fromOrgId: 'acme-corp',
    toOrgId: 'widget-inc',
    contractIds: [],
    capabilities: ['research'],
    maxTokensPerDay: 50000,
    maxCostPerDay: 5,
    conditions: {
      requireApproval: false,
      allowedTools: ['web_search'],
      blockedTools: [],
      maxConcurrent: 5,
    },
    status: 'active',
    createdAt: new Date().toISOString(),
  });

  const grant = bus.getGrant('grant-acme-to-widget');
  if (grant) {
    success(`Grant created: ${grant.grantId}`);
    detail(`From: ${grant.fromOrgId} → To: ${grant.toOrgId}`);
    detail(`Capabilities: ${grant.capabilities.join(', ')}`);
    detail(`Limits: ${grant.maxTokensPerDay} tokens/day, $${grant.maxCostPerDay}/day`);
  }

  const grants = bus.listGrants('acme-corp');
  detail(`Total grants for Acme: ${grants.length}`);
  await sleep(500);

  // ====== SCENARIO 11: Cross-Org Success ======
  narrate('✅', 'SCENARIO 11: Cross-Org Success');
  detail("Widget invokes Acme's researcher through the grant — dual-policy check passes");

  const crossOrgEnvelope = bus.createEnvelope(
    'fed-research',
    '1.0.0',
    { query: 'Cross-org research on supply chain optimization', maxSources: 3 },
    WIDGET_CALLER,
    { target: 'acme-researcher' }
  );
  const crossOrgResult = await bus.submit(crossOrgEnvelope);

  if (crossOrgResult.status === 'success') {
    success(`Cross-org request SUCCEEDED in ${crossOrgResult.durationMs}ms`);
    const output = crossOrgResult.output as { summary?: string; sources?: unknown[] };
    if (output?.sources) {
      detail(`Sources returned: ${output.sources.length}`);
    }
    if (output?.summary) {
      detail(`Summary: ${output.summary.substring(0, 80)}...`);
    }
  } else {
    fail(`Cross-org request failed: ${crossOrgResult.status} — ${crossOrgResult.error}`);
  }

  // Show trace events
  const traceEvents = bus.getTrace(crossOrgEnvelope.traceId);
  const fedCheck = traceEvents.find((e) => e.eventType === 'federation_check');
  const crossOrgPolicy = traceEvents.find((e) => e.eventType === 'cross_org_policy');
  if (fedCheck) {
    detail(`Federation check: grant=${fedCheck.data.grantId}, valid=${fedCheck.data.grantValid}`);
  }
  if (crossOrgPolicy) {
    detail(
      `Cross-org policy: ${crossOrgPolicy.data.sourceOrgId} → ${crossOrgPolicy.data.targetOrgId}, decision=${crossOrgPolicy.data.finalDecision}`
    );
  }
  detail(`Trace ID: ${crossOrgEnvelope.traceId}`);
  await sleep(500);

  // ====== SCENARIO 12: Grant Quota Exceeded ======
  narrate('📊', 'SCENARIO 12: Grant Quota Exceeded');
  detail('Widget burns through token budget, next request denied with GRANT_QUOTA_EXCEEDED');

  // Simulate heavy usage by recording tokens directly to the grant usage tracker
  const grantUsageTracker = (bus as any).grantUsageTracker;
  grantUsageTracker.recordUsage('grant-acme-to-widget', 49000, 4.5);
  detail('Simulated 49,000 tokens used (of 50,000 limit)');

  // Make a request that tips over the limit
  grantUsageTracker.recordUsage('grant-acme-to-widget', 1500, 0.6);
  detail('Recorded additional 1,500 tokens — now over limit');

  const quotaEnvelope = bus.createEnvelope(
    'fed-research',
    '1.0.0',
    { query: 'One more request after exceeding quota' },
    WIDGET_CALLER,
    { target: 'acme-researcher' }
  );
  const quotaResult = await bus.submit(quotaEnvelope);

  if (quotaResult.status === 'denied' && quotaResult.error?.includes('GRANT_QUOTA_EXCEEDED')) {
    success(`Request DENIED: ${quotaResult.error}`);
  } else {
    fail(`Expected quota exceeded denial, got: ${quotaResult.status} — ${quotaResult.error}`);
  }

  // Show usage
  const usage = bus.getGrantUsage('grant-acme-to-widget');
  if (usage) {
    detail(`Token usage: ${usage.tokensUsed}/${grant!.maxTokensPerDay}`);
    detail(`Cost usage: $${usage.costUsed.toFixed(2)}/$${grant!.maxCostPerDay}`);
    detail(`Requests today: ${usage.requestCount}`);
  }
  detail(`Trace ID: ${quotaEnvelope.traceId}`);
  await sleep(500);

  // ====== SCENARIO 13: Grant Revocation ======
  narrate('🚫', 'SCENARIO 13: Grant Revocation');
  detail("Acme revokes Widget's grant — Widget's next request immediately denied");

  const revoked = bus.revokeGrant('grant-acme-to-widget');
  if (revoked) {
    success(`Grant revoked: ${revoked.grantId}`);
  }

  const revokedEnvelope = bus.createEnvelope(
    'fed-research',
    '1.0.0',
    { query: 'Request after grant revocation' },
    WIDGET_CALLER,
    { target: 'acme-researcher' }
  );
  const revokedResult = await bus.submit(revokedEnvelope);

  if (revokedResult.status === 'denied' && revokedResult.error?.includes('NAMESPACE_ISOLATION')) {
    success(`Post-revocation request DENIED: ${revokedResult.error}`);
  } else {
    fail(`Expected denial after revocation, got: ${revokedResult.status} — ${revokedResult.error}`);
  }
  detail(`Trace ID: ${revokedEnvelope.traceId}`);
  await sleep(500);

  // ====== SCENARIO 14: API Key Auth ======
  narrate('🔑', 'SCENARIO 14: API Key Authentication');
  detail('Create an API key for Widget, submit via gateway endpoint with Bearer auth');

  // Re-create grant for the gateway test
  bus.createGrant({
    grantId: 'grant-acme-to-widget-v2',
    fromOrgId: 'acme-corp',
    toOrgId: 'widget-inc',
    contractIds: [],
    capabilities: ['research'],
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
  });
  detail('Re-created grant for gateway test');

  const keyResult = bus.createApiKey('widget-inc', ['submit', 'read'], 60);
  success(`API key created for Widget Inc: ${keyResult.rawKey.substring(0, 12)}...`);
  detail(`Key ID: ${keyResult.apiKey.keyId}`);
  detail(`Scopes: ${keyResult.apiKey.scopes.join(', ')}`);

  // Validate the key
  const validated = bus.validateApiKey(keyResult.rawKey);
  if (validated) {
    success(`Key validated — belongs to org: ${validated.orgId}`);
  } else {
    fail('Key validation failed');
  }

  // Show API keys for Widget
  const keys = bus.listApiKeys('widget-inc');
  detail(`Total API keys for Widget Inc: ${keys.length}`);

  await sleep(300);

  // ====== SUMMARY ======
  console.log(`\n${BOLD}${MAGENTA}${'─'.repeat(60)}${RESET}`);
  narrate('📊', 'Federation Demo Summary');

  const allOrgs = bus.listOrgs();
  detail(`Organizations: ${allOrgs.length}`);
  for (const org of allOrgs) {
    const ns = bus.listNamespaces(org.orgId);
    detail(`  ${org.name} (${org.tier}): ${ns.length} namespace(s)`);
  }

  const allGrants = bus.listGrants('acme-corp');
  detail(`Federation grants: ${allGrants.length}`);
  for (const g of allGrants) {
    detail(`  ${g.grantId}: ${g.fromOrgId} → ${g.toOrgId} [${g.status}]`);
  }

  const traces = bus.getRecentTraces(50);
  detail(`Total traces: ${traces.length}`);
  detail(`Total events: ${traces.reduce((s, t) => s + t.eventCount, 0)}`);

  console.log(`\n${BOLD}${GREEN}All 7 federation scenarios completed.${RESET}`);
  console.log(
    `${DIM}Open the operator console at http://localhost:3456 to see everything visually.${RESET}\n`
  );

  // Cleanup
  bus.close();
  await researcher.stop();
}

// Run if executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('federation-demo.ts') ||
    process.argv[1].endsWith('federation-demo.js'));
if (isMain) {
  runFederationDemo().catch(console.error);
}
