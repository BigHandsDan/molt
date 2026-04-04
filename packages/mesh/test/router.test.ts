import { describe, it, expect, beforeEach } from 'vitest';
import { Router, RouterDeps } from '../src/router/router.js';
import { Dispatcher } from '../src/router/dispatcher.js';
import { TaskEnvelope } from '../src/router/types.js';
import { ContractRegistry } from '../src/contracts/registry.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';
import { IdentityRegistry } from '../src/identity/registry.js';
import { AgentIdentity } from '../src/identity/types.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { EchoAdapter } from '../src/adapters/echo.js';
import { MoltMeshAdapter, AdapterConfig } from '../src/adapters/interface.js';

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    contractId: 'test',
    version: '1.0.0',
    capability: 'test',
    description: 'Test',
    inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
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
    agentId: 'agent1',
    name: 'Agent 1',
    description: 'Test',
    trustTier: TrustTier.INTERNAL_TRUSTED,
    capabilities: ['test'],
    allowedTools: [],
    metadata: {},
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    envelopeId: 'env-1',
    contractId: 'test',
    version: '1.0.0',
    input: { msg: 'hello' },
    caller: makeAgent({ agentId: 'caller' }),
    traceId: 'trace-1',
    metadata: {},
    ...overrides,
  };
}

function makeRouterDeps(): RouterDeps {
  const contracts = new ContractRegistry();
  const identities = new IdentityRegistry();
  const policy = new PolicyEngine();
  const adapters = new Map<string, MoltMeshAdapter>();
  const agentConfigs = new Map<string, AdapterConfig>();

  adapters.set('echo', new EchoAdapter());

  return { contracts, identities, policy, adapters, agentConfigs };
}

describe('Router', () => {
  let deps: RouterDeps;
  let router: Router;

  beforeEach(() => {
    deps = makeRouterDeps();
    router = new Router(deps);
  });

  it('should route a valid task to an agent', async () => {
    deps.contracts.register(makeContract());
    deps.identities.register(makeAgent());
    deps.agentConfigs.set('agent1', { agentId: 'agent1', metadata: { protocol: 'echo' } });

    const result = await router.route(makeEnvelope());
    expect(result.taskResult.status).toBe('success');
    expect(result.taskResult.output).toEqual({ msg: 'hello' }); // echo
  });

  it('should throw for unknown contracts', async () => {
    await expect(router.route(makeEnvelope())).rejects.toThrow('Contract not found');
  });

  it('should fail validation for bad input', async () => {
    deps.contracts.register(makeContract());
    deps.identities.register(makeAgent());
    deps.agentConfigs.set('agent1', { agentId: 'agent1', metadata: { protocol: 'echo' } });

    const result = await router.route(makeEnvelope({ input: { msg: 123 } }));
    expect(result.taskResult.status).toBe('failure');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it('should deny tasks that fail policy', async () => {
    deps.contracts.register(makeContract());
    deps.identities.register(makeAgent({ trustTier: TrustTier.PUBLIC_VENDOR }));
    deps.agentConfigs.set('agent1', { agentId: 'agent1', metadata: { protocol: 'echo' } });

    const result = await router.route(makeEnvelope());
    expect(result.taskResult.status).toBe('denied');
    expect(result.policyDecision.allowed).toBe(false);
  });

  it('should route by capability when no target specified', async () => {
    deps.contracts.register(makeContract({ capability: 'research' }));
    deps.identities.register(makeAgent({ agentId: 'researcher', capabilities: ['research'] }));
    deps.agentConfigs.set('researcher', {
      agentId: 'researcher',
      metadata: { protocol: 'echo' },
    });

    const result = await router.route(makeEnvelope({ target: undefined }));
    expect(result.targetAgent.agentId).toBe('researcher');
  });

  it('should route to specific target when specified', async () => {
    deps.contracts.register(makeContract());
    deps.identities.register(makeAgent({ agentId: 'specific' }));
    deps.agentConfigs.set('specific', {
      agentId: 'specific',
      metadata: { protocol: 'echo' },
    });

    const result = await router.route(makeEnvelope({ target: 'specific' }));
    expect(result.targetAgent.agentId).toBe('specific');
  });

  it('should throw when no agent found for capability', async () => {
    deps.contracts.register(makeContract({ capability: 'rare' }));
    await expect(router.route(makeEnvelope())).rejects.toThrow('No agent found');
  });
});

describe('Dispatcher', () => {
  it('should dispatch and return result', async () => {
    const dispatcher = new Dispatcher();
    const echo = new EchoAdapter();
    const config: AdapterConfig = { agentId: 'agent1' };
    const envelope = makeEnvelope();

    const result = await dispatcher.dispatch(envelope, echo, config, 5000);
    expect(result.status).toBe('success');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle timeout', async () => {
    const dispatcher = new Dispatcher();
    const slowAdapter: MoltMeshAdapter = {
      adapterId: 'slow',
      name: 'Slow',
      protocol: 'slow',
      dispatch: async () => new Promise((resolve) => setTimeout(resolve, 10000)) as any,
      healthCheck: async () => true,
    };

    const result = await dispatcher.dispatch(
      makeEnvelope(),
      slowAdapter,
      { agentId: 'agent1' },
      50
    );
    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    const failThenSucceed: MoltMeshAdapter = {
      adapterId: 'flakey',
      name: 'Flakey',
      protocol: 'flakey',
      dispatch: async (env, config) => {
        attempts++;
        if (attempts < 3) throw new Error('temporary failure');
        return {
          envelopeId: env.envelopeId,
          contractId: env.contractId,
          output: { done: true },
          status: 'success' as const,
          agentId: config.agentId,
          durationMs: 0,
        };
      },
      healthCheck: async () => true,
    };

    const dispatcher = new Dispatcher();
    const result = await dispatcher.dispatchWithRetry(
      makeEnvelope(),
      failThenSucceed,
      { agentId: 'agent1' },
      5000,
      3,
      10
    );
    expect(result.status).toBe('success');
    expect(attempts).toBe(3);
  });
});
