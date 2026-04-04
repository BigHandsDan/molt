import { describe, it, expect, beforeEach } from 'vitest';
import {
  SelfHealer,
  HealingPolicy,
  HealingFailure,
  HealingDispatchFn,
  HealingReport,
} from '../src/healing/index.js';

/** Helper: create a standard failure object. */
function makeFailure(overrides?: Partial<HealingFailure>): HealingFailure {
  return {
    traceId: 'trace-1',
    contractId: 'summarize',
    agentId: 'agent-a',
    failureType: 'timeout',
    error: 'timed out',
    envelope: { input: { text: 'hello world' } },
    ...overrides,
  };
}

/** Helper: create a dispatch function that succeeds. */
function successDispatch(): HealingDispatchFn {
  return async () => ({ success: true, result: { output: 'ok' } });
}

/** Helper: create a dispatch function that fails. */
function failDispatch(error = 'dispatch failed'): HealingDispatchFn {
  return async () => ({ success: false, error });
}

/** Helper: create a dispatch function that fails N times then succeeds. */
function failThenSucceed(failCount: number): HealingDispatchFn {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failCount) return { success: false, error: `fail #${calls}` };
    return { success: true, result: { output: 'recovered' } };
  };
}

/** Helper: create a dispatch that records which agents were called. */
function trackingDispatch(calls: string[], succeedOn?: string): HealingDispatchFn {
  return async (agentId: string) => {
    calls.push(agentId);
    if (succeedOn && agentId === succeedOn) return { success: true, result: {} };
    return { success: false, error: `${agentId} failed` };
  };
}

