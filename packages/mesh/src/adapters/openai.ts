import { MoltMeshAdapter, AdapterConfig } from './interface.js';
import { TaskEnvelope, TaskResult } from '../router/types.js';

/** Handler function for OpenAI-style chat completions. Can be a real API call or a mock. */
export type OpenAIHandler = (
  messages: Array<{ role: string; content: string }>,
  model: string
) => Promise<{
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}>;

/**
 * OpenAI-compatible adapter. In Phase 0, uses a mock handler instead
 * of actually calling the OpenAI API. The handler can be replaced with
 * a real implementation later.
 */
export class OpenAIAdapter implements MoltMeshAdapter {
  adapterId = 'openai-adapter';
  name = 'OpenAI Adapter';
  protocol = 'openai';

  private handler: OpenAIHandler;

  constructor(handler?: OpenAIHandler) {
    this.handler = handler || OpenAIAdapter.defaultMockHandler;
  }

  static defaultMockHandler: OpenAIHandler = async (messages, _model) => {
    const lastMessage = messages[messages.length - 1];
    return {
      content: JSON.stringify({
        analysis: `Mock analysis of: ${lastMessage?.content?.substring(0, 100) || 'no input'}`,
        status: 'reviewed',
        confidence: 0.85,
      }),
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    };
  };

  async dispatch(envelope: TaskEnvelope, agentConfig: AdapterConfig): Promise<TaskResult> {
    const model = agentConfig.model || 'gpt-4';
    const start = Date.now();

    try {
      const messages = this.buildMessages(envelope);
      const response = await this.handler(messages, model);

      let output: unknown;
      try {
        output = JSON.parse(response.content);
      } catch {
        output = { content: response.content };
      }

      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output,
        status: 'success',
        agentId: agentConfig.agentId,
        durationMs: Date.now() - start,
        tokenUsage: response.usage
          ? {
              input: response.usage.prompt_tokens,
              output: response.usage.completion_tokens,
            }
          : undefined,
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

  async healthCheck(_agentConfig: AdapterConfig): Promise<boolean> {
    return true;
  }

  private buildMessages(envelope: TaskEnvelope): Array<{ role: string; content: string }> {
    return [
      {
        role: 'system',
        content: `You are fulfilling contract ${envelope.contractId}@${envelope.version}. Respond with structured JSON.`,
      },
      {
        role: 'user',
        content:
          typeof envelope.input === 'string' ? envelope.input : JSON.stringify(envelope.input),
      },
    ];
  }
}
