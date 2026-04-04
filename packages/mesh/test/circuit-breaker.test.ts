import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreakerRegistry, CircuitState } from '../src/router/circuit-breaker.js';
import { CircuitOpenError } from '../src/errors.js';

describe('CircuitBreakerRegistry', () => {
  let cb: CircuitBreakerRegistry;

  beforeEach(() => {
    cb = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 100,
      failureWindowMs: 5000,
    });
  });

  it('should start in closed state for unknown agents', () => {
    expect(cb.getState('agent-1')).toBe(CircuitState.CLOSED);
  });

  it('should remain closed after fewer failures than threshold', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.CLOSED);
  });

  it('should open after reaching failure threshold', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.OPEN);
  });

  it('should throw CircuitOpenError when checking an open circuit', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    expect(() => cb.checkCircuit('agent-1')).toThrow(CircuitOpenError);
  });

  it('should not throw when circuit is closed', () => {
    expect(() => cb.checkCircuit('agent-1')).not.toThrow();
  });

  it('should transition to half-open after cooldown', async () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 150));
    expect(cb.getState('agent-1')).toBe(CircuitState.HALF_OPEN);
  });

  it('should close after successful test request in half-open state', async () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');

    await new Promise((r) => setTimeout(r, 150));
    expect(cb.getState('agent-1')).toBe(CircuitState.HALF_OPEN);

    cb.recordSuccess('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.CLOSED);
  });

  it('should re-open after failure in half-open state', async () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');

    await new Promise((r) => setTimeout(r, 150));
    expect(cb.getState('agent-1')).toBe(CircuitState.HALF_OPEN);

    cb.recordFailure('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.OPEN);
  });

  it('should reset failure count on success in closed state', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordSuccess('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    // Only 2 failures since reset, not 3
    expect(cb.getState('agent-1')).toBe(CircuitState.CLOSED);
  });

  it('should track independent circuits per agent', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.OPEN);
    expect(cb.getState('agent-2')).toBe(CircuitState.CLOSED);
  });

  it('should return all circuit states', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-2');
    const states = cb.getAllStates();
    expect(states['agent-1']).toBe(CircuitState.OPEN);
    expect(states['agent-2']).toBe(CircuitState.CLOSED);
  });

  it('should reset a specific agent circuit', () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.reset('agent-1');
    expect(cb.getState('agent-1')).toBe(CircuitState.CLOSED);
  });

  it('should allow test request through in half-open state', async () => {
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');
    cb.recordFailure('agent-1');

    await new Promise((r) => setTimeout(r, 150));
    // In half-open, checkCircuit should NOT throw
    expect(() => cb.checkCircuit('agent-1')).not.toThrow();
  });
});
