import { TrustTier, AgentIdentity, TaskContract, OpenAIHandler } from '../../src/index.js';

/**
 * Reviewer agent — Framework C (OpenAI-compatible).
 * Uses the OpenAI adapter with a mock handler for demo purposes.
 * Receives review task contracts and returns pass/fail assessment.
 */

export const REVIEWER_IDENTITY: AgentIdentity = {
  agentId: 'reviewer-agent',
  name: 'Reviewer Agent',
  description: 'OpenAI-compatible review/compliance agent',
  trustTier: TrustTier.INTERNAL_TRUSTED,
  capabilities: ['review', 'compliance_check'],
  allowedTools: ['code_analysis'],
  metadata: { framework: 'openai-compatible' },
  registeredAt: new Date().toISOString(),
};

export const REVIEW_CONTRACT: TaskContract = {
  contractId: 'review',
  version: '1.0.0',
  capability: 'review',
  description: 'Review and assess content for quality and compliance',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      criteria: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['topic'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pass', 'fail', 'reviewed'] },
      confidence: { type: 'number' },
      analysis: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion: { type: 'string' },
            score: { type: 'number' },
            comment: { type: 'string' },
          },
        },
      },
    },
    required: ['status', 'confidence', 'analysis'],
  },
  securityClass: TrustTier.INTERNAL_TRUSTED,
  requiredTools: [],
  timeout: 10000,
  retryPolicy: { maxRetries: 1, backoffMs: 500 },
  approvalRequired: false,
};

export const reviewerMockHandler: OpenAIHandler = async (messages, _model) => {
  const userMessage = messages.find((m) => m.role === 'user');
  let input: { topic?: string; criteria?: string[] };
  try {
    input = JSON.parse(userMessage?.content || '{}');
  } catch {
    input = { topic: userMessage?.content || 'unknown' };
  }

  const criteria = input.criteria || ['quality', 'completeness'];
  const findings = criteria.map((c) => ({
    criterion: c,
    score: Math.round((0.7 + Math.random() * 0.3) * 100) / 100,
    comment: `Assessment of ${c}: meets standards with minor notes.`,
  }));

  const result = {
    status: 'reviewed',
    confidence: 0.87,
    analysis: `Comprehensive review of "${input.topic || 'topic'}". Overall assessment: satisfactory. ${criteria.length} criteria evaluated.`,
    findings,
  };

  return {
    content: JSON.stringify(result),
    usage: {
      prompt_tokens: 150,
      completion_tokens: 80,
    },
  };
};
