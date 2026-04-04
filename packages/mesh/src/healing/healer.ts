import { randomUUID } from 'node:crypto';
import { TraceStore } from '../trace/store.js';
import {
  HealingPolicy,
  HealingStrategyConfig,
  HealingAttempt,
  HealingReport,
  HealingStats,
  HealingFailure,
  HealingDispatchFn,
  HealingStrategy,
} from './types.js';

/**
 * Self-healing engine that matches failures against policies and executes
 * recovery strategies (retry-alternate, fallback-chain, simplify, decompose, escalate).
 *
 * @example
 * ```ts
 * const healer = new SelfHealer();
 * healer.registerPolicy({ id: 'p1', failureTypes: ['timeout'], strategies: [{ strategy: 'retry-alternate', alternateAgentId: 'backup' }], maxAttempts: 3 });
 * const report = await healer.heal(failure, dispatch);
 * ```
 */
export class SelfHealer {
  private policies: Map<string, HealingPolicy> = new Map();
  private reports: Map<string, HealingReport> = new Map();
  private store?: TraceStore;

  constructor(store?: TraceStore) {
    this.store = store;
  }

  /** Register a healing policy. */
  registerPolicy(policy: HealingPolicy): void {
    this.policies.set(policy.id, policy);
  }

  /** Remove a policy by ID. Returns true if it existed. */
  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  /** Get all registered policies. */
  getPolicies(): HealingPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Attempt to heal a failed task dispatch by matching a policy and executing
   * its strategies in order until one succeeds or all are exhausted.
   */
  async heal(failure: HealingFailure, dispatch: HealingDispatchFn): Promise<HealingReport> {
    const startTime = Date.now();
    const policy = this.matchPolicy(failure.contractId, failure.agentId, failure.failureType);

    if (!policy) {
      const report: HealingReport = {
        originalTraceId: failure.traceId,
        failureType: failure.failureType,
        attempts: [],
        finalOutcome: 'exhausted',
        totalDurationMs: Date.now() - startTime,
      };
      this.reports.set(failure.traceId, report);
      return report;
    }

    const attempts: HealingAttempt[] = [];
    let totalAttemptCount = 0;

    for (const strategyConfig of policy.strategies) {
      if (totalAttemptCount >= policy.maxAttempts) break;

      // Escalate is a terminal strategy — it doesn't dispatch, just marks as escalated
      if (strategyConfig.strategy === 'escalate') {
        const attempt: HealingAttempt = {
          id: randomUUID(),
          originalTraceId: failure.traceId,
          strategy: 'escalate',
          attemptNumber: totalAttemptCount + 1,
          agentId: strategyConfig.escalateTarget || 'escalation-target',
          contractId: failure.contractId,
          success: false,
          durationMs: 0,
          timestamp: Date.now(),
        };
        attempts.push(attempt);
        totalAttemptCount++;

        const report: HealingReport = {
          originalTraceId: failure.traceId,
          failureType: failure.failureType,
          attempts,
          finalOutcome: 'escalated',
          totalDurationMs: Date.now() - startTime,
        };
        this.reports.set(failure.traceId, report);
        return report;
      }

      const strategyAttempts = await this.executeStrategy(
        strategyConfig,
        failure,
        dispatch,
        totalAttemptCount,
        policy.maxAttempts,
      );

      for (const attempt of strategyAttempts) {
        attempts.push(attempt);
        totalAttemptCount++;

        if (attempt.success) {
          const report: HealingReport = {
            originalTraceId: failure.traceId,
            failureType: failure.failureType,
            attempts,
            finalOutcome: 'healed',
            healedBy: { strategy: strategyConfig.strategy, agentId: attempt.agentId },
            totalDurationMs: Date.now() - startTime,
          };
          this.reports.set(failure.traceId, report);
          return report;
        }

        if (totalAttemptCount >= policy.maxAttempts) break;
      }
    }

    const report: HealingReport = {
      originalTraceId: failure.traceId,
      failureType: failure.failureType,
      attempts,
      finalOutcome: 'exhausted',
      totalDurationMs: Date.now() - startTime,
    };
    this.reports.set(failure.traceId, report);
    return report;
  }

