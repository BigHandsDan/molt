import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { GrantRegistry, FederationGrant, GrantConditions } from '../src/federation/grants.js';
import { GrantUsageTracker } from '../src/federation/grant-usage.js';
import { PolicyEngine } from '../src/policy/engine.js';
import { TrustTier } from '../src/contracts/schema.js';
import { PolicyContext } from '../src/policy/types.js';

function makeConditions(overrides: Partial<GrantConditions> = {}): GrantConditions {
  return {
    requireApproval: false,
    allowedTools: [],
    blockedTools: [],
    maxConcurrent: 10,
    ...overrides,
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
    conditions: makeConditions(),
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('GrantRegistry', () => {
  let db: Database.Database;
  let registry: GrantRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new GrantRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a grant', () => {
    registry.createGrant(makeGrant());
    const grant = registry.getGrant('grant-1');
    expect(grant).toBeDefined();
    expect(grant!.fromOrgId).toBe('acme-corp');
    expect(grant!.toOrgId).toBe('widget-inc');
  });

  it('should reject duplicate grant creation', () => {
    registry.createGrant(makeGrant());
    expect(() => registry.createGrant(makeGrant())).toThrow('already exists');
  });

  it('should return undefined for unknown grantId', () => {
    expect(registry.getGrant('nonexistent')).toBeUndefined();
  });

  it('should list grants for an org (both inbound and outbound)', () => {
    registry.createGrant(makeGrant({ grantId: 'g1', fromOrgId: 'acme', toOrgId: 'widget' }));
    registry.createGrant(makeGrant({ grantId: 'g2', fromOrgId: 'widget', toOrgId: 'acme' }));
    registry.createGrant(makeGrant({ grantId: 'g3', fromOrgId: 'other', toOrgId: 'other2' }));

    const acmeGrants = registry.listGrants('acme');
    expect(acmeGrants).toHaveLength(2);

    const otherGrants = registry.listGrants('other');
    expect(otherGrants).toHaveLength(1);
  });

  it('should suspend a grant', () => {
    registry.createGrant(makeGrant());
    const suspended = registry.suspendGrant('grant-1');
    expect(suspended).toBeDefined();
    expect(suspended!.status).toBe('suspended');
  });

  it('should revoke a grant (delete)', () => {
    registry.createGrant(makeGrant());
    const revoked = registry.revokeGrant('grant-1');
    expect(revoked).toBeDefined();
    expect(revoked!.grantId).toBe('grant-1');
    // Should be deleted
    expect(registry.getGrant('grant-1')).toBeUndefined();
  });

  it('should return undefined when suspending nonexistent grant', () => {
    expect(registry.suspendGrant('nonexistent')).toBeUndefined();
  });

  it('should return undefined when revoking nonexistent grant', () => {
    expect(registry.revokeGrant('nonexistent')).toBeUndefined();
  });

  it('should check grant validity — active grant exists', () => {
    registry.createGrant(makeGrant());
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(true);
    expect(check.grantId).toBe('grant-1');
  });

  it('should deny check when no grant exists', () => {
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(false);
    expect(check.reason).toContain('No active federation grant');
  });

  it('should deny check when grant is suspended', () => {
    registry.createGrant(makeGrant());
    registry.suspendGrant('grant-1');
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(false);
  });

  it('should deny check when grant is expired', () => {
    registry.createGrant(
      makeGrant({
        expiresAt: '2020-01-01T00:00:00.000Z',
      })
    );
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(false);
    // Should auto-expire the grant
    const grant = registry.getGrant('grant-1');
    expect(grant!.status).toBe('expired');
  });

  it('should deny check when capability does not match', () => {
    registry.createGrant(makeGrant({ capabilities: ['coding'] }));
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(false);
  });

  it('should allow check when grant has empty capabilities (all allowed)', () => {
    registry.createGrant(makeGrant({ capabilities: [] }));
    const check = registry.checkGrant('acme-corp', 'widget-inc', 'research');
    expect(check.valid).toBe(true);
  });

  it('should store and retrieve grant conditions', () => {
    const conditions = makeConditions({
      requireApproval: true,
      allowedTools: ['web-search', 'calculator'],
      blockedTools: ['code-exec'],
      timeWindow: { start: '09:00', end: '17:00', daysOfWeek: [1, 2, 3, 4, 5] },
      maxConcurrent: 5,
    });
    registry.createGrant(makeGrant({ conditions }));
    const grant = registry.getGrant('grant-1');
    expect(grant!.conditions).toEqual(conditions);
  });

  it('should store optional expiresAt', () => {
    registry.createGrant(makeGrant({ expiresAt: '2030-12-31T23:59:59.000Z' }));
    const grant = registry.getGrant('grant-1');
    expect(grant!.expiresAt).toBe('2030-12-31T23:59:59.000Z');
  });

  it('should handle grant without expiresAt', () => {
    registry.createGrant(makeGrant());
    const grant = registry.getGrant('grant-1');
    expect(grant!.expiresAt).toBeUndefined();
  });
});

