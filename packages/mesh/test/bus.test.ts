import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MoltMesh } from '../src/bus.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';
import { AgentIdentity } from '../src/identity/types.js';
import { OpenAIHandler } from '../src/adapters/openai.js';

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    contractId: 'test',
    version: '1.0.0',
    capability: 'test',
    description: 'Test contract',
    inputSchema: {
      type: 'object',
      properties: { msg: { type: 'string' } },
      required: ['msg'],
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
    capabilities: ['test'],
    allowedTools: [],
    metadata: {},
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MoltMesh Bus', () => {
  let bus: MoltMesh;

  beforeEach(() => {
    bus = new MoltMesh();
  });

  afterEach(() => {
    bus.close();
  });

  it('should register contracts', () => {
    bus.registerContract(makeContract());
    expect(bus.getContracts()).toHaveLength(1);
  });

  it('should register agents', () => {
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });
    expect(bus.getAgents()).toHaveLength(1);
  });

  it('should submit and get a result via echo adapter', async () => {
    bus.registerContract(makeContract());
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ msg: 'hello' });
  });

  it('should record traces for submitted tasks', async () => {
    bus.registerContract(makeContract());
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    await bus.submit(envelope);

    const traces = bus.getTrace(envelope.traceId);
    expect(traces.length).toBeGreaterThan(0);
    const eventTypes = traces.map((t) => t.eventType);
    expect(eventTypes).toContain('ingress');
    expect(eventTypes).toContain('validate');
    expect(eventTypes).toContain('policy');
    expect(eventTypes).toContain('dispatch');
    expect(eventTypes).toContain('response');
  });

  it('should handle errors gracefully', async () => {
    bus.registerContract(makeContract());
    // No agent registered — should fail
    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    const result = await bus.submit(envelope);
    expect(result.status).toBe('failure');
    expect(result.error).toBeDefined();
  });

  it('should record error traces', async () => {
    bus.registerContract(makeContract());
    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    await bus.submit(envelope);

    const traces = bus.getTrace(envelope.traceId);
    const errorEvents = traces.filter((t) => t.eventType === 'error');
    expect(errorEvents.length).toBeGreaterThan(0);
  });

  it('should deny tasks from untrusted agents', async () => {
    bus.registerContract(makeContract());
    const vendorAgent = makeAgent({
      agentId: 'vendor-1',
      trustTier: TrustTier.PUBLIC_VENDOR,
    });
    bus.registerAgent(vendorAgent, {
      agentId: 'vendor-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent(), {
      target: 'vendor-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
  });

  it('should fail on unknown contract', async () => {
    const envelope = bus.createEnvelope('nonexistent', '1.0.0', {}, makeAgent());
    const result = await bus.submit(envelope);
    expect(result.status).toBe('failure');
    expect(result.error).toContain('Contract not found');
  });

  it('should fail on invalid input', async () => {
    bus.registerContract(makeContract());
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 123 }, makeAgent());
    const result = await bus.submit(envelope);
    expect(result.status).toBe('failure');
  });

  it('should use OpenAI adapter for model-configured agents', async () => {
    const handler: OpenAIHandler = async () => ({
      content: JSON.stringify({ result: 'from openai' }),
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    bus.close();
    bus = new MoltMesh({ openAIHandler: handler });

    bus.registerContract(makeContract({ capability: 'review' }));
    bus.registerAgent(
      makeAgent({
        agentId: 'openai-agent',
        capabilities: ['review'],
      }),
      {
        agentId: 'openai-agent',
        model: 'gpt-4',
        metadata: { protocol: 'openai' },
      }
    );

    const envelope = bus.createEnvelope(
      'test',
      '1.0.0',
      { msg: 'review this' },
      makeAgent({ agentId: 'caller' }),
      { target: 'openai-agent' }
    );
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
    expect((result.output as any).result).toBe('from openai');
    expect(result.tokenUsage).toBeDefined();
  });

  it('should create envelopes with proper fields', () => {
    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hi' }, makeAgent(), {
      target: 'specific',
      metadata: { custom: true },
    });
    expect(envelope.contractId).toBe('test');
    expect(envelope.version).toBe('1.0.0');
    expect(envelope.envelopeId).toBeDefined();
    expect(envelope.traceId).toBeDefined();
    expect(envelope.target).toBe('specific');
    expect(envelope.metadata.custom).toBe(true);
  });

  it('should list recent traces', async () => {
    bus.registerContract(makeContract());
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    await bus.submit(envelope);

    const recent = bus.getRecentTraces();
    expect(recent.length).toBeGreaterThan(0);
  });

  it('should query traces with filters', async () => {
    bus.registerContract(makeContract());
    bus.registerAgent(makeAgent(), {
      agentId: 'agent-1',
      metadata: { protocol: 'echo' },
    });

    const envelope = bus.createEnvelope('test', '1.0.0', { msg: 'hello' }, makeAgent());
    await bus.submit(envelope);

    const policyTraces = bus.getTraces({ eventType: 'policy' });
    expect(policyTraces.length).toBeGreaterThan(0);
  });

  it('should provide access to sub-registries', () => {
    expect(bus.getContractRegistry()).toBeDefined();
    expect(bus.getIdentityRegistry()).toBeDefined();
    expect(bus.getPolicyEngine()).toBeDefined();
  });
});
