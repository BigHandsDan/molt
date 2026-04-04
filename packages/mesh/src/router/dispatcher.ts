import { TaskEnvelope, TaskResult } from './types.js';
import { MoltMeshAdapter, AdapterConfig } from '../adapters/interface.js';
import { TimeoutError } from '../errors.js';
import { DeadLetterAttempt } from './dead-letter.js';

/** Dispatches task envelopes to adapters with timeout and retry support. */
export class Dispatcher {
  /**
   * Dispatch a single task to an adapter with a timeout.
   * @param envelope - The task envelope to dispatch.
   * @param adapter - The protocol adapter to use.
   * @param config - Adapter configuration for the target agent.
   * @param timeoutMs - Maximum time in milliseconds before the dispatch times out.
   * @returns The task result with duration.
   */
  async dispatch(
    envelope: TaskEnvelope,
    adapter: MoltMeshAdapter,
    config: AdapterConfig,
    timeoutMs: number
  ): Promise<TaskResult> {
    const start = Date.now();

    try {
      const result = await Promise.race([
        adapter.dispatch(envelope, config),
        this.timeout(timeoutMs, envelope),
      ]);

      return {
        ...result,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output: null,
        status: err instanceof TimeoutError ? 'timeout' : 'failure',
        agentId: config.agentId,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Dispatch a task with automatic retries and exponential backoff.
   * @param envelope - The task envelope to dispatch.
   * @param adapter - The protocol adapter to use.
   * @param config - Adapter configuration for the target agent.
   * @param timeoutMs - Timeout per attempt in milliseconds.
   * @param maxRetries - Maximum number of retry attempts.
   * @param backoffMs - Base backoff delay in milliseconds (multiplied by attempt number).
   * @param attempts - Optional array to collect dead-letter attempt records.
   * @returns The task result from the last attempt.
   */
  async dispatchWithRetry(
    envelope: TaskEnvelope,
    adapter: MoltMeshAdapter,
    config: AdapterConfig,
    timeoutMs: number,
    maxRetries: number,
    backoffMs: number,
    attempts?: DeadLetterAttempt[]
  ): Promise<TaskResult> {
    let lastResult: TaskResult | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.sleep(backoffMs * attempt);
      }
      const start = Date.now();
      lastResult = await this.dispatch(envelope, adapter, config, timeoutMs);

      if (lastResult.status === 'success') {
        return lastResult;
      }

      // Record attempt for dead-letter tracking
      if (attempts) {
        attempts.push({
          timestamp: new Date().toISOString(),
          error: lastResult.error || `Failed with status: ${lastResult.status}`,
          agentId: config.agentId,
          durationMs: Date.now() - start,
        });
      }
    }

    return lastResult!;
  }

  private timeout(ms: number, envelope: TaskEnvelope): Promise<TaskResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(envelope.envelopeId, ms));
      }, ms);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