describe('GrantUsageTracker', () => {
  let db: Database.Database;
  let tracker: GrantUsageTracker;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    tracker = new GrantUsageTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should record usage and retrieve it', () => {
    tracker.recordUsage('grant-1', 1000, 0.5);
    const usage = tracker.getUsage('grant-1');
    expect(usage).toBeDefined();
    expect(usage!.tokensUsed).toBe(1000);
    expect(usage!.costUsed).toBeCloseTo(0.5);
    expect(usage!.requestCount).toBe(1);
  });

  it('should accumulate usage on repeated calls', () => {
    tracker.recordUsage('grant-1', 1000, 0.5);
    tracker.recordUsage('grant-1', 2000, 1.0);
    tracker.recordUsage('grant-1', 500, 0.25);
    const usage = tracker.getUsage('grant-1');
    expect(usage!.tokensUsed).toBe(3500);
    expect(usage!.costUsed).toBeCloseTo(1.75);
    expect(usage!.requestCount).toBe(3);
  });

  it('should return undefined for grant with no usage', () => {
    const usage = tracker.getUsage('nonexistent');
    expect(usage).toBeUndefined();
  });

  it('should check quota — within budget', () => {
    tracker.recordUsage('grant-1', 50000, 5.0);
    const check = tracker.checkQuota('grant-1', 100000, 10.0);
    expect(check.withinBudget).toBe(true);
  });

  it('should check quota — token limit exceeded', () => {
    tracker.recordUsage('grant-1', 100000, 5.0);
    const check = tracker.checkQuota('grant-1', 100000, 10.0);
    expect(check.withinBudget).toBe(false);
    expect(check.reason).toContain('token limit');
  });

  it('should check quota — cost limit exceeded', () => {
    tracker.recordUsage('grant-1', 50000, 10.0);
    const check = tracker.checkQuota('grant-1', 100000, 10.0);
    expect(check.withinBudget).toBe(false);
    expect(check.reason).toContain('cost limit');
  });

  it('should return within budget when no usage recorded', () => {
    const check = tracker.checkQuota('grant-1', 100000, 10.0);
    expect(check.withinBudget).toBe(true);
  });

  it('should track usage by date', () => {
    tracker.recordUsage('grant-1', 1000, 0.5);
    const today = new Date().toISOString().split('T')[0];
    const usage = tracker.getUsage('grant-1', today);
    expect(usage).toBeDefined();
    expect(usage!.date).toBe(today);
  });

  it('should return undefined for different date', () => {
    tracker.recordUsage('grant-1', 1000, 0.5);
    const usage = tracker.getUsage('grant-1', '2020-01-01');
    expect(usage).toBeUndefined();
  });
});

describe('Dual-Policy Evaluation', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine([
      {
        ruleId: 'allow-internal',
        effect: 'allow',
        priority: 100,
        conditions: { trustTierIn: [TrustTier.INTERNAL_TRUSTED] },
        description: 'Allow internal trusted agents',
      },
      {
        ruleId: 'deny-vendor',
        effect: 'deny',
        priority: 90,
        conditions: { trustTierIn: [TrustTier.PUBLIC_VENDOR] },
        description: 'Deny public vendor agents',
      },
    ]);
  });

  function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
    return {
      agentTrustTier: TrustTier.INTERNAL_TRUSTED,
      capability: 'research',
      requiredTools: [],
      agentAllowedTools: [],
      approvalRequired: false,
      agentCapabilities: ['research'],
      ...overrides,
    };
  }

  it('should approve when both policies and grant pass', () => {
    const callerCtx = makeContext();
    const targetCtx = makeContext();
    const grantCheck = { valid: true, grantId: 'grant-1' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.allowed).toBe(true);
    expect(result.callerPolicy.allowed).toBe(true);
    expect(result.targetPolicy.allowed).toBe(true);
  });

  it('should deny when caller policy denies', () => {
    const callerCtx = makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR });
    const targetCtx = makeContext();
    const grantCheck = { valid: true, grantId: 'grant-1' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.allowed).toBe(false);
    expect(result.callerPolicy.allowed).toBe(false);
    expect(result.finalDecision.reason).toContain('Caller org policy denied');
  });

  it('should deny when target policy denies', () => {
    const callerCtx = makeContext();
    const targetCtx = makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR });
    const grantCheck = { valid: true, grantId: 'grant-1' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.allowed).toBe(false);
    expect(result.targetPolicy.allowed).toBe(false);
    expect(result.finalDecision.reason).toContain('Target org policy denied');
  });

  it('should deny when grant check fails', () => {
    const callerCtx = makeContext();
    const targetCtx = makeContext();
    const grantCheck = { valid: false, reason: 'No grant exists' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.allowed).toBe(false);
    expect(result.finalDecision.reason).toContain('Federation grant check failed');
  });

  it('should deny when all checks fail', () => {
    const callerCtx = makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR });
    const targetCtx = makeContext({ agentTrustTier: TrustTier.PUBLIC_VENDOR });
    const grantCheck = { valid: false, reason: 'No grant' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.allowed).toBe(false);
  });

  it('should include all condition summaries in final decision', () => {
    const callerCtx = makeContext();
    const targetCtx = makeContext();
    const grantCheck = { valid: true, grantId: 'grant-1' };

    const result = engine.evaluateCrossOrg(callerCtx, targetCtx, grantCheck);
    expect(result.finalDecision.conditions).toContain('callerPolicy: allow');
    expect(result.finalDecision.conditions).toContain('targetPolicy: allow');
    expect(result.finalDecision.conditions).toContain('grant: valid');
  });
});
