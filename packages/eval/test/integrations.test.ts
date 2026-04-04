import { describe, it, expect } from 'vitest';
import { meshEventsToEvalTrace, MeshTraceEvent } from '../src/integrations/molt-mesh.js';
import { recommendTrustTier } from '../src/integrations/molt-permit.js';
import { MoltDoorEvalClient } from '../src/integrations/molt-door.js';
import { makeEvalRun } from './helpers.js';

describe('meshEventsToEvalTrace', () => {
  function makeEvent(overrides: Partial<MeshTraceEvent> = {}): MeshTraceEvent {
    return {
      traceId: 'trace-1',
      spanId: 'span-1',
      eventType: 'dispatch',
      timestamp: 1000,
      durationMs: 100,
      data: { agentId: 'agent-1', contractId: 'contract-1' },
      ...overrides,
    };
  }

  it('converts mesh events to EvalTrace', () => {
    const events: MeshTraceEvent[] = [
      makeEvent({ eventType: 'ingress', timestamp: 1000, durationMs: 10 }),
      makeEvent({ eventType: 'dispatch', timestamp: 1010, durationMs: 50, data: { agentId: 'agent-1', contractId: 'do-thing', input: { x: 1 }, output: 'done' } }),
      makeEvent({ eventType: 'response', timestamp: 1060, durationMs: 5 }),
    ];
    const trace = meshEventsToEvalTrace(events, 'Test task');
    expect(trace.traceId).toBe('trace-1');
    expect(trace.agentId).toBe('agent-1');
    expect(trace.taskDescription).toBe('Test task');
    expect(trace.actualToolCalls).toHaveLength(1);
    expect(trace.success).toBe(true);
  });

  it('aggregates token usage', () => {
    const events: MeshTraceEvent[] = [
      makeEvent({ data: { agentId: 'a', tokenUsage: { inputTokens: 100, outputTokens: 50 } } }),
      makeEvent({ spanId: 'span-2', data: { agentId: 'a', tokenUsage: { inputTokens: 200, outputTokens: 100 } } }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.tokenUsage.inputTokens).toBe(300);
    expect(trace.tokenUsage.outputTokens).toBe(150);
  });

  it('detects errors in events', () => {
    const events: MeshTraceEvent[] = [
      makeEvent({ eventType: 'error', data: { agentId: 'a', error: 'something broke' } }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.success).toBe(false);
  });

  it('extracts policy decisions', () => {
    const events: MeshTraceEvent[] = [
      makeEvent({ eventType: 'policy', data: { agentId: 'a', contractId: 'action-1', policyDecision: 'allow' } }),
      makeEvent({ spanId: 's2', eventType: 'policy', data: { agentId: 'a', contractId: 'action-2', policyDecision: 'deny' } }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.policyDecisions).toHaveLength(2);
    expect(trace.policyDecisions[0].decision).toBe('allow');
    expect(trace.policyDecisions[1].decision).toBe('deny');
  });

  it('throws on empty events', () => {
    expect(() => meshEventsToEvalTrace([])).toThrow('Cannot convert empty events');
  });

  it('computes correct time span', () => {
    const events: MeshTraceEvent[] = [
      makeEvent({ timestamp: 1000, durationMs: 10 }),
      makeEvent({ spanId: 's2', timestamp: 2000, durationMs: 50 }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.startTime).toBe(1000);
    expect(trace.endTime).toBe(2050);
  });
});

describe('recommendTrustTier', () => {
  it('recommends demotion on safety violations', () => {
    const run = makeEvalRun({ aggregateScores: { 'safety-violation': 0.5 } });
    const rec = recommendTrustTier('agent-1', 'moltcaptcha', run);
    expect(rec.recommendedTier).toBe('unverified');
    expect(rec.reason).toContain('Safety violations');
  });

  it('recommends demotion on low policy adherence', () => {
    const run = makeEvalRun({ aggregateScores: { 'safety-violation': 1, 'policy-adherence': 0.5 } });
    const rec = recommendTrustTier('agent-1', 'blockchain', run);
    expect(rec.recommendedTier).toBe('moltcaptcha');
  });

  it('recommends promotion for high performance', () => {
    const run = makeEvalRun({
      verdict: 'pass',
      aggregateScores: { 'safety-violation': 1, 'policy-adherence': 0.98, 'task-completion': 0.95 },
    });
    const rec = recommendTrustTier('agent-1', 'moltcaptcha', run);
    expect(rec.recommendedTier).toBe('blockchain');
  });

  it('recommends no change for average performance', () => {
    const run = makeEvalRun({
      verdict: 'pass',
      aggregateScores: { 'safety-violation': 1, 'policy-adherence': 0.9, 'task-completion': 0.8 },
    });
    const rec = recommendTrustTier('agent-1', 'moltcaptcha', run);
    expect(rec.recommendedTier).toBe('moltcaptcha');
  });

  it('does not demote below unverified', () => {
    const run = makeEvalRun({ aggregateScores: { 'safety-violation': 0 } });
    const rec = recommendTrustTier('agent-1', 'unverified', run);
    expect(rec.recommendedTier).toBe('unverified');
  });

  it('does not promote above reputation', () => {
    const run = makeEvalRun({
      verdict: 'pass',
      aggregateScores: { 'safety-violation': 1, 'policy-adherence': 0.99, 'task-completion': 0.99 },
    });
    const rec = recommendTrustTier('agent-1', 'reputation', run);
    expect(rec.recommendedTier).toBe('reputation');
  });
});

describe('MoltDoorEvalClient', () => {
  it('builds a rating from an eval run', () => {
    const client = new MoltDoorEvalClient({ baseUrl: 'http://localhost:3000' });
    const run = makeEvalRun({ aggregateScores: { a: 0.8, b: 0.6 } });
    const rating = client.buildRating('agent-1', run);
    expect(rating.agentId).toBe('agent-1');
    expect(rating.evalRunId).toBe(run.id);
    expect(rating.overallScore).toBeCloseTo(0.7);
    expect(rating.verdict).toBe('pass');
  });

  it('handles single-metric scores', () => {
    const client = new MoltDoorEvalClient({ baseUrl: 'http://localhost:3000' });
    const run = makeEvalRun({ aggregateScores: { x: 1.0 } });
    const rating = client.buildRating('agent-1', run);
    expect(rating.overallScore).toBe(1.0);
  });

  it('handles empty scores', () => {
    const client = new MoltDoorEvalClient({ baseUrl: 'http://localhost:3000' });
    const run = makeEvalRun({ aggregateScores: {} });
    const rating = client.buildRating('agent-1', run);
    expect(rating.overallScore).toBe(0);
  });
});
