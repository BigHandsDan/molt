import { describe, it, expect } from 'vitest';
import { IdentityRegistry } from '../src/identity/registry.js';
import { AgentIdentity, TrustTier } from '../src/identity/types.js';
import { meetsMinimumTrust, getTrustLevel, isInternal, isExternal } from '../src/identity/trust.js';

function makeAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    trustTier: TrustTier.INTERNAL_TRUSTED,
    capabilities: ['test'],
    allowedTools: ['tool1'],
    metadata: {},
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('IdentityRegistry', () => {
  it('should register and retrieve an agent', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent());
    const agent = reg.get('test-agent');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('Test Agent');
  });

  it('should prevent duplicate agent registration', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent());
    expect(() => reg.register(makeAgent())).toThrow('already registered');
  });

  it('should return undefined for unknown agents', () => {
    const reg = new IdentityRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('should list all agents', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent({ agentId: 'a' }));
    reg.register(makeAgent({ agentId: 'b' }));
    expect(reg.getAll()).toHaveLength(2);
  });

  it('should find agents by capability', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent({ agentId: 'a', capabilities: ['research', 'analysis'] }));
    reg.register(makeAgent({ agentId: 'b', capabilities: ['coding'] }));
    reg.register(makeAgent({ agentId: 'c', capabilities: ['research'] }));
    const researchers = reg.findByCapability('research');
    expect(researchers).toHaveLength(2);
    expect(researchers.map((a) => a.agentId).sort()).toEqual(['a', 'c']);
  });

  it('should check existence with has()', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent());
    expect(reg.has('test-agent')).toBe(true);
    expect(reg.has('nonexistent')).toBe(false);
  });

  it('should remove agents', () => {
    const reg = new IdentityRegistry();
    reg.register(makeAgent());
    expect(reg.remove('test-agent')).toBe(true);
    expect(reg.has('test-agent')).toBe(false);
    expect(reg.remove('nonexistent')).toBe(false);
  });
});

describe('Trust Tiers', () => {
  it('should correctly compare trust levels', () => {
    expect(meetsMinimumTrust(TrustTier.INTERNAL_TRUSTED, TrustTier.INTERNAL_TRUSTED)).toBe(true);
    expect(meetsMinimumTrust(TrustTier.INTERNAL_TRUSTED, TrustTier.PUBLIC_VENDOR)).toBe(true);
    expect(meetsMinimumTrust(TrustTier.PUBLIC_VENDOR, TrustTier.INTERNAL_TRUSTED)).toBe(false);
    expect(meetsMinimumTrust(TrustTier.EXTERNAL_PARTNER, TrustTier.INTERNAL_RESTRICTED)).toBe(
      false
    );
  });

  it('should return correct trust levels', () => {
    expect(getTrustLevel(TrustTier.INTERNAL_TRUSTED)).toBe(4);
    expect(getTrustLevel(TrustTier.INTERNAL_RESTRICTED)).toBe(3);
    expect(getTrustLevel(TrustTier.EXTERNAL_PARTNER)).toBe(2);
    expect(getTrustLevel(TrustTier.PUBLIC_VENDOR)).toBe(1);
  });

  it('should identify internal tiers', () => {
    expect(isInternal(TrustTier.INTERNAL_TRUSTED)).toBe(true);
    expect(isInternal(TrustTier.INTERNAL_RESTRICTED)).toBe(true);
    expect(isInternal(TrustTier.EXTERNAL_PARTNER)).toBe(false);
    expect(isInternal(TrustTier.PUBLIC_VENDOR)).toBe(false);
  });

  it('should identify external tiers', () => {
    expect(isExternal(TrustTier.EXTERNAL_PARTNER)).toBe(true);
    expect(isExternal(TrustTier.PUBLIC_VENDOR)).toBe(true);
    expect(isExternal(TrustTier.INTERNAL_TRUSTED)).toBe(false);
    expect(isExternal(TrustTier.INTERNAL_RESTRICTED)).toBe(false);
  });
});
