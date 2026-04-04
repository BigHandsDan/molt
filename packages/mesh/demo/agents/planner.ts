import { MoltMesh, TrustTier, AgentIdentity, TaskContract } from '../../src/index.js';

/**
 * Planner agent — Framework A (direct TypeScript).
 * Receives a high-level research request, breaks it into subtasks,
 * and emits task contracts for each subtask through the bus.
 */

export const PLANNER_IDENTITY: AgentIdentity = {
  agentId: 'planner-agent',
  name: 'Planner Agent',
  description: 'Breaks high-level requests into subtasks and orchestrates their execution',
  trustTier: TrustTier.INTERNAL_TRUSTED,
  capabilities: ['planning', 'orchestration'],
  allowedTools: ['web_search', 'code_analysis', 'summarize'],
  metadata: { framework: 'direct-ts' },
  registeredAt: new Date().toISOString(),
};

export const PLANNING_CONTRACT: TaskContract = {
  contractId: 'planning',
  version: '1.0.0',
  capability: 'planning',
  description: 'Break a high-level request into subtasks',
  inputSchema: {
    type: 'object',
    properties: {
      request: { type: 'string' },
    },
    required: ['request'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      subtasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contractId: { type: 'string' },
            description: { type: 'string' },
            input: { type: 'object' },
          },
          required: ['contractId', 'description', 'input'],
        },
      },
    },
    required: ['subtasks'],
  },
  securityClass: TrustTier.INTERNAL_TRUSTED,
  requiredTools: [],
  timeout: 5000,
  retryPolicy: { maxRetries: 1, backoffMs: 500 },
  approvalRequired: false,
};

export function plannerHandler(input: { request: string }) {
  // The planner breaks the request into two subtasks
  return {
    subtasks: [
      {
        contractId: 'research',
        description: `Gather sources about: ${input.request}`,
        input: {
          query: input.request,
          maxSources: 5,
        },
      },
      {
        contractId: 'review',
        description: `Analyze trends in: ${input.request}`,
        input: {
          topic: input.request,
          criteria: ['relevance', 'recency', 'impact'],
        },
      },
    ],
  };
}

export async function executePlannerWorkflow(
  bus: MoltMesh,
  request: string
): Promise<{
  planResult: unknown;
  subtaskResults: Array<{ contractId: string; result: unknown }>;
  traceId: string;
}> {
  // Submit the planning task
  const planEnvelope = bus.createEnvelope('planning', '1.0.0', { request }, PLANNER_IDENTITY);

  const planResult = await bus.submit(planEnvelope);
  const traceId = planEnvelope.traceId;

  const subtaskResults: Array<{ contractId: string; result: unknown }> = [];

  if (planResult.status === 'success' && planResult.output) {
    const plan = planResult.output as {
      subtasks: Array<{ contractId: string; input: unknown }>;
    };

    // Submit each subtask through the bus
    for (const subtask of plan.subtasks) {
      const contract = bus.getContracts().find((c) => c.contractId === subtask.contractId);
      if (!contract) continue;

      const subtaskEnvelope = bus.createEnvelope(
        subtask.contractId,
        contract.version,
        subtask.input,
        PLANNER_IDENTITY,
        { parentSpanId: planEnvelope.envelopeId }
      );
      // Preserve the same traceId for the whole workflow
      (subtaskEnvelope as { traceId: string }).traceId = traceId;

      const result = await bus.submit(subtaskEnvelope);
      subtaskResults.push({ contractId: subtask.contractId, result: result });
    }
  }

  return { planResult, subtaskResults, traceId };
}
