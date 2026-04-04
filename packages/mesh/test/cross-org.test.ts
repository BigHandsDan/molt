import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MoltMesh } from '../src/bus.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';
import { AgentIdentity } from '../src/identity/types.js';
import { OrgTier } from '../src/federation/organization.js';
import { DEFAULT_NAMESPACE_QUOTAS } from '../src/federation/namespace.js';
import { FederationGrant, GrantConditions } from '../src/federation/grants.js';

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

function makeGrant(overrides: Partial<FederationGrant> = {}): FederationGrant {
  return {
    grantId: 'grant-1',
    fromOrgId: 'acme-corp',
    toOrgId: 'widget-inc',
    contractIds: [],
    capabilities: ['research'],
    maxTokensPerDay: 100000,
    maxCostPerDay: 10.0,
    conditions: makeGrantConditions(),
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Cross-Org Routing', () => {
  let bus: MoltMesh;

  beforeEach(() => {
    bus = new MoltMesh();

    // Register orgs
    bus.registerOrg({
      orgId: 'acme-corp',
      name: 'Acme Corporation',
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

    // Register namespaces
    bus.createNamespace({
      namespaceId: 'acme-corp/engineering',
      orgId: 'acme-corp',
      name: 'engineering',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });
    bus.createNamespace({
      namespaceId: 'widget-inc/dev',
      orgId: 'widget-inc',
      name: 'dev',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });
  });

  afterEach(() => {
    bus.close();
  });

  it('should allow same-namespace requests without grants', async () => {
    bus.registerContract(makeContract());

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller);
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
  });

  it('should allow same-org requests without grants', async () => {
    bus.registerContract(makeContract());
    bus.createNamespace({
      namespaceId: 'acme-corp/sales',
      orgId: 'acme-corp',
      name: 'sales',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/sales',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller);
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
  });

  it('should deny cross-org request without grant', async () => {
    bus.registerContract(makeContract());

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('NAMESPACE_ISOLATION');
  });

  it('should allow cross-org request with valid grant', async () => {
    bus.registerContract(makeContract());
    bus.createGrant(makeGrant());

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
  });

  it('should deny cross-org request with suspended grant', async () => {
    bus.registerContract(makeContract());
    bus.createGrant(makeGrant());
    bus.suspendGrant('grant-1');

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('NAMESPACE_ISOLATION');
  });

  it('should deny cross-org request with expired grant', async () => {
    bus.registerContract(makeContract());
    bus.createGrant(makeGrant({ expiresAt: '2020-01-01T00:00:00.000Z' }));

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
  });

  it('should deny cross-org request with revoked grant', async () => {
    bus.registerContract(makeContract());
    bus.createGrant(makeGrant());
    bus.revokeGrant('grant-1');

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
  });

  it('should maintain backward compatibility — no org/namespace defaults to default', async () => {
    bus.registerContract(makeContract());
    const agent = makeAgent(); // no orgId/namespaceId
    bus.registerAgent(agent, { agentId: 'agent-1', metadata: { protocol: 'echo' } });

    const caller = makeAgent({ agentId: 'caller' }); // no orgId/namespaceId
    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'hello' }, caller);
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');
  });

  it('should record federation trace events for cross-org dispatch', async () => {
    bus.registerContract(makeContract());
    bus.createGrant(makeGrant());

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });

    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('success');

    // Check trace events
    const traceEvents = bus.getTrace(envelope.traceId);
    const eventTypes = traceEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('namespace_resolve');
    expect(eventTypes).toContain('federation_check');
    expect(eventTypes).toContain('cross_org_policy');
  });

  it('should record namespace_resolve even for same-org requests', async () => {
    bus.registerContract(makeContract());
    const agent = makeAgent({
      agentId: 'agent-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });
    bus.registerAgent(agent, { agentId: 'agent-1', metadata: { protocol: 'echo' } });

    const caller = makeAgent({
      agentId: 'caller',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });
    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'hi' }, caller);
    await bus.submit(envelope);

    const traceEvents = bus.getTrace(envelope.traceId);
    const eventTypes = traceEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('namespace_resolve');
  });
});

