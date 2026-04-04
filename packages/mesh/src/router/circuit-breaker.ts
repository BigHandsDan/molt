import { CircuitOpenError } from '../errors.js';

/** State of a circuit breaker protecting an agent from cascading failures. */
export enum CircuitState {
  /** Normal operation — requests flow through. */
  CLOSED = 'closed',
  /** Tripped — requests are rejected immediately. */
  OPEN = 'open',
  /** Testing — one probe request is allowed through to check recovery. */
  HALF_OPEN = 'half_open',
}

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  openedAt: number;
}

/** Configuration for circuit breaker thresholds and timing. */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  failureWindowMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  failureWindowMs: 300_000, // 5 minutes
};

/** In-memory circuit breaker registry that tracks failure counts per agent and trips circuits when thresholds are exceeded. */
export class CircuitBreakerRegistry {
  private circuits = new Map<string, CircuitEntry>();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get the current circuit state for an agent, transitioning from OPEN to HALF_OPEN if the cooldown has elapsed. */
  getState(agentId: string): CircuitState {
    const entry = this.circuits.get(agentId);
    if (!entry) return CircuitState.CLOSED;

    if (entry.state === CircuitState.OPEN) {
      const elapsed = Date.now() - entry.openedAt;
      if (elapsed >= this.config.cooldownMs) {
        entry.state = CircuitState.HALF_OPEN;
        return CircuitState.HALF_OPEN;
      }
    }

    return entry.state;
  }

  /** Assert that a circuit is not OPEN. Throws CircuitOpenError if it is. */
  checkCircuit(agentId: string): void {
    const state = this.getState(agentId);
    if (state === CircuitState.OPEN) {
      throw new CircuitOpenError(agentId);
    }
    // HALF_OPEN allows one test request through
  }

  /** Record a successful dispatch, closing the circuit if it was in HALF_OPEN. */
  recordSuccess(agentId: string): void {
    const entry = this.circuits.get(agentId);
    if (!entry) return;

    if (entry.state === CircuitState.HALF_OPEN) {
      // Test request succeeded — close the circuit
      entry.state = CircuitState.CLOSED;
      entry.failureCount = 0;
    } else {
      entry.failureCount = 0;
    }
  }

  /** Record a failed dispatch, incrementing failure count and tripping the circuit if the threshold is reached. */
  recordFailure(agentId: string): void {
    let entry = this.circuits.get(agentId);
    if (!entry) {
      entry = {
        state: CircuitState.CLOSED,
        failureCount: 0,
        lastFailureTime: 0,
        openedAt: 0,
      };
      this.circuits.set(agentId, entry);
    }

    const now = Date.now();

    // If in HALF_OPEN state and the test request failed, re-open
    if (entry.state === CircuitState.HALF_OPEN) {
      entry.state = CircuitState.OPEN;
      entry.openedAt = now;
      entry.failureCount = this.config.failureThreshold;
      return;
    }

    // Reset count if last failure was outside the window
    if (now - entry.lastFailureTime > this.config.failureWindowMs) {
      entry.failureCount = 0;
    }

    entry.failureCount++;
    entry.lastFailureTime = now;

    if (entry.failureCount >= this.config.failureThreshold) {
      entry.state = CircuitState.OPEN;
      entry.openedAt = now;
    }
  }

  /** Return a snapshot of circuit states for all tracked agents. */
  getAllStates(): Record<string, CircuitState> {
    const states: Record<string, CircuitState> = {};
    for (const [agentId] of this.circuits) {
      states[agentId] = this.getState(agentId);
    }
    return states;
  }

  /** Reset the circuit breaker for a specific agent, returning it to CLOSED. */
  reset(agentId: string): void {
    this.circuits.delete(agentId);
  }

  /** Reset all circuit breakers. */
  resetAll(): void {
    this.circuits.clear();
  }
}
