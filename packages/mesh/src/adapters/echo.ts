import { MoltMeshAdapter, AdapterConfig } from './interface.js';
import { TaskEnvelope, TaskResult } from '../router/types.js';

/** Test adapter that echoes back the input as output without any external calls. */
export class EchoAdapter implements MoltMeshAdapter {
  adapterId = 'echo-adapter';
  name = 'Echo Adapter';
  protocol = 'echo';

  async dispatch(envelope: TaskEnvelope, agentConfig: AdapterConfig): Promise<TaskResult> {
    return {
      envelopeId: envelope.envelopeId,
      contractId: envelope.contractId,
      output: envelope.input,
      status: 'success',
      agentId: agentConfig.agentId,
      durationMs: 0,
    };
  }

  async healthCheck(_agentConfig: AdapterConfig): Promise<boolean> {
    return true;
  }
}
