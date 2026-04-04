import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CapabilityRegistry } from '../src/discovery/registry.js';
import { AgentCapability, CapabilityPerformance } from '../src/discovery/types.js';

function makeCapability(
  overrides: Partial<Omit<AgentCapability, 'id' | 'registeredAt' | 'lastSeenAt'>> = {}
): Omit<AgentCapability, 'id' | 'registeredAt' | 'lastSeenAt'> {
  return {
    agentId: 'agent-1',
    contractIds: ['contract-summarize'],
    description: 'Summarization agent',
    status: 'available',
    ttlMs: 60_000,
    ...overrides,
  };
}

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  afterEach(() => {
    registry.close();
  });

  // --- Registration ---

  it('should register a capability and return it with id and timestamps', () => {
    const cap = registry.register(makeCapability());
    expect(cap.id).toBeDefined();
    expect(typeof cap.id).toBe('string');
    expect(cap.agentId).toBe('agent-1');
    expect(cap.contractIds).toEqual(['contract-summarize']);
    expect(cap.description).toBe('Summarization agent');
    expect(cap.status).toBe('available');
    expect(cap.registeredAt).toBeGreaterThan(0);
    expect(cap.lastSeenAt).toBe(cap.registeredAt);
    expect(cap.ttlMs).toBe(60_000);
  });

  it('should register multiple capabilities for the same agent', () => {
    registry.register(makeCapability({ contractIds: ['contract-a'] }));
    registry.register(makeCapability({ contractIds: ['contract-b'] }));
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps).toHaveLength(2);
  });

  it('should store input and output schemas', () => {
    const cap = registry.register(
      makeCapability({
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
      })
    );
    expect(cap.inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } } });
    expect(cap.outputSchema).toEqual({ type: 'object', properties: { summary: { type: 'string' } } });
  });

  it('should store performance metadata on registration', () => {
    const cap = registry.register(
      makeCapability({
        performance: { avgLatencyMs: 100, successRate: 0.95, costPerCall: 0.5 },
      })
    );
    expect(cap.performance).toEqual({ avgLatencyMs: 100, successRate: 0.95, costPerCall: 0.5 });
  });

  // --- Heartbeat ---

  it('should update lastSeenAt on heartbeat', () => {
    const cap = registry.register(makeCapability());
    const originalLastSeen = cap.lastSeenAt;
    // Small delay to ensure timestamp changes
    const result = registry.heartbeat(cap.id);
    expect(result).toBe(true);
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].lastSeenAt).toBeGreaterThanOrEqual(originalLastSeen);
  });

  it('should return false for heartbeat on non-existent capability', () => {
    expect(registry.heartbeat('non-existent')).toBe(false);
  });

  // --- Status Updates ---

  it('should update capability status', () => {
    const cap = registry.register(makeCapability());
    const result = registry.updateStatus(cap.id, 'busy');
    expect(result).toBe(true);
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].status).toBe('busy');
  });

  it('should return false for status update on non-existent capability', () => {
    expect(registry.updateStatus('non-existent', 'offline')).toBe(false);
  });

  it('should set status to offline', () => {
    const cap = registry.register(makeCapability());
    registry.updateStatus(cap.id, 'offline');
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].status).toBe('offline');
  });

  it('should set status to degraded', () => {
    const cap = registry.register(makeCapability());
    registry.updateStatus(cap.id, 'degraded');
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].status).toBe('degraded');
  });

  // --- Performance Updates ---

  it('should update performance metadata', () => {
    const cap = registry.register(makeCapability());
    const result = registry.updatePerformance(cap.id, {
      avgLatencyMs: 200,
      successRate: 0.99,
      costPerCall: 1.0,
    });
    expect(result).toBe(true);
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].performance).toEqual({
      avgLatencyMs: 200,
      successRate: 0.99,
      costPerCall: 1.0,
    });
  });

  it('should partially update performance (only specified fields)', () => {
    const cap = registry.register(
      makeCapability({ performance: { avgLatencyMs: 100, successRate: 0.9, costPerCall: 0.5 } })
    );
    registry.updatePerformance(cap.id, { successRate: 0.95 });
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].performance?.successRate).toBe(0.95);
    expect(caps[0].performance?.avgLatencyMs).toBe(100); // unchanged
    expect(caps[0].performance?.costPerCall).toBe(0.5); // unchanged
  });

  it('should return false for performance update on non-existent capability', () => {
    expect(registry.updatePerformance('non-existent', { avgLatencyMs: 100 })).toBe(false);
  });

  // --- Deregister ---

  it('should deregister a capability', () => {
    const cap = registry.register(makeCapability());
    expect(registry.deregister(cap.id)).toBe(true);
    expect(registry.getAgentCapabilities('agent-1')).toHaveLength(0);
  });

  it('should return false when deregistering non-existent capability', () => {
    expect(registry.deregister('non-existent')).toBe(false);
  });

  // --- Discovery ---

  it('should discover capabilities by contractId', () => {
    registry.register(makeCapability({ contractIds: ['contract-a'] }));
    registry.register(makeCapability({ agentId: 'agent-2', contractIds: ['contract-b'] }));

    const results = registry.discover({ contractId: 'contract-a' });
    expect(results).toHaveLength(1);
    expect(results[0].contractIds).toContain('contract-a');
  });

  it('should discover capabilities by agentId', () => {
    registry.register(makeCapability({ agentId: 'agent-1' }));
    registry.register(makeCapability({ agentId: 'agent-2' }));

    const results = registry.discover({ agentId: 'agent-1' });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-1');
  });

  it('should discover capabilities by status', () => {
    const cap1 = registry.register(makeCapability());
    registry.register(makeCapability({ agentId: 'agent-2' }));
    registry.updateStatus(cap1.id, 'busy');

    const results = registry.discover({ status: 'available' });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-2');
  });

  it('should discover capabilities by minSuccessRate', () => {
    registry.register(
      makeCapability({ agentId: 'agent-1', performance: { successRate: 0.8 } })
    );
    registry.register(
      makeCapability({ agentId: 'agent-2', performance: { successRate: 0.95 } })
    );

    const results = registry.discover({ minSuccessRate: 0.9 });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-2');
  });

  it('should discover capabilities by maxLatencyMs', () => {
    registry.register(
      makeCapability({ agentId: 'agent-1', performance: { avgLatencyMs: 500 } })
    );
    registry.register(
      makeCapability({ agentId: 'agent-2', performance: { avgLatencyMs: 100 } })
    );

    const results = registry.discover({ maxLatencyMs: 200 });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-2');
  });

  it('should discover capabilities by maxCostPerCall', () => {
    registry.register(
      makeCapability({ agentId: 'agent-1', performance: { costPerCall: 5.0 } })
    );
    registry.register(
      makeCapability({ agentId: 'agent-2', performance: { costPerCall: 1.0 } })
    );

    const results = registry.discover({ maxCostPerCall: 2.0 });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-2');
  });

  it('should sort discovery results by success rate descending, then latency ascending', () => {
    registry.register(
      makeCapability({
        agentId: 'agent-slow',
        performance: { successRate: 0.9, avgLatencyMs: 500 },
      })
    );
    registry.register(
      makeCapability({
        agentId: 'agent-fast',
        performance: { successRate: 0.9, avgLatencyMs: 100 },
      })
    );
    registry.register(
      makeCapability({
        agentId: 'agent-best',
        performance: { successRate: 0.99, avgLatencyMs: 200 },
      })
    );

    const results = registry.discover({});
    expect(results[0].agentId).toBe('agent-best');
    expect(results[1].agentId).toBe('agent-fast');
    expect(results[2].agentId).toBe('agent-slow');
  });

  it('should return all capabilities when query is empty', () => {
    registry.register(makeCapability({ agentId: 'agent-1' }));
    registry.register(makeCapability({ agentId: 'agent-2' }));
    registry.register(makeCapability({ agentId: 'agent-3' }));

    const results = registry.discover({});
    expect(results).toHaveLength(3);
  });

  it('should combine multiple query filters', () => {
    registry.register(
      makeCapability({
        agentId: 'agent-1',
        contractIds: ['contract-x'],
        performance: { successRate: 0.95, avgLatencyMs: 100 },
      })
    );
    registry.register(
      makeCapability({
        agentId: 'agent-2',
        contractIds: ['contract-x'],
        performance: { successRate: 0.7, avgLatencyMs: 50 },
      })
    );

    const results = registry.discover({
      contractId: 'contract-x',
      minSuccessRate: 0.9,
    });
    expect(results).toHaveLength(1);
    expect(results[0].agentId).toBe('agent-1');
  });

  // --- findBestAgent ---

  it('should find the best agent for a contract', () => {
    registry.register(
      makeCapability({
        agentId: 'agent-1',
        contractIds: ['contract-x'],
        performance: { successRate: 0.85, avgLatencyMs: 200 },
      })
    );
    registry.register(
      makeCapability({
        agentId: 'agent-2',
        contractIds: ['contract-x'],
        performance: { successRate: 0.95, avgLatencyMs: 150 },
      })
    );

    const best = registry.findBestAgent('contract-x');
    expect(best).not.toBeNull();
    expect(best!.agentId).toBe('agent-2');
  });

  it('should return null when no agent matches the contract', () => {
    registry.register(makeCapability({ contractIds: ['contract-y'] }));
    expect(registry.findBestAgent('contract-z')).toBeNull();
  });

  it('should only consider available agents for findBestAgent', () => {
    const cap = registry.register(
      makeCapability({
        agentId: 'agent-1',
        contractIds: ['contract-x'],
        performance: { successRate: 0.99 },
      })
    );
    registry.updateStatus(cap.id, 'offline');

    registry.register(
      makeCapability({
        agentId: 'agent-2',
        contractIds: ['contract-x'],
        performance: { successRate: 0.80 },
      })
    );

    const best = registry.findBestAgent('contract-x');
    expect(best!.agentId).toBe('agent-2');
  });

  // --- TTL / Prune ---

  it('should prune expired capabilities', () => {
    // Register with a very short TTL
    registry.register(makeCapability({ agentId: 'agent-1', ttlMs: 1 }));
    registry.register(makeCapability({ agentId: 'agent-2', ttlMs: 600_000 }));

    // Small delay to ensure expiration
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait
    }

    const pruned = registry.pruneExpired();
    expect(pruned).toBe(1);
    const remaining = registry.discover({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agentId).toBe('agent-2');
  });

  it('should not prune capabilities that received a recent heartbeat', () => {
    const cap = registry.register(makeCapability({ ttlMs: 600_000 }));
    registry.heartbeat(cap.id);
    const pruned = registry.pruneExpired();
    expect(pruned).toBe(0);
  });

  it('should return 0 when nothing to prune', () => {
    registry.register(makeCapability({ ttlMs: 600_000 }));
    expect(registry.pruneExpired()).toBe(0);
  });

  // --- getAgentCapabilities ---

  it('should return capabilities for a specific agent', () => {
    registry.register(makeCapability({ agentId: 'agent-1', contractIds: ['a'] }));
    registry.register(makeCapability({ agentId: 'agent-1', contractIds: ['b'] }));
    registry.register(makeCapability({ agentId: 'agent-2', contractIds: ['c'] }));

    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps).toHaveLength(2);
    expect(caps.every((c) => c.agentId === 'agent-1')).toBe(true);
  });

  it('should return empty array for unknown agent', () => {
    expect(registry.getAgentCapabilities('unknown')).toEqual([]);
  });

  // --- Edge cases ---

  it('should handle capability with multiple contract IDs', () => {
    registry.register(
      makeCapability({ contractIds: ['contract-a', 'contract-b', 'contract-c'] })
    );

    expect(registry.discover({ contractId: 'contract-a' })).toHaveLength(1);
    expect(registry.discover({ contractId: 'contract-b' })).toHaveLength(1);
    expect(registry.discover({ contractId: 'contract-c' })).toHaveLength(1);
    expect(registry.discover({ contractId: 'contract-d' })).toHaveLength(0);
  });

  it('should handle capability with no performance data', () => {
    const cap = registry.register(makeCapability());
    const caps = registry.getAgentCapabilities('agent-1');
    expect(caps[0].performance).toBeUndefined();
  });
});