  /** Match a failure against registered policies. Returns the first matching policy. */
  matchPolicy(contractId: string, agentId: string, failureType: string): HealingPolicy | null {
    for (const policy of this.policies.values()) {
      // Check failure type match
      if (!policy.failureTypes.includes(failureType as HealingPolicy['failureTypes'][number])) {
        continue;
      }

      // Check contract pattern
      if (policy.contractPattern && !this.matchesPattern(contractId, policy.contractPattern)) {
        continue;
      }

      // Check agent pattern
      if (policy.agentPattern && !this.matchesPattern(agentId, policy.agentPattern)) {
        continue;
      }

      return policy;
    }
    return null;
  }

  /** Get the healing report for a trace. */
  getReport(traceId: string): HealingReport | null {
    return this.reports.get(traceId) || null;
  }

  /** Get all healing reports. */
  getAllReports(): HealingReport[] {
    return Array.from(this.reports.values());
  }

  /** Get aggregated healing statistics. */
  getStats(): HealingStats {
    const reports = Array.from(this.reports.values());
    const healedReports = reports.filter((r) => r.finalOutcome === 'healed');
    const exhaustedCount = reports.filter((r) => r.finalOutcome === 'exhausted').length;
    const escalatedCount = reports.filter((r) => r.finalOutcome === 'escalated').length;

    const totalAttempts = reports.reduce((sum, r) => sum + r.attempts.length, 0);
    const avgAttemptsToHeal =
      healedReports.length > 0
        ? healedReports.reduce((sum, r) => sum + r.attempts.length, 0) / healedReports.length
        : 0;

    return {
      totalAttempts,
      healedCount: healedReports.length,
      exhaustedCount,
      escalatedCount,
      avgAttemptsToHeal,
    };
  }

  /** Execute a healing strategy, returning one or more attempts. */
  private async executeStrategy(
    config: HealingStrategyConfig,
    failure: HealingFailure,
    dispatch: HealingDispatchFn,
    currentAttemptCount: number,
    maxAttempts: number,
  ): Promise<HealingAttempt[]> {
    switch (config.strategy) {
      case 'retry-alternate':
        return this.executeRetryAlternate(config, failure, dispatch, currentAttemptCount);
      case 'fallback-chain':
        return this.executeFallbackChain(config, failure, dispatch, currentAttemptCount, maxAttempts);
      case 'simplify':
        return this.executeSimplify(config, failure, dispatch, currentAttemptCount);
      case 'decompose':
        return this.executeDecompose(config, failure, dispatch, currentAttemptCount, maxAttempts);
      default:
        return [];
    }
  }

  /** Retry with an alternate agent. */
  private async executeRetryAlternate(
    config: HealingStrategyConfig,
    failure: HealingFailure,
    dispatch: HealingDispatchFn,
    attemptOffset: number,
  ): Promise<HealingAttempt[]> {
    const agentId = config.alternateAgentId || failure.agentId;
    const start = Date.now();

    const result = await dispatch(agentId, failure.envelope);

    return [{
      id: randomUUID(),
      originalTraceId: failure.traceId,
      strategy: 'retry-alternate',
      attemptNumber: attemptOffset + 1,
      agentId,
      contractId: failure.contractId,
      success: result.success,
      durationMs: Date.now() - start,
      error: result.error,
      timestamp: start,
    }];
  }

  /** Try each agent in the fallback chain until one succeeds. */
  private async executeFallbackChain(
    config: HealingStrategyConfig,
    failure: HealingFailure,
    dispatch: HealingDispatchFn,
    attemptOffset: number,
    maxAttempts: number,
  ): Promise<HealingAttempt[]> {
    const chain = config.fallbackChain || [];
    const attempts: HealingAttempt[] = [];

    for (const agentId of chain) {
      if (attemptOffset + attempts.length >= maxAttempts) break;

      const start = Date.now();
      const result = await dispatch(agentId, failure.envelope);

      attempts.push({
        id: randomUUID(),
        originalTraceId: failure.traceId,
        strategy: 'fallback-chain',
        attemptNumber: attemptOffset + attempts.length,
        agentId,
        contractId: failure.contractId,
        success: result.success,
        durationMs: Date.now() - start,
        error: result.error,
        timestamp: start,
      });

      if (result.success) break;
    }

    return attempts;
  }

