import { TaskEnvelope, TaskResult } from '../router/types.js';

/** Configuration for connecting an agent to a protocol adapter. */
export interface AdapterConfig {
  agentId: string;
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model?: string;
  metadata?: Record<string, unknown>;
}

/** Protocol adapter that translates task envelopes into agent-specific API calls. */
export interface MoltMeshAdapter {
  adapterId: string;
  name: string;
  protocol: string;

  dispatch(envelope: TaskEnvelope, agentConfig: AdapterConfig): Promise<TaskResult>;

  healthCheck(agentConfig: AdapterConfig): Promise<boolean>;
}
