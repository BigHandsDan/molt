import { v4 as uuidv4 } from 'uuid';
import { TraceEvent, TraceEventType, TraceFilter } from './types.js';
import { TraceStore } from './store.js';

/** High-level tracing API that creates spans and delegates storage to a TraceStore. */
export class Tracer {
  private store: TraceStore;

  constructor(store: TraceStore) {
    this.store = store;
  }

  /** Generate a new UUID-based trace ID. */
  createTraceId(): string {
    return uuidv4();
  }

  /** Generate a new UUID-based span ID. */
  createSpanId(): string {
    return uuidv4();
  }

  /** Record a pre-built trace event. */
  record(event: TraceEvent): void {
    this.store.record(event);
  }

  /** Create and record a trace span, returning the event for parent-child linking. */
  span(
    traceId: string,
    eventType: TraceEventType,
    data: TraceEvent['data'],
    parentSpanId?: string
  ): TraceEvent {
    const event: TraceEvent = {
      traceId,
      spanId: this.createSpanId(),
      parentSpanId,
      eventType,
      timestamp: new Date().toISOString(),
      data,
    };
    this.store.record(event);
    return event;
  }

  /** Create and record a trace span with an explicit duration. */
  spanWithDuration(
    traceId: string,
    eventType: TraceEventType,
    data: TraceEvent['data'],
    durationMs: number,
    parentSpanId?: string
  ): TraceEvent {
    const event: TraceEvent = {
      traceId,
      spanId: this.createSpanId(),
      parentSpanId,
      eventType,
      timestamp: new Date().toISOString(),
      durationMs,
      data,
    };
    this.store.record(event);
    return event;
  }

  /** Retrieve all events for a trace. */
  getTrace(traceId: string): TraceEvent[] {
    return this.store.getTrace(traceId);
  }

  /** Query trace events using a filter. */
  getTraces(filter: TraceFilter): TraceEvent[] {
    return this.store.query(filter);
  }

  /** Get summaries of recent traces. */
  getRecentTraces(limit?: number) {
    return this.store.getRecentTraces(limit);
  }
}
