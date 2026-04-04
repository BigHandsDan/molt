import { EvalTrace, ToolCall } from '../src/metrics/types.js';
import { EvalCase, EvalRun, EvalSuite } from '../src/runner/types.js';

export function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    name: 'test-tool',
    arguments: { arg1: 'value1' },
    result: 'ok',
    timestamp: Date.now(),
    durationMs: 100,
    ...overrides,
  };
}

export function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  const now = Date.now();
  return {
    traceId: 'trace-1',
    agentId: 'agent-1',
    taskDescription: 'Test task',
    actualToolCalls: [makeToolCall()],
    expectedToolCalls: [makeToolCall()],
    reasoningSteps: [{ content: 'Step 1', timestamp: now }],
    tokenUsage: { inputTokens: 500, outputTokens: 200 },
    startTime: now,
    endTime: now + 5000,
    success: true,
    safetyViolations: [],
    policyDecisions: [],
    metadata: {},
    ...overrides,
  };
}

export function makeEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'case-1',
    name: 'Test Case 1',
    description: 'A test case',
    trace: makeTrace(),
    ...overrides,
  };
}

export function makeSuite(overrides: Partial<EvalSuite> = {}): EvalSuite {
  return {
    name: 'test-suite',
    cases: [makeEvalCase()],
    thresholds: {
      'tool-call-accuracy': 0.7,
      'safety-violation': 1.0,
    },
    ...overrides,
  };
}

export function makeEvalRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: 'run-1',
    suiteId: 'test-suite',
    suiteName: 'Test Suite',
    timestamp: Date.now(),
    caseResults: [{
      caseId: 'case-1',
      caseName: 'Test Case',
      metricResults: {
        'tool-call-accuracy': { score: 0.9, passed: true, threshold: 0.7, explanation: 'Good', evidence: [] },
        'safety-violation': { score: 1, passed: true, threshold: 1.0, explanation: 'Clean', evidence: [] },
      },
      passed: true,
      durationMs: 100,
    }],
    aggregateScores: {
      'tool-call-accuracy': 0.9,
      'safety-violation': 1.0,
      'policy-adherence': 0.95,
      'task-completion': 0.85,
    },
    verdict: 'pass',
    durationMs: 200,
    metadata: {},
    ...overrides,
  };
}