describe('Cross-Org Bus API', () => {
  let bus: MoltMesh;

  beforeEach(() => {
    bus = new MoltMesh();
  });

  afterEach(() => {
    bus.close();
  });

  it('should register and list orgs via bus', () => {
    bus.registerOrg({
      orgId: 'org-1',
      name: 'Org 1',
      tier: OrgTier.OWNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.registerOrg({
      orgId: 'org-2',
      name: 'Org 2',
      tier: OrgTier.PARTNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    expect(bus.listOrgs()).toHaveLength(2);
    expect(bus.getOrg('org-1')!.name).toBe('Org 1');
  });

  it('should update org via bus', () => {
    bus.registerOrg({
      orgId: 'org-1',
      name: 'Org 1',
      tier: OrgTier.OWNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    const updated = bus.updateOrg('org-1', { name: 'Updated Org' });
    expect(updated!.name).toBe('Updated Org');
  });

  it('should create and list namespaces via bus', () => {
    bus.createNamespace({
      namespaceId: 'org/ns1',
      orgId: 'org',
      name: 'ns1',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });
    expect(bus.listNamespaces('org')).toHaveLength(1);
    expect(bus.getNamespace('org/ns1')).toBeDefined();
  });

  it('should update namespace quotas via bus', () => {
    bus.createNamespace({
      namespaceId: 'org/ns1',
      orgId: 'org',
      name: 'ns1',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });
    const updated = bus.updateNamespaceQuotas('org/ns1', { maxAgents: 50 });
    expect(updated!.quotas.maxAgents).toBe(50);
  });

  it('should create and list grants via bus', () => {
    bus.createGrant(makeGrant());
    expect(bus.listGrants('acme-corp')).toHaveLength(1);
    expect(bus.getGrant('grant-1')).toBeDefined();
  });

  it('should suspend grant via bus', () => {
    bus.createGrant(makeGrant());
    const suspended = bus.suspendGrant('grant-1');
    expect(suspended!.status).toBe('suspended');
  });

  it('should revoke grant via bus', () => {
    bus.createGrant(makeGrant());
    bus.revokeGrant('grant-1');
    expect(bus.getGrant('grant-1')).toBeUndefined();
  });

  it('should expose registry accessors', () => {
    expect(bus.getOrgRegistry()).toBeDefined();
    expect(bus.getNamespaceRegistry()).toBeDefined();
    expect(bus.getGrantRegistry()).toBeDefined();
  });
});

describe('Grant Quota Enforcement via Routing', () => {
  let bus: MoltMesh;

  beforeEach(() => {
    bus = new MoltMesh();
    bus.registerOrg({
      orgId: 'acme-corp',
      name: 'Acme',
      tier: OrgTier.OWNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    bus.registerOrg({
      orgId: 'widget-inc',
      name: 'Widget',
      tier: OrgTier.PARTNER,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    bus.close();
  });

  it('should deny cross-org request when grant token quota is exhausted', async () => {
    // Create grant with very low token limit
    bus.createGrant(makeGrant({ maxTokensPerDay: 100, maxCostPerDay: 0.01 }));

    // Pre-fill usage to exceed quota
    const grantUsageTracker = (bus as any).grantUsageTracker;
    grantUsageTracker.recordUsage('grant-1', 100, 0.01);

    bus.registerContract(makeContract());
    const target = makeAgent({
      agentId: 'target-1',
      orgId: 'acme-corp',
      namespaceId: 'acme-corp/engineering',
    });
    bus.registerAgent(target, { agentId: 'target-1', metadata: { protocol: 'echo' } });

    bus.createNamespace({
      namespaceId: 'acme-corp/engineering',
      orgId: 'acme-corp',
      name: 'engineering',
      quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
      metadata: {},
    });

    const caller = makeAgent({
      agentId: 'caller-1',
      orgId: 'widget-inc',
      namespaceId: 'widget-inc/dev',
    });

    const envelope = bus.createEnvelope('research', '1.0.0', { query: 'test' }, caller, {
      target: 'target-1',
    });
    const result = await bus.submit(envelope);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('GRANT_QUOTA_EXCEEDED');
  });
});

describe('Contract Visibility Fields', () => {
  it('should accept contracts with visibility fields', () => {
    const bus = new MoltMesh();
    bus.registerContract(
      makeContract({
        ownerOrgId: 'acme-corp',
        ownerNamespace: 'acme-corp/engineering',
        visibility: 'federated',
      })
    );
    const contracts = bus.getContracts();
    expect(contracts).toHaveLength(1);
    expect(contracts[0].visibility).toBe('federated');
    expect(contracts[0].ownerOrgId).toBe('acme-corp');
    bus.close();
  });

  it('should default visibility fields to undefined for backward compatibility', () => {
    const bus = new MoltMesh();
    bus.registerContract(makeContract());
    const contracts = bus.getContracts();
    expect(contracts[0].visibility).toBeUndefined();
    expect(contracts[0].ownerOrgId).toBeUndefined();
    bus.close();
  });
});
