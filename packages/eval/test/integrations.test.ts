import { describe, it, expect } from 'vitest';
import { TraceEvent } from '@molt/mesh';
import { TrustTier } from '@molt/mesh';
import { meshEventsToEvalTrace } from '../src/integrations/molt-mesh.js';
import { recommendTrustTier, mapMeshTierToPermitTier, mapPermitTierToMeshTier } from '../src/integrations/molt-permit.js';
import { MoltDoorEvalClient } from '../src/integrations/molt-door.js';
import { makeEvalRun } from './helpers.js';

describe('meshEventsToEvalTrace', () => {
  function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
    return {
      traceId: 'trace-1',
      spanId: 'span-1',
      eventType: 'dispatch',
      timestamp: '2024-01-01T00:00:01.000Z',
      durationMs: 100,
      data: { agentId: 'agent-1', contractId: 'contract-1' },
      ...overrides,
    };
  }

  it('converts mesh events to EvalTrace', () => {
    const events: TraceEvent[] = [
      makeEvent({ eventType: 'ingress', timestamp: '2024-01-01T00:00:01.000Z', durationMs: 10 }),
      makeEvent({ eventType: 'dispatch', timestamp: '2024-01-01T00:00:01.010Z', durationMs: 50, data: { agentId: 'agent-1', contractId: 'do-thing', input: { x: 1 }, output: 'done' } }),
      makeEvent({ eventType: 'response', timestamp: '2024-01-01T00:00:01.060Z', durationMs: 5 }),
    ];
    const trace = meshEventsToEvalTrace(events, 'Test task');
    expect(trace.traceId).toBe('trace-1');
    expect(trace.agentId).toBe('agent-1');
    expect(trace.taskDescription).toBe('Test task');
    expect(trace.actualToolCalls).toHaveLength(1);
    expect(trace.success).toBe(true);
  });

  it('aggregates token usage (input/output fields)', () => {
    const events: TraceEvent[] = [
      makeEvent({ data: { agentId: 'a', tokenUsage: { input: 100, output: 50 } } }),
      makeEvent({ spanId: 'span-2', data: { agentId: 'a', tokenUsage: { input: 200, output: 100 } } }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.tokenUsage.inputTokens).toBe(300);
    expect(trace.tokenUsage.outputTokens).toBe(150);
  });

  it('detects errors in events', () => {
    const events: TraceEvent[] = [
      makeEvent({ eventType: 'error', data: { agentId: 'a', error: 'something broke' } }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.success).toBe(false);
  });

  it('extracts policy decisions from PolicyDecision objects', () => {
    const events: TraceEvent[] = [
      makeEvent({
        eventType: 'policy',
        data: {
          agentId: 'a',
          contractId: 'action-1',
          policyDecision: { allowed: true, ruleId: 'r1', reason: 'ok', conditions: [], timestamp: '2024-01-01T00:00:00Z' },
        },
      }),
      makeEvent({
        spanId: 's2',
        eventType: 'policy',
        data: {
          agentId: 'a',
          contractId: 'action-2',
          policyDecision: { allowed: false, ruleId: 'r2', reason: 'blocked', conditions: ['tier'], timestamp: '2024-01-01T00:00:00Z' },
        },
      }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.policyDecisions).toHaveLength(2);
    expect(trace.policyDecisions[0].decision).toBe('allow');
    expect(trace.policyDecisions[1].decision).toBe('deny');
  });

  it('throws on empty events', () => {
    expect(() => meshEventsToEvalTrace([])).toThrow('Cannot convert empty events');
  });

  it('computes correct time span from ISO timestamps', () => {
    const events: TraceEvent[] = [
      makeEvent({ timestamp: '2024-01-01T00:00:01.000Z', durationMs: 10 }),
      makeEvent({ spanId: 's2', timestamp: '2024-01-01T00:00:02.000Z', durationMs: 50 }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.startTime).toBe(new Date('2024-01-01T00:00:01.000Z').getTime());
    expect(trace.endTime).toBe(new Date('2024-01-01T00:00:02.000Z').getTime() + 50);
  });

  it('handles optional durationMs (defaults to 0)', () => {
    const events: TraceEvent[] = [
      makeEvent({ durationMs: undefined }),
    ];
    const trace = meshEventsToEvalTrace(events);
    expect(trace.endTime).toBe(trace.startTime);
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

  it('accepts Mesh trust tiers and maps them to Permit tiers', () => {
    const run = makeEvalRun({
      verdict: 'pass',
      aggregateScores: { 'safety-violation': 1, 'policy-adherence': 0.98, 'task-completion': 0.95 },
    });
    const rec = recommendTrustTier('agent-1', TrustTier.EXTERNAL_PARTNER, run);
    // EXTERNAL_PARTNER maps to moltcaptcha, should promote to blockchain
    expect(rec.currentTier).toBe('moltcaptcha');
    expect(rec.recommendedTier).toBe('blockchain');
  });
});

describe('mapMeshTierToPermitTier', () => {
  it('maps internal_trusted to reputation', () => {
    expect(mapMeshTierToPermitTier(TrustTier.INTERNAL_TRUSTED)).toBe('reputation');
  });

  it('maps internal_restricted to blockchain', () => {
    expect(mapMeshTierToPermitTier(TrustTier.INTERNAL_RESTRICTED)).toBe('blockchain');
  });

  it('maps external_partner to moltcaptcha', () => {
    expect(mapMeshTierToPermitTier(TrustTier.EXTERNAL_PARTNER)).toBe('moltcaptcha');
  });

  it('maps public_vendor to unverified', () => {
    expect(mapMeshTierToPermitTier(TrustTier.PUBLIC_VENDOR)).toBe('unverified');
  });
});

describe('mapPermitTierToMeshTier', () => {
  it('maps reputation to internal_trusted', () => {
    expect(mapPermitTierToMeshTier('reputation')).toBe(TrustTier.INTERNAL_TRUSTED);
  });

  it('maps blockchain to internal_restricted', () => {
    expect(mapPermitTierToMeshTier('blockchain')).toBe(TrustTier.INTERNAL_RESTRICTED);
  });

  it('maps moltcaptcha to external_partner', () => {
    expect(mapPermitTierToMeshTier('moltcaptcha')).toBe(TrustTier.EXTERNAL_PARTNER);
  });

  it('maps unverified to public_vendor', () => {
    expect(mapPermitTierToMeshTier('unverified')).toBe(TrustTier.PUBLIC_VENDOR);
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

  it('dryRunPostRating returns rating and URL without sending', () => {
    const client = new MoltDoorEvalClient({ baseUrl: 'http://localhost:3000' });
    const run = makeEvalRun({ aggregateScores: { a: 0.9 } });
    const result = client.dryRunPostRating('agent-1', run);
    expect(result.url).toBe('http://localhost:3000/api/agents/agent-1/ratings');
    expect(result.rating.agentId).toBe('agent-1');
    expect(result.rating.overallScore).toBe(0.9);
  });
});
