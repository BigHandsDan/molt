import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TraceStore } from '../src/trace/store.js';
import { Tracer } from '../src/trace/tracer.js';
import { TraceEvent } from '../src/trace/types.js';

describe('TraceStore', () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore(); // in-memory
  });

  afterEach(() => {
    store.close();
  });

  function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
    return {
      traceId: 'trace-1',
      spanId: 'span-1',
      eventType: 'ingress',
      timestamp: new Date().toISOString(),
      data: { contractId: 'test' },
      ...overrides,
    };
  }

  it('should record and retrieve events', () => {
    store.record(makeEvent());
    const events = store.getTrace('trace-1');
    expect(events).toHaveLength(1);
    expect(events[0].traceId).toBe('trace-1');
  });

  it('should store all event fields', () => {
    store.record(
      makeEvent({
        parentSpanId: 'parent-1',
        durationMs: 42,
        data: {
          contractId: 'test',
          agentId: 'agent-1',
          error: 'something went wrong',
          tokenUsage: { input: 100, output: 50 },
        },
      })
    );
    const events = store.getTrace('trace-1');
    expect(events[0].parentSpanId).toBe('parent-1');
    expect(events[0].durationMs).toBe(42);
    expect(events[0].data.agentId).toBe('agent-1');
    expect(events[0].data.tokenUsage?.input).toBe(100);
  });

  it('should return empty array for unknown trace', () => {
    const events = store.getTrace('nonexistent');
    expect(events).toHaveLength(0);
  });

  it('should query by agent ID', () => {
    store.record(makeEvent({ data: { agentId: 'agent-1' } }));
    store.record(makeEvent({ spanId: 'span-2', data: { agentId: 'agent-2' } }));
    const events = store.query({ agentId: 'agent-1' });
    expect(events).toHaveLength(1);
  });

  it('should query by contract ID', () => {
    store.record(makeEvent({ data: { contractId: 'contract-a' } }));
    store.record(makeEvent({ spanId: 'span-2', data: { contractId: 'contract-b' } }));
    const events = store.query({ contractId: 'contract-a' });
    expect(events).toHaveLength(1);
  });

  it('should query by event type', () => {
    store.record(makeEvent({ eventType: 'ingress' }));
    store.record(makeEvent({ spanId: 'span-2', eventType: 'policy' }));
    store.record(makeEvent({ spanId: 'span-3', eventType: 'ingress' }));
    const events = store.query({ eventType: 'ingress' });
    expect(events).toHaveLength(2);
  });

  it('should respect query limit', () => {
    for (let i = 0; i < 10; i++) {
      store.record(makeEvent({ spanId: `span-${i}` }));
    }
    const events = store.query({ traceId: 'trace-1', limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('should get recent traces summary', () => {
    store.record(makeEvent({ traceId: 'trace-a', spanId: 'span-1' }));
    store.record(makeEvent({ traceId: 'trace-a', spanId: 'span-2' }));
    store.record(makeEvent({ traceId: 'trace-b', spanId: 'span-3' }));

    const recent = store.getRecentTraces(10);
    expect(recent).toHaveLength(2);
    const traceA = recent.find((t) => t.traceId === 'trace-a');
    expect(traceA!.eventCount).toBe(2);
  });
});

describe('Tracer', () => {
  let store: TraceStore;
  let tracer: Tracer;

  beforeEach(() => {
    store = new TraceStore();
    tracer = new Tracer(store);
  });

  afterEach(() => {
    store.close();
  });

  it('should create unique trace IDs', () => {
    const id1 = tracer.createTraceId();
    const id2 = tracer.createTraceId();
    expect(id1).not.toBe(id2);
  });

  it('should create unique span IDs', () => {
    const id1 = tracer.createSpanId();
    const id2 = tracer.createSpanId();
    expect(id1).not.toBe(id2);
  });

  it('should record a span and retrieve it', () => {
    tracer.span('trace-1', 'ingress', { contractId: 'test' });
    const events = tracer.getTrace('trace-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('ingress');
  });

  it('should record span with duration', () => {
    tracer.spanWithDuration('trace-1', 'dispatch', { agentId: 'agent-1' }, 150);
    const events = tracer.getTrace('trace-1');
    expect(events[0].durationMs).toBe(150);
  });

  it('should support parent spans', () => {
    const parent = tracer.span('trace-1', 'ingress', {});
    tracer.span('trace-1', 'validate', {}, parent.spanId);
    const events = tracer.getTrace('trace-1');
    expect(events[1].parentSpanId).toBe(parent.spanId);
  });

  it('should query with filters', () => {
    tracer.span('trace-1', 'ingress', { agentId: 'a' });
    tracer.span('trace-1', 'policy', { agentId: 'b' });
    const events = tracer.getTraces({ eventType: 'policy' });
    expect(events).toHaveLength(1);
  });
});
