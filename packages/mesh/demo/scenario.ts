import { MoltMesh } from '../src/index.js';
import { PLANNER_IDENTITY, PLANNING_CONTRACT, plannerHandler } from './agents/planner.js';
import {
  RESEARCHER_IDENTITY,
  RESEARCH_CONTRACT,
  createResearcherServer,
} from './agents/researcher.js';
import { REVIEWER_IDENTITY, REVIEW_CONTRACT, reviewerMockHandler } from './agents/reviewer.js';

const RESEARCH_PORT = 9877;

/**
 * Sets up the MoltMesh bus with all demo agents, contracts, and adapters.
 * Returns the configured bus and a cleanup function.
 */
export async function setupDemo() {
  // Start the researcher HTTP server
  const researcher = createResearcherServer();
  await researcher.start(RESEARCH_PORT);

  // Create the bus with the reviewer's mock OpenAI handler
  const bus = new MoltMesh({
    openAIHandler: reviewerMockHandler,
  });

  // Register contracts
  bus.registerContract(PLANNING_CONTRACT);
  bus.registerContract(RESEARCH_CONTRACT);
  bus.registerContract(REVIEW_CONTRACT);

  // Register the planner (uses echo adapter — we intercept and handle locally)
  // We'll use a custom adapter approach: register with echo, but the planner
  // is really handled by the plannerHandler function before submitting subtasks
  bus.registerAgent(PLANNER_IDENTITY, {
    agentId: PLANNER_IDENTITY.agentId,
    metadata: { protocol: 'echo' },
  });

  // Register the researcher (HTTP adapter)
  bus.registerAgent(RESEARCHER_IDENTITY, {
    agentId: RESEARCHER_IDENTITY.agentId,
    endpoint: `http://localhost:${RESEARCH_PORT}/task`,
    metadata: { protocol: 'http' },
  });

  // Register the reviewer (OpenAI adapter)
  bus.registerAgent(REVIEWER_IDENTITY, {
    agentId: REVIEWER_IDENTITY.agentId,
    model: 'gpt-4',
    metadata: { protocol: 'openai' },
  });

  const cleanup = async () => {
    bus.close();
    await researcher.stop();
  };

  return { bus, cleanup };
}

/**
 * Run the full demo scenario.
 */
export async function runDemo() {
  console.log('=== MoltMesh Phase 0 Demo ===\n');

  const { bus, cleanup } = await setupDemo();

  try {
    console.log(
      'Registered contracts:',
      bus
        .getContracts()
        .map((c) => c.contractId)
        .join(', ')
    );
    console.log(
      'Registered agents:',
      bus
        .getAgents()
        .map((a) => a.agentId)
        .join(', ')
    );
    console.log('');

    // Step 1: Submit the planning task
    // The planner uses echo adapter, so it echoes back the input.
    // In a real scenario, the planner would process and return subtasks.
    // For the demo, we manually handle the planner and submit subtasks.
    const request = 'Research the current state of agent interoperability';
    console.log(`Submitting request: "${request}"\n`);

    // Run planner logic locally (it's a direct TS agent)
    const plan = plannerHandler({ request });
    console.log(`Planner created ${plan.subtasks.length} subtasks:`);
    plan.subtasks.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.contractId}] ${s.description}`);
    });
    console.log('');

    // Submit each subtask through the bus
    const results = [];
    for (const subtask of plan.subtasks) {
      const contract = bus.getContracts().find((c) => c.contractId === subtask.contractId);
      if (!contract) {
        console.log(`  Skipping ${subtask.contractId}: contract not found`);
        continue;
      }

      console.log(`Dispatching: ${subtask.contractId} via bus...`);
      const envelope = bus.createEnvelope(
        subtask.contractId,
        contract.version,
        subtask.input,
        PLANNER_IDENTITY
      );

      const result = await bus.submit(envelope);
      results.push({ contractId: subtask.contractId, result });
      console.log(`  Status: ${result.status}`);
      console.log(`  Duration: ${result.durationMs}ms`);
      if (result.tokenUsage) {
        console.log(`  Tokens: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`);
      }
      console.log('');
    }

    // Show traces
    const traces = bus.getRecentTraces(10);
    console.log(`\nTrace summary: ${traces.length} trace(s) recorded`);
    for (const t of traces) {
      console.log(`  Trace ${t.traceId.substring(0, 8)}... — ${t.eventCount} events`);
      const events = bus.getTrace(t.traceId);
      for (const e of events) {
        const duration = e.durationMs ? ` (${e.durationMs}ms)` : '';
        console.log(`    [${e.eventType}] ${e.data.contractId || ''}${duration}`);
      }
    }

    console.log('\n=== Demo Complete ===');
  } finally {
    await cleanup();
  }
}

// Run if executed directly
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('scenario.ts') || process.argv[1].endsWith('scenario.js'));
if (isMainModule) {
  runDemo().catch(console.error);
}
