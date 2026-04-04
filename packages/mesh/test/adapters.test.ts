import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import { EchoAdapter } from '../src/adapters/echo.js';
import { HttpAdapter } from '../src/adapters/http.js';
import { OpenAIAdapter, OpenAIHandler } from '../src/adapters/openai.js';
import { TaskEnvelope } from '../src/router/types.js';
import { TrustTier } from '../src/identity/types.js';

function makeEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    envelopeId: 'env-1',
    contractId: 'test',
    version: '1.0.0',
    input: { msg: 'hello' },
    caller: {
      agentId: 'caller',
      name: 'Caller',
      description: '',
      trustTier: TrustTier.INTERNAL_TRUSTED,
      capabilities: [],
      allowedTools: [],
      metadata: {},
      registeredAt: new Date().toISOString(),
    },
    traceId: 'trace-1',
    metadata: {},
    ...overrides,
  };
}

describe('EchoAdapter', () => {
  it('should echo input as output', async () => {
    const adapter = new EchoAdapter();
    const result = await adapter.dispatch(makeEnvelope(), { agentId: 'a' });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ msg: 'hello' });
  });

  it('should pass health check', async () => {
    const adapter = new EchoAdapter();
    expect(await adapter.healthCheck({ agentId: 'a' })).toBe(true);
  });

  it('should have correct adapter metadata', () => {
    const adapter = new EchoAdapter();
    expect(adapter.protocol).toBe('echo');
    expect(adapter.adapterId).toBe('echo-adapter');
  });
});

describe('HttpAdapter', () => {
  let server: ReturnType<typeof app.listen>;
  const app = express();
  const port = 19876;

  beforeAll(async () => {
    app.use(express.json());
    app.post('/task', (req, res) => {
      res.json({ output: { received: req.body.input, processed: true } });
    });
    app.post('/error', (_req, res) => {
      res.status(500).json({ error: 'internal error' });
    });
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(port, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('should dispatch to HTTP endpoint and get response', async () => {
    const adapter = new HttpAdapter();
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'http-agent',
      endpoint: `http://localhost:${port}/task`,
    });
    expect(result.status).toBe('success');
    expect((result.output as any).processed).toBe(true);
  });

  it('should handle HTTP errors', async () => {
    const adapter = new HttpAdapter();
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'http-agent',
      endpoint: `http://localhost:${port}/error`,
    });
    expect(result.status).toBe('failure');
    expect(result.error).toContain('500');
  });

  it('should fail without endpoint', async () => {
    const adapter = new HttpAdapter();
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'http-agent',
    });
    expect(result.status).toBe('failure');
    expect(result.error).toContain('No endpoint');
  });

  it('should pass health check for running server', async () => {
    const adapter = new HttpAdapter();
    const healthy = await adapter.healthCheck({
      agentId: 'http-agent',
      endpoint: `http://localhost:${port}/task`,
    });
    expect(healthy).toBe(true);
  });

  it('should fail health check for dead server', async () => {
    const adapter = new HttpAdapter();
    const healthy = await adapter.healthCheck({
      agentId: 'http-agent',
      endpoint: 'http://localhost:19999/task',
    });
    expect(healthy).toBe(false);
  });

  it('should have correct adapter metadata', () => {
    const adapter = new HttpAdapter();
    expect(adapter.protocol).toBe('http');
  });
});

describe('OpenAIAdapter', () => {
  it('should dispatch with mock handler', async () => {
    const adapter = new OpenAIAdapter();
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'openai-agent',
      model: 'gpt-4',
    });
    expect(result.status).toBe('success');
    expect(result.output).toBeDefined();
    expect(result.tokenUsage).toBeDefined();
  });

  it('should use custom handler', async () => {
    const handler: OpenAIHandler = async (messages, model) => ({
      content: JSON.stringify({ custom: true, model }),
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const adapter = new OpenAIAdapter(handler);
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'openai-agent',
      model: 'custom-model',
    });
    expect(result.status).toBe('success');
    expect((result.output as any).custom).toBe(true);
    expect((result.output as any).model).toBe('custom-model');
  });

  it('should handle handler errors', async () => {
    const handler: OpenAIHandler = async () => {
      throw new Error('API key invalid');
    };

    const adapter = new OpenAIAdapter(handler);
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'openai-agent',
      model: 'gpt-4',
    });
    expect(result.status).toBe('failure');
    expect(result.error).toContain('API key invalid');
  });

  it('should handle non-JSON response content', async () => {
    const handler: OpenAIHandler = async () => ({
      content: 'Just plain text response',
    });

    const adapter = new OpenAIAdapter(handler);
    const result = await adapter.dispatch(makeEnvelope(), {
      agentId: 'openai-agent',
      model: 'gpt-4',
    });
    expect(result.status).toBe('success');
    expect((result.output as any).content).toBe('Just plain text response');
  });

  it('should pass health check', async () => {
    const adapter = new OpenAIAdapter();
    expect(await adapter.healthCheck({ agentId: 'a' })).toBe(true);
  });

  it('should have correct adapter metadata', () => {
    const adapter = new OpenAIAdapter();
    expect(adapter.protocol).toBe('openai');
  });
});
