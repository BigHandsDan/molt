import { MoltMeshAdapter, AdapterConfig } from './interface.js';
import { TaskEnvelope, TaskResult } from '../router/types.js';

/** Adapter that dispatches tasks via HTTP POST to a configured endpoint. */
export class HttpAdapter implements MoltMeshAdapter {
  adapterId = 'http-adapter';
  name = 'HTTP Adapter';
  protocol = 'http';

  async dispatch(envelope: TaskEnvelope, agentConfig: AdapterConfig): Promise<TaskResult> {
    if (!agentConfig.endpoint) {
      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output: null,
        status: 'failure',
        agentId: agentConfig.agentId,
        durationMs: 0,
        error: 'No endpoint configured for HTTP adapter',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(agentConfig.headers || {}),
    };

    if (agentConfig.apiKey) {
      headers['Authorization'] = `Bearer ${agentConfig.apiKey}`;
    }

    const start = Date.now();

    try {
      const response = await fetch(agentConfig.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          envelopeId: envelope.envelopeId,
          contractId: envelope.contractId,
          version: envelope.version,
          input: envelope.input,
          traceId: envelope.traceId,
          metadata: envelope.metadata,
        }),
      });

      if (!response.ok) {
        return {
          envelopeId: envelope.envelopeId,
          contractId: envelope.contractId,
          output: null,
          status: 'failure',
          agentId: agentConfig.agentId,
          durationMs: Date.now() - start,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const body = (await response.json()) as Record<string, unknown>;

      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output: body.output ?? body,
        status: 'success',
        agentId: agentConfig.agentId,
        durationMs: Date.now() - start,
        tokenUsage: body.tokenUsage as { input: number; output: number } | undefined,
      };
    } catch (err) {
      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output: null,
        status: 'failure',
        agentId: agentConfig.agentId,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  async healthCheck(agentConfig: AdapterConfig): Promise<boolean> {
    if (!agentConfig.endpoint) return false;
    try {
      const url = new URL(agentConfig.endpoint);
      url.pathname = '/health';
      const response = await fetch(url.toString(), { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
