import express from 'express';
import { TrustTier, AgentIdentity, TaskContract } from '../../src/index.js';

/**
 * Researcher agent — Framework B (HTTP endpoint).
 * Runs as a standalone HTTP server, receives research task contracts
 * via the HTTP adapter, returns structured research results.
 */

export const RESEARCHER_IDENTITY: AgentIdentity = {
  agentId: 'researcher-agent',
  name: 'Researcher Agent',
  description: 'HTTP-based research agent that gathers and analyzes sources',
  trustTier: TrustTier.INTERNAL_RESTRICTED,
  capabilities: ['research', 'deep_research'],
  allowedTools: ['web_search'],
  metadata: { framework: 'http-express' },
  registeredAt: new Date().toISOString(),
};

export const RESEARCH_CONTRACT: TaskContract = {
  contractId: 'research',
  version: '1.0.0',
  capability: 'research',
  description: 'Gather and analyze sources on a given topic',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      maxSources: { type: 'number' },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            summary: { type: 'string' },
            relevance: { type: 'number' },
          },
          required: ['title', 'summary'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['sources', 'summary'],
  },
  securityClass: TrustTier.INTERNAL_RESTRICTED,
  requiredTools: ['web_search'],
  timeout: 10000,
  retryPolicy: { maxRetries: 2, backoffMs: 1000 },
  approvalRequired: false,
};

function handleResearch(input: { query: string; maxSources?: number }) {
  const maxSources = input.maxSources || 3;
  const sources = [];
  for (let i = 1; i <= maxSources; i++) {
    sources.push({
      title: `Source ${i}: ${input.query}`,
      url: `https://example.com/research/${i}`,
      summary: `Key findings about "${input.query}" from source ${i}. This covers recent developments, major players, and emerging trends.`,
      relevance: Math.round((1 - i * 0.1) * 100) / 100,
    });
  }
  return {
    sources,
    summary: `Research summary for "${input.query}": Found ${maxSources} relevant sources covering the topic. Key themes include interoperability standards, governance frameworks, and trust models.`,
  };
}

export function createResearcherServer(): {
  app: express.Express;
  start: (port: number) => Promise<ReturnType<import('net').Server['listen']>>;
  stop: () => Promise<void>;
} {
  const app = express();
  app.use(express.json());

  let server: ReturnType<typeof app.listen> | null = null;

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agent: 'researcher' });
  });

  app.post('/task', (req, res) => {
    const { input } = req.body;
    try {
      const result = handleResearch(input);
      res.json({ output: result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return {
    app,
    start: (port: number) =>
      new Promise((resolve) => {
        server = app.listen(port, () => resolve(server!));
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (server) {
          server.close((err) => (err ? reject(err) : resolve()));
        } else {
          resolve();
        }
      }),
  };
}