describe('SelfHealer', () => {
  let healer: SelfHealer;

  beforeEach(() => {
    healer = new SelfHealer();
  });

  // ── Policy Management ──────────────────────────────────────────────

  describe('policy management', () => {
    it('should register and retrieve policies', () => {
      const policy: HealingPolicy = {
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'backup' }],
        maxAttempts: 3,
      };
      healer.registerPolicy(policy);
      expect(healer.getPolicies()).toHaveLength(1);
      expect(healer.getPolicies()[0].id).toBe('p1');
    });

    it('should remove a policy by ID', () => {
      healer.registerPolicy({ id: 'p1', failureTypes: ['timeout'], strategies: [], maxAttempts: 1 });
      expect(healer.removePolicy('p1')).toBe(true);
      expect(healer.getPolicies()).toHaveLength(0);
    });

    it('should return false when removing a non-existent policy', () => {
      expect(healer.removePolicy('nope')).toBe(false);
    });

    it('should overwrite a policy with the same ID', () => {
      healer.registerPolicy({ id: 'p1', failureTypes: ['timeout'], strategies: [], maxAttempts: 1 });
      healer.registerPolicy({ id: 'p1', failureTypes: ['error'], strategies: [], maxAttempts: 5 });
      expect(healer.getPolicies()).toHaveLength(1);
      expect(healer.getPolicies()[0].failureTypes).toEqual(['error']);
    });
  });

  // ── Policy Matching ────────────────────────────────────────────────

  describe('policy matching', () => {
    it('should match by failure type', () => {
      healer.registerPolicy({ id: 'p1', failureTypes: ['timeout'], strategies: [], maxAttempts: 1 });
      expect(healer.matchPolicy('any', 'any', 'timeout')).not.toBeNull();
      expect(healer.matchPolicy('any', 'any', 'error')).toBeNull();
    });

    it('should match by exact contract pattern', () => {
      healer.registerPolicy({
        id: 'p1',
        contractPattern: 'summarize',
        failureTypes: ['timeout'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('summarize', 'agent-a', 'timeout')).not.toBeNull();
      expect(healer.matchPolicy('translate', 'agent-a', 'timeout')).toBeNull();
    });

    it('should match by wildcard contract pattern (prefix)', () => {
      healer.registerPolicy({
        id: 'p1',
        contractPattern: 'summ*',
        failureTypes: ['timeout'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('summarize', 'a', 'timeout')).not.toBeNull();
      expect(healer.matchPolicy('translate', 'a', 'timeout')).toBeNull();
    });

    it('should match by wildcard contract pattern (suffix)', () => {
      healer.registerPolicy({
        id: 'p1',
        contractPattern: '*ize',
        failureTypes: ['timeout'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('summarize', 'a', 'timeout')).not.toBeNull();
      expect(healer.matchPolicy('translate', 'a', 'timeout')).toBeNull();
    });

    it('should match by wildcard contract pattern (contains)', () => {
      healer.registerPolicy({
        id: 'p1',
        contractPattern: '*mmar*',
        failureTypes: ['timeout'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('summarize', 'a', 'timeout')).not.toBeNull();
    });

    it('should match by agent pattern', () => {
      healer.registerPolicy({
        id: 'p1',
        agentPattern: 'agent-*',
        failureTypes: ['error'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('c', 'agent-a', 'error')).not.toBeNull();
      expect(healer.matchPolicy('c', 'other-b', 'error')).toBeNull();
    });

    it('should match by universal wildcard pattern', () => {
      healer.registerPolicy({
        id: 'p1',
        contractPattern: '*',
        agentPattern: '*',
        failureTypes: ['timeout', 'error'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('anything', 'any-agent', 'timeout')).not.toBeNull();
    });

    it('should return null when no policy matches', () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [],
        maxAttempts: 1,
      });
      expect(healer.matchPolicy('c', 'a', 'timeout')).toBeNull();
    });
  });

  // ── Retry-Alternate Strategy ───────────────────────────────────────

  describe('retry-alternate strategy', () => {
    it('should dispatch to alternate agent on failure', async () => {
      const calls: string[] = [];
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'backup-agent' }],
        maxAttempts: 3,
      });

      const report = await healer.heal(makeFailure(), trackingDispatch(calls, 'backup-agent'));
      expect(report.finalOutcome).toBe('healed');
      expect(calls).toContain('backup-agent');
      expect(report.healedBy?.agentId).toBe('backup-agent');
      expect(report.healedBy?.strategy).toBe('retry-alternate');
    });

    it('should report exhausted when alternate also fails', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'backup' }],
        maxAttempts: 1,
      });

      const report = await healer.heal(makeFailure(), failDispatch());
      expect(report.finalOutcome).toBe('exhausted');
      expect(report.attempts).toHaveLength(1);
    });
  });

  // ── Fallback-Chain Strategy ────────────────────────────────────────

  describe('fallback-chain strategy', () => {
    it('should try agents in order until one succeeds', async () => {
      const calls: string[] = [];
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [{ strategy: 'fallback-chain', fallbackChain: ['fb1', 'fb2', 'fb3'] }],
        maxAttempts: 5,
      });

      const report = await healer.heal(
        makeFailure({ failureType: 'error' }),
        trackingDispatch(calls, 'fb2'),
      );

      expect(report.finalOutcome).toBe('healed');
      expect(calls).toEqual(['fb1', 'fb2']);
      expect(report.healedBy?.agentId).toBe('fb2');
    });

    it('should exhaust when all fallbacks fail', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [{ strategy: 'fallback-chain', fallbackChain: ['fb1', 'fb2'] }],
        maxAttempts: 5,
      });

      const report = await healer.heal(makeFailure({ failureType: 'error' }), failDispatch());
      expect(report.finalOutcome).toBe('exhausted');
      expect(report.attempts).toHaveLength(2);
    });

    it('should stop at maxAttempts even with remaining fallbacks', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [{ strategy: 'fallback-chain', fallbackChain: ['fb1', 'fb2', 'fb3', 'fb4'] }],
        maxAttempts: 2,
      });

      const report = await healer.heal(makeFailure({ failureType: 'error' }), failDispatch());
      expect(report.attempts).toHaveLength(2);
      expect(report.finalOutcome).toBe('exhausted');
    });
  });

  // ── Simplify Strategy ──────────────────────────────────────────────

  describe('simplify strategy', () => {
    it('should simplify and re-dispatch to original agent', async () => {
      const calls: string[] = [];
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{
          strategy: 'simplify',
          simplifyRules: { reduceScope: true },
        }],
        maxAttempts: 3,
      });

      const report = await healer.heal(
        makeFailure({ envelope: { input: { text: 'data', limit: 100 } } }),
        trackingDispatch(calls, 'agent-a'),
      );

      expect(report.finalOutcome).toBe('healed');
      expect(calls).toContain('agent-a');
    });

    it('should drop optional fields when configured', async () => {
      let receivedEnvelope: unknown = null;
      const dispatch: HealingDispatchFn = async (_agentId, envelope) => {
        receivedEnvelope = envelope;
        return { success: true };
      };

      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'simplify', simplifyRules: { dropOptionalFields: true } }],
        maxAttempts: 1,
      });

      await healer.heal(
        makeFailure({
          envelope: { input: { text: 'required', optionalMeta: 'drop me', extraInfo: 'drop too' } },
        }),
        dispatch,
      );

      const env = receivedEnvelope as Record<string, unknown>;
      const input = env.input as Record<string, unknown>;
      expect(input.text).toBe('required');
      expect(input.optionalMeta).toBeUndefined();
      expect(input.extraInfo).toBeUndefined();
    });

    it('should lower quality when configured', async () => {
      let receivedEnvelope: unknown = null;
      const dispatch: HealingDispatchFn = async (_agentId, envelope) => {
        receivedEnvelope = envelope;
        return { success: true };
      };

      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'simplify', simplifyRules: { lowerQuality: true } }],
        maxAttempts: 1,
      });

      await healer.heal(
        makeFailure({ envelope: { input: { text: 'data', quality: 'high' } } }),
        dispatch,
      );

      const env = receivedEnvelope as Record<string, unknown>;
      const input = env.input as Record<string, unknown>;
      expect(input.quality).toBe('low');
    });
  });

  // ── Decompose Strategy ─────────────────────────────────────────────

  describe('decompose strategy', () => {
    it('should split task into subtasks and dispatch each', async () => {
      const calls: string[] = [];
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{
          strategy: 'decompose',
          decomposer: (envelope) => {
            const env = envelope as Record<string, unknown>;
            return [
              { ...env, part: 1 },
              { ...env, part: 2 },
            ];
          },
        }],
        maxAttempts: 5,
      });

      const report = await healer.heal(makeFailure(), trackingDispatch(calls, 'agent-a'));
      expect(report.finalOutcome).toBe('healed');
      expect(report.attempts.length).toBeGreaterThanOrEqual(2);
    });

    it('should fail when no decomposer is provided', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'decompose' }],
        maxAttempts: 3,
      });

      const report = await healer.heal(makeFailure(), successDispatch());
      expect(report.attempts[0].success).toBe(false);
      expect(report.attempts[0].error).toContain('No decomposer');
    });

    it('should stop decompose if a subtask fails', async () => {
      let callCount = 0;
      const dispatch: HealingDispatchFn = async () => {
        callCount++;
        if (callCount === 1) return { success: true };
        return { success: false, error: 'subtask failed' };
      };

      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [{
          strategy: 'decompose',
          decomposer: () => [{ part: 1 }, { part: 2 }, { part: 3 }],
        }],
        maxAttempts: 5,
      });

      const report = await healer.heal(makeFailure({ failureType: 'error' }), dispatch);
      // First subtask succeeds, second fails => 2 attempts from decompose, overall exhausted
      expect(report.attempts.length).toBe(2);
    });
  });

  // ── Escalate Strategy ──────────────────────────────────────────────

  describe('escalate strategy', () => {
    it('should escalate and return immediately', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['policy-deny'],
        strategies: [{ strategy: 'escalate', escalateTarget: 'human-review' }],
        maxAttempts: 3,
      });

      const report = await healer.heal(
        makeFailure({ failureType: 'policy-deny' }),
        successDispatch(),
      );

      expect(report.finalOutcome).toBe('escalated');
      expect(report.attempts).toHaveLength(1);
      expect(report.attempts[0].strategy).toBe('escalate');
      expect(report.attempts[0].agentId).toBe('human-review');
    });

    it('should use default escalation target when none specified', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['policy-deny'],
        strategies: [{ strategy: 'escalate' }],
        maxAttempts: 3,
      });

      const report = await healer.heal(
        makeFailure({ failureType: 'policy-deny' }),
        successDispatch(),
      );
      expect(report.finalOutcome).toBe('escalated');
      expect(report.attempts[0].agentId).toBe('escalation-target');
    });
  });

  // ── Multi-Strategy Chains ──────────────────────────────────────────

  describe('multi-strategy chains', () => {
    it('should try strategies in order until one succeeds', async () => {
      const calls: string[] = [];
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [
          { strategy: 'retry-alternate', alternateAgentId: 'alt-1' },
          { strategy: 'fallback-chain', fallbackChain: ['fb-1', 'fb-2'] },
        ],
        maxAttempts: 5,
      });

      // alt-1 fails, fb-1 fails, fb-2 succeeds
      const dispatch: HealingDispatchFn = async (agentId) => {
        calls.push(agentId);
        if (agentId === 'fb-2') return { success: true, result: {} };
        return { success: false, error: 'fail' };
      };

      const report = await healer.heal(makeFailure(), dispatch);
      expect(report.finalOutcome).toBe('healed');
      expect(calls).toEqual(['alt-1', 'fb-1', 'fb-2']);
      expect(report.healedBy?.strategy).toBe('fallback-chain');
    });

    it('should exhaust all strategies and report exhausted', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [
          { strategy: 'retry-alternate', alternateAgentId: 'alt' },
          { strategy: 'simplify', simplifyRules: { reduceScope: true } },
        ],
        maxAttempts: 5,
      });

      const report = await healer.heal(makeFailure({ failureType: 'error' }), failDispatch());
      expect(report.finalOutcome).toBe('exhausted');
      expect(report.attempts).toHaveLength(2);
    });
  });

  // ── Max Attempts ───────────────────────────────────────────────────

  describe('max attempts enforcement', () => {
    it('should stop after maxAttempts even with remaining strategies', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [
          { strategy: 'retry-alternate', alternateAgentId: 'a1' },
          { strategy: 'retry-alternate', alternateAgentId: 'a2' },
          { strategy: 'retry-alternate', alternateAgentId: 'a3' },
        ],
        maxAttempts: 2,
      });

      const report = await healer.heal(makeFailure(), failDispatch());
      expect(report.attempts).toHaveLength(2);
      expect(report.finalOutcome).toBe('exhausted');
    });
  });

  // ── No Matching Policy ─────────────────────────────────────────────

  describe('no matching policy', () => {
    it('should return exhausted immediately when no policy matches', async () => {
      const report = await healer.heal(makeFailure(), successDispatch());
      expect(report.finalOutcome).toBe('exhausted');
      expect(report.attempts).toHaveLength(0);
    });
  });

  // ── Reports and Statistics ─────────────────────────────────────────

  describe('reports and statistics', () => {
    it('should store and retrieve a healing report by trace ID', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      await healer.heal(makeFailure({ traceId: 'trace-abc' }), successDispatch());
      const report = healer.getReport('trace-abc');
      expect(report).not.toBeNull();
      expect(report!.originalTraceId).toBe('trace-abc');
    });

    it('should return null for unknown trace ID', () => {
      expect(healer.getReport('unknown')).toBeNull();
    });

    it('should track healing statistics correctly', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout', 'error'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      // One healed
      await healer.heal(makeFailure({ traceId: 't1' }), successDispatch());
      // One exhausted
      await healer.heal(makeFailure({ traceId: 't2' }), failDispatch());

      // One escalated
      healer.registerPolicy({
        id: 'p2',
        failureTypes: ['policy-deny'],
        strategies: [{ strategy: 'escalate', escalateTarget: 'human' }],
        maxAttempts: 3,
      });
      await healer.heal(makeFailure({ traceId: 't3', failureType: 'policy-deny' }), successDispatch());

      const stats = healer.getStats();
      expect(stats.healedCount).toBe(1);
      expect(stats.exhaustedCount).toBe(1);
      expect(stats.escalatedCount).toBe(1);
      expect(stats.totalAttempts).toBe(3);
      expect(stats.avgAttemptsToHeal).toBe(1);
    });

    it('should return zero avgAttemptsToHeal when nothing healed', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });
      await healer.heal(makeFailure(), failDispatch());

      const stats = healer.getStats();
      expect(stats.avgAttemptsToHeal).toBe(0);
    });

    it('should retrieve all reports', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      await healer.heal(makeFailure({ traceId: 'r1' }), successDispatch());
      await healer.heal(makeFailure({ traceId: 'r2' }), failDispatch());

      const reports = healer.getAllReports();
      expect(reports).toHaveLength(2);
    });
  });

  // ── Healing Report Structure ───────────────────────────────────────

  describe('healing report structure', () => {
    it('should include correct failure type in report', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['circuit-open'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      const report = await healer.heal(
        makeFailure({ failureType: 'circuit-open' }),
        successDispatch(),
      );
      expect(report.failureType).toBe('circuit-open');
    });

    it('should record attempt durations', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      const report = await healer.heal(makeFailure(), successDispatch());
      expect(report.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should record attempt IDs as unique UUIDs', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['error'],
        strategies: [
          { strategy: 'retry-alternate', alternateAgentId: 'a1' },
          { strategy: 'retry-alternate', alternateAgentId: 'a2' },
        ],
        maxAttempts: 5,
      });

      const report = await healer.heal(makeFailure({ failureType: 'error' }), failDispatch());
      const ids = report.attempts.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── Multiple Failure Types ─────────────────────────────────────────

  describe('multiple failure types', () => {
    it('should match policy with multiple failure types', async () => {
      healer.registerPolicy({
        id: 'p1',
        failureTypes: ['timeout', 'error', 'budget-exceeded'],
        strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'b' }],
        maxAttempts: 1,
      });

      const r1 = await healer.heal(makeFailure({ traceId: 't1', failureType: 'timeout' }), successDispatch());
      const r2 = await healer.heal(makeFailure({ traceId: 't2', failureType: 'error' }), successDispatch());
      const r3 = await healer.heal(makeFailure({ traceId: 't3', failureType: 'budget-exceeded' }), successDispatch());

      expect(r1.finalOutcome).toBe('healed');
      expect(r2.finalOutcome).toBe('healed');
      expect(r3.finalOutcome).toBe('healed');
    });
  });

  // ── Constructor with TraceStore ────────────────────────────────────

  describe('constructor', () => {
    it('should accept an optional TraceStore', () => {
      // Just ensure it doesn't throw
      const healer2 = new SelfHealer(undefined);
      expect(healer2).toBeInstanceOf(SelfHealer);
    });
  });
});