  /** Simplify the envelope and re-dispatch to the original agent. */
  private async executeSimplify(
    config: HealingStrategyConfig,
    failure: HealingFailure,
    dispatch: HealingDispatchFn,
    attemptOffset: number,
  ): Promise<HealingAttempt[]> {
    const rules = config.simplifyRules || {};
    let simplified = failure.envelope;

    if (typeof failure.envelope === 'object' && failure.envelope !== null) {
      const env = { ...(failure.envelope as Record<string, unknown>) };

      if (rules.dropOptionalFields && typeof env.input === 'object' && env.input !== null) {
        const input = { ...(env.input as Record<string, unknown>) };
        // Remove fields starting with 'optional' or marked optional
        for (const key of Object.keys(input)) {
          if (key.startsWith('optional') || key.startsWith('extra')) {
            delete input[key];
          }
        }
        env.input = input;
      }

      if (rules.reduceScope && typeof env.input === 'object' && env.input !== null) {
        const input = { ...(env.input as Record<string, unknown>) };
        if (typeof input.limit === 'number') {
          input.limit = Math.max(1, Math.floor(input.limit / 2));
        }
        if (typeof input.depth === 'number') {
          input.depth = Math.max(1, Math.floor(input.depth / 2));
        }
        env.input = input;
      }

      if (rules.lowerQuality && typeof env.input === 'object' && env.input !== null) {
        const input = { ...(env.input as Record<string, unknown>) };
        if (typeof input.quality === 'string') {
          input.quality = 'low';
        }
        env.input = input;
      }

      simplified = env;
    }

    const start = Date.now();
    const result = await dispatch(failure.agentId, simplified);

    return [{
      id: randomUUID(),
      originalTraceId: failure.traceId,
      strategy: 'simplify',
      attemptNumber: attemptOffset + 1,
      agentId: failure.agentId,
      contractId: failure.contractId,
      success: result.success,
      durationMs: Date.now() - start,
      error: result.error,
      timestamp: start,
    }];
  }

  /** Decompose the task into subtasks and dispatch each. Returns one attempt per subtask. */
  private async executeDecompose(
    config: HealingStrategyConfig,
    failure: HealingFailure,
    dispatch: HealingDispatchFn,
    attemptOffset: number,
    maxAttempts: number,
  ): Promise<HealingAttempt[]> {
    if (!config.decomposer) {
      return [{
        id: randomUUID(),
        originalTraceId: failure.traceId,
        strategy: 'decompose',
        attemptNumber: attemptOffset + 1,
        agentId: failure.agentId,
        contractId: failure.contractId,
        success: false,
        durationMs: 0,
        error: 'No decomposer function provided',
        timestamp: Date.now(),
      }];
    }

    const subtasks = config.decomposer(failure.envelope);
    const attempts: HealingAttempt[] = [];

    for (const subtask of subtasks) {
      if (attemptOffset + attempts.length >= maxAttempts) break;

      const start = Date.now();
      const result = await dispatch(failure.agentId, subtask);
      const isLast = attempts.length === subtasks.length - 1;

      attempts.push({
        id: randomUUID(),
        originalTraceId: failure.traceId,
        strategy: 'decompose',
        attemptNumber: attemptOffset + attempts.length,
        agentId: failure.agentId,
        contractId: failure.contractId,
        // Only mark the last subtask as the composite success — individual subtask failures are recorded as-is
        success: result.success && isLast,
        durationMs: Date.now() - start,
        error: result.error,
        timestamp: start,
      });

      if (!result.success) {
        break;
      }
    }

    return attempts;
  }

  /** Simple pattern matching: supports '*' as wildcard prefix/suffix, and exact match. */
  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      return value.includes(pattern.slice(1, -1));
    }
    if (pattern.startsWith('*')) {
      return value.endsWith(pattern.slice(1));
    }
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return value === pattern;
  }
}
