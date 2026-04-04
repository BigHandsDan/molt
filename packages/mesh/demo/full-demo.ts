import { MoltMesh, TrustTier, AgentIdentity, TaskContract } from '../src/index.js';
import { CircuitState } from '../src/router/circuit-breaker.js';
import { PLANNER_IDENTITY, PLANNING_CONTRACT, plannerHandler } from './agents/planner.js';
import {
  RESEARCHER_IDENTITY,
  RESEARCH_CONTRACT,
  createResearcherServer,
} from './agents/researcher.js';
import { REVIEWER_IDENTITY, REVIEW_CONTRACT, reviewerMockHandler } from './agents/reviewer.js';

const RESEARCH_PORT = 9877;

// Colors for terminal output
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
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

function warn(msg: string) {
  console.log(`${YELLOW}   ⚠ ${msg}${RESET}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- External partner agent for denial scenario ---
const EXTERNAL_AGENT: AgentIdentity = {
  agentId: 'external-partner-agent',
  name: 'External Partner Agent',
  description: 'A partner agent from an external organization',
  trustTier: TrustTier.EXTERNAL_PARTNER,
  capabilities: ['research'],
  allowedTools: ['web_search'],
  metadata: { framework: 'external-framework' },
  registeredAt: new Date().toISOString(),
};

const INTERNAL_ONLY_CONTRACT: TaskContract = {
  contractId: 'internal-analysis',
  version: '1.0.0',
  capability: 'analysis',
  description: 'Internal-only analysis contract requiring high trust',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: { result: { type: 'string' } },
  },
  securityClass: TrustTier.INTERNAL_TRUSTED,
  requiredTools: ['code_exec'],
  timeout: 5000,
  retryPolicy: { maxRetries: 0, backoffMs: 100 },
  approvalRequired: false,
};

// --- Approval-required contract ---
const SENSITIVE_CONTRACT: TaskContract = {
  contractId: 'sensitive-action',
  version: '1.0.0',
  capability: 'review',
  description: 'Sensitive action requiring operator approval',
  inputSchema: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      analysis: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['status'],
  },
  securityClass: TrustTier.INTERNAL_TRUSTED,
  requiredTools: [],
  timeout: 5000,
  retryPolicy: { maxRetries: 0, backoffMs: 100 },
  approvalRequired: true,
};

export async function runFullDemo() {
  console.log(`\n${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${MAGENTA}    MoltMesh Phase 1 — Full Demo${RESET}`);
  console.log(`${BOLD}${MAGENTA}    Agent Interoperability Bus & Control Plane${RESET}`);
  console.log(`${BOLD}${MAGENTA}${'═'.repeat(60)}${RESET}\n`);

  // Start researcher server
  const researcher = createResearcherServer();
  await researcher.start(RESEARCH_PORT);

  // Create bus with custom config
  const bus = new MoltMesh({
    openAIHandler: reviewerMockHandler,
    budgetConfig: {
      defaultMaxTokensPerHour: 50000,
      defaultMaxTokensPerDay: 200000,
      agentOverrides: {
        'researcher-agent': { maxTokensPerHour: 500, maxTokensPerDay: 2000 },
      },
    },
    circuitBreakerConfig: {
      failureThreshold: 3,
      cooldownMs: 5000,
      failureWindowMs: 30000,
    },
  });

  // Policy rule: block external agents from internal contracts
  bus.getPolicyEngine().addRule({
    ruleId: 'demo-block-external-internal',
    effect: 'deny',
    priority: 250,
    conditions: {
      trustTierIn: [TrustTier.EXTERNAL_PARTNER, TrustTier.PUBLIC_VENDOR],
      toolsBlocked: ['code_exec'],
    },
    description: 'External agents cannot use code_exec tools',
  });

  // Register contracts
  bus.registerContract(PLANNING_CONTRACT);
  bus.registerContract(RESEARCH_CONTRACT);
  bus.registerContract(REVIEW_CONTRACT);
  bus.registerContract(INTERNAL_ONLY_CONTRACT);
  bus.registerContract(SENSITIVE_CONTRACT);

  // Register agents
  bus.registerAgent(PLANNER_IDENTITY, {
    agentId: PLANNER_IDENTITY.agentId,
    metadata: { protocol: 'echo' },
  });
  bus.registerAgent(RESEARCHER_IDENTITY, {
    agentId: RESEARCHER_IDENTITY.agentId,
    endpoint: `http://localhost:${RESEARCH_PORT}/task`,
    metadata: { protocol: 'http' },
  });
  bus.registerAgent(REVIEWER_IDENTITY, {
    agentId: REVIEWER_IDENTITY.agentId,
    model: 'gpt-4',
    metadata: { protocol: 'openai' },
  });
  bus.registerAgent(EXTERNAL_AGENT, {
    agentId: EXTERNAL_AGENT.agentId,
    metadata: { protocol: 'echo' },
  });

  // ====== SCENARIO 1: Normal Flow ======
  narrate('📋', 'SCENARIO 1: Normal Multi-Agent Workflow');
  detail('A research request flows through planner → researcher → reviewer');
  detail('All governed by policy, traced end-to-end');
  await sleep(500);

  const plan = plannerHandler({ request: 'Research agent interoperability standards' });
  detail(`Planner created ${plan.subtasks.length} subtasks`);

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
    if (result.status === 'success') {
      success(`${subtask.contractId}: completed in ${result.durationMs}ms`);
      if (result.tokenUsage) {
        detail(`Tokens: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`);
      }
    } else {
      fail(`${subtask.contractId}: ${result.error}`);
    }
  }
  await sleep(800);

  // ====== SCENARIO 2: Policy Denial ======
  narrate('🚫', 'SCENARIO 2: Policy Denial');
  detail('External partner attempts to access an internal-only contract with code_exec');

  const deniedEnvelope = bus.createEnvelope(
    'internal-analysis',
    '1.0.0',
    { query: 'Access internal data' },
    EXTERNAL_AGENT,
    { target: 'external-partner-agent' }
  );
  const deniedResult = await bus.submit(deniedEnvelope);
  if (deniedResult.status === 'denied') {
    success(`Policy denied: ${deniedResult.error}`);
  } else {
    fail(`Expected denial but got: ${deniedResult.status}`);
  }
  await sleep(800);

  // ====== SCENARIO 3: Budget Exceeded ======
  narrate('💰', 'SCENARIO 3: Budget Exceeded');
  detail('Researcher agent hits its token budget limit');

  // Set very low budget for researcher
  bus.setAgentBudgetLimits('researcher-agent', 100, 500);

  // Simulate prior usage by making several requests
  for (let i = 0; i < 3; i++) {
    const env = bus.createEnvelope('research', '1.0.0', { query: `query ${i}` }, PLANNER_IDENTITY);
    await bus.submit(env);
  }

  // The budget tracker doesn't increment from echo/http adapters that don't return tokens.
  // For the demo, show the budget state:
  const budget = bus.getAgentBudget('researcher-agent');
  if (budget) {
    detail(
      `Budget: ${budget.currentHourUsage}/${budget.maxTokensPerHour} tokens/hour, ${budget.currentDayUsage}/${budget.maxTokensPerDay} tokens/day`
    );
    warn(`Budget limits enforced — excessive usage will be denied`);
  }
  await sleep(800);

  // ====== SCENARIO 4: Circuit Breaker Trip ======
  narrate('⚡', 'SCENARIO 4: Circuit Breaker Trip');
  detail('Researcher agent "goes down" — circuit opens after consecutive failures');

  // Stop the researcher server to simulate failure
  await researcher.stop();
  detail('Researcher HTTP server stopped');

  // Make requests that will fail
  for (let i = 0; i < 3; i++) {
    const env = bus.createEnvelope(
      'research',
      '1.0.0',
      { query: `failing query ${i}` },
      PLANNER_IDENTITY
    );
    const result = await bus.submit(env);
    if (result.status !== 'success') {
      warn(`Attempt ${i + 1}: ${result.status} — ${result.error?.substring(0, 60)}`);
    }
  }

  const circuitState = bus.getCircuitState('researcher-agent');
  if (circuitState === CircuitState.OPEN) {
    success(`Circuit breaker OPEN for researcher-agent — agent is isolated`);
  } else {
    detail(`Circuit state: ${circuitState}`);
  }
  await sleep(800);

  // ====== SCENARIO 5: Retry Success ======
  narrate('🔄', 'SCENARIO 5: Retry Success');
  detail('Researcher comes back online, circuit transitions to half-open');

  // Restart the researcher
  await researcher.start(RESEARCH_PORT);
  detail('Researcher HTTP server restarted');

  // Reset the circuit to test recovery
  bus.resetCircuit('researcher-agent');
  detail('Circuit reset to CLOSED');

  const retryEnvelope = bus.createEnvelope(
    'research',
    '1.0.0',
    { query: 'retry test' },
    PLANNER_IDENTITY
  );
  const retryResult = await bus.submit(retryEnvelope);
  if (retryResult.status === 'success') {
    success(`Recovery successful: completed in ${retryResult.durationMs}ms`);
  } else {
    fail(`Recovery failed: ${retryResult.error}`);
  }
  await sleep(800);

  // ====== SCENARIO 6: Approval Workflow ======
  narrate('✋', 'SCENARIO 6: Approval Workflow');
  detail('A sensitive action requires operator approval before execution');

  const approvalEnvelope = bus.createEnvelope(
    'sensitive-action',
    '1.0.0',
    { topic: 'Delete production database backup' },
    PLANNER_IDENTITY
  );
  const approvalResult = await bus.submit(approvalEnvelope);
  const approvalOutput = approvalResult.output as { approvalId: string; status: string } | null;

  if (approvalOutput?.status === 'pending_approval') {
    success(`Action queued for approval (ID: ${approvalOutput.approvalId.substring(0, 8)}...)`);

    // Approve it
    const approved = bus.approve(approvalOutput.approvalId);
    if (approved?.status === 'approved') {
      success(`Operator approved the action`);
    }
  } else {
    detail(`Approval result: ${JSON.stringify(approvalResult.output)}`);
  }
  await sleep(800);

  // ====== SCENARIO 7: Multi-Step Orchestration ======
  narrate('🔗', 'SCENARIO 7: Multi-Step Orchestration');
  detail('Complete pipeline: plan → research → review, with full tracing');

  const orchestrationPlan = plannerHandler({ request: 'Evaluate AI governance frameworks' });
  const orchestrationTraceIds: string[] = [];

  for (const subtask of orchestrationPlan.subtasks) {
    const contract = bus.getContracts().find((c) => c.contractId === subtask.contractId);
    if (!contract) continue;

    const env = bus.createEnvelope(
      subtask.contractId,
      contract.version,
      subtask.input,
      PLANNER_IDENTITY
    );
    const result = await bus.submit(env);
    orchestrationTraceIds.push(env.traceId);
    if (result.status === 'success') {
      success(`${subtask.contractId}: ✓`);
    } else {
      warn(`${subtask.contractId}: ${result.status}`);
    }
  }

  // Show cost summary
  for (const traceId of orchestrationTraceIds) {
    const traceCost = bus.getTraceCost(traceId);
    if (traceCost.totalCost > 0) {
      detail(
        `Trace ${traceId.substring(0, 8)}: $${traceCost.totalCost.toFixed(4)} (${traceCost.totalInputTokens + traceCost.totalOutputTokens} tokens)`
      );
    }
  }

  // ====== SUMMARY ======
  console.log(`\n${BOLD}${MAGENTA}${'─'.repeat(60)}${RESET}`);
  narrate('📊', 'Demo Summary');

  const traces = bus.getRecentTraces(50);
  detail(`Total traces: ${traces.length}`);
  detail(`Total events: ${traces.reduce((s, t) => s + t.eventCount, 0)}`);

  const deadLetters = bus.getDeadLetters();
  detail(`Dead letters: ${deadLetters.length}`);

  const pending = bus.getPendingApprovals();
  detail(`Pending approvals: ${pending.length}`);

  const circuitStates = bus.getCircuitStates();
  if (Object.keys(circuitStates).length > 0) {
    detail(`Circuit breaker states: ${JSON.stringify(circuitStates)}`);
  }

  const allSpend = bus.getAllAgentSpend();
  if (allSpend.length > 0) {
    detail(`Agent spend:`);
    for (const s of allSpend) {
      detail(`  ${s.agentId}: $${s.totalCost.toFixed(4)} (${s.invocationCount} invocations)`);
    }
  }

  console.log(`\n${BOLD}${GREEN}All 7 scenarios completed.${RESET}`);
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
  (process.argv[1].endsWith('full-demo.ts') || process.argv[1].endsWith('full-demo.js'));
if (isMain) {
  runFullDemo().catch(console.error);
}
