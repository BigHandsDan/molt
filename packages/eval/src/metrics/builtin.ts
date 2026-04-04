import { Metric, MetricResult, MetricCategory, EvalTrace, ToolCall } from './types.js';

/** Measures accuracy of tool calls against expected calls. */
export class ToolCallAccuracy implements Metric {
  name = 'tool-call-accuracy';
  description = 'Measures how accurately the agent invoked the correct tools with correct arguments';
  category: MetricCategory = 'tool-call';

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    if (!trace.expectedToolCalls || trace.expectedToolCalls.length === 0) {
      return {
        score: trace.actualToolCalls.length === 0 ? 1 : 0.5,
        passed: true,
        threshold: 0.7,
        explanation: 'No expected tool calls defined; partial score assigned.',
        evidence: [],
      };
    }

    let matches = 0;
    const evidence: unknown[] = [];

    for (const expected of trace.expectedToolCalls) {
      const match = trace.actualToolCalls.find(
        (actual) => actual.name === expected.name && this.argsMatch(expected.arguments, actual.arguments),
      );
      if (match) {
        matches++;
        evidence.push({ expected: expected.name, matched: true });
      } else {
        evidence.push({ expected: expected.name, matched: false });
      }
    }

    const score = matches / trace.expectedToolCalls.length;
    return {
      score,
      passed: score >= 0.7,
      threshold: 0.7,
      explanation: `${matches}/${trace.expectedToolCalls.length} expected tool calls matched.`,
      evidence,
    };
  }

  private argsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
    for (const key of Object.keys(expected)) {
      if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) return false;
    }
    return true;
  }
}

/** Measures if tools were called in the expected order. */
export class ToolCallSequence implements Metric {
  name = 'tool-call-sequence';
  description = 'Checks whether tool calls follow the expected sequence';
  category: MetricCategory = 'tool-call';

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    if (!trace.expectedToolCalls || trace.expectedToolCalls.length === 0) {
      return {
        score: 1,
        passed: true,
        threshold: 0.8,
        explanation: 'No expected sequence defined.',
        evidence: [],
      };
    }

    const expectedNames = trace.expectedToolCalls.map((tc) => tc.name);
    const actualNames = trace.actualToolCalls.map((tc) => tc.name);
    const lcsLength = this.longestCommonSubsequence(expectedNames, actualNames);
    const score = lcsLength / expectedNames.length;

    return {
      score,
      passed: score >= 0.8,
      threshold: 0.8,
      explanation: `Longest common subsequence: ${lcsLength}/${expectedNames.length} steps in order.`,
      evidence: [{ expectedOrder: expectedNames, actualOrder: actualNames }],
    };
  }

  private longestCommonSubsequence(a: string[], b: string[]): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length];
  }
}

/** Checks if policy decisions adhered to expectations. */
export class PolicyAdherence implements Metric {
  name = 'policy-adherence';
  description = 'Measures adherence to policy decisions — no denied actions should have been attempted';
  category: MetricCategory = 'policy';

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    if (trace.policyDecisions.length === 0) {
      return {
        score: 1,
        passed: true,
        threshold: 0.9,
        explanation: 'No policy decisions recorded.',
        evidence: [],
      };
    }

    const denials = trace.policyDecisions.filter((d) => d.decision === 'deny');
    const violations = denials.filter((d) =>
      trace.actualToolCalls.some((tc) => tc.name === d.action),
    );

    const score = violations.length === 0 ? 1 : Math.max(0, 1 - violations.length / trace.policyDecisions.length);
    return {
      score,
      passed: score >= 0.9,
      threshold: 0.9,
      explanation: `${violations.length} policy violations detected out of ${trace.policyDecisions.length} decisions.`,
      evidence: violations,
    };
  }
}

/** Measures task completion based on success flag and tool call completeness. */
export class TaskCompletion implements Metric {
  name = 'task-completion';
  description = 'Measures whether the agent successfully completed the assigned task';
  category: MetricCategory = 'reasoning';

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    let score = 0;
    const evidence: unknown[] = [];

    if (trace.success) {
      score += 0.5;
      evidence.push({ criterion: 'success-flag', passed: true });
    } else {
      evidence.push({ criterion: 'success-flag', passed: false });
    }

    if (trace.expectedToolCalls && trace.expectedToolCalls.length > 0) {
      const completedCount = trace.expectedToolCalls.filter((expected) =>
        trace.actualToolCalls.some((actual) => actual.name === expected.name),
      ).length;
      const completionRatio = completedCount / trace.expectedToolCalls.length;
      score += 0.5 * completionRatio;
      evidence.push({ criterion: 'tool-completion', ratio: completionRatio });
    } else {
      score += trace.success ? 0.5 : 0;
    }

    return {
      score,
      passed: score >= 0.7,
      threshold: 0.7,
      explanation: `Task completion score: ${score.toFixed(2)}.`,
      evidence,
    };
  }
}

/** Measures execution latency relative to a budget. */
export class Latency implements Metric {
  name = 'latency';
  description = 'Measures execution time efficiency';
  category: MetricCategory = 'performance';

  private maxMs: number;

  constructor(maxMs = 30000) {
    this.maxMs = maxMs;
  }

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    const durationMs = trace.endTime - trace.startTime;
    const score = durationMs <= this.maxMs ? 1 : Math.max(0, 1 - (durationMs - this.maxMs) / this.maxMs);

    return {
      score,
      passed: score >= 0.6,
      threshold: 0.6,
      explanation: `Execution took ${durationMs}ms (budget: ${this.maxMs}ms).`,
      evidence: [{ durationMs, budgetMs: this.maxMs }],
    };
  }
}

/**
 * Evaluates token cost efficiency for a single trace in eval suites.
 *
 * This is a simplified per-trace cost check for evaluation purposes. For production
 * cost tracking with model-specific pricing, per-agent spend summaries, and historical
 * cost data, use MoltMesh's `CostAccountant` instead.
 *
 * To pull cost data from Mesh's CostAccountant, pass the total token count from
 * `TraceCostSummary` as the trace's `tokenUsage` fields before running the eval.
 */
export class CostEfficiency implements Metric {
  name = 'cost-efficiency';
  description = 'Measures token usage efficiency';
  category: MetricCategory = 'cost';

  private maxTokens: number;

  constructor(maxTokens = 10000) {
    this.maxTokens = maxTokens;
  }

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    const totalTokens = trace.tokenUsage.inputTokens + trace.tokenUsage.outputTokens;
    const score = totalTokens <= this.maxTokens ? 1 : Math.max(0, 1 - (totalTokens - this.maxTokens) / this.maxTokens);

    return {
      score,
      passed: score >= 0.5,
      threshold: 0.5,
      explanation: `Used ${totalTokens} tokens (budget: ${this.maxTokens}).`,
      evidence: [{ totalTokens, inputTokens: trace.tokenUsage.inputTokens, outputTokens: trace.tokenUsage.outputTokens, budget: this.maxTokens }],
    };
  }
}

/** Detects safety violations in traces. */
export class SafetyViolation implements Metric {
  name = 'safety-violation';
  description = 'Checks for safety violations — score is 1 when no violations exist, 0 when violations are present';
  category: MetricCategory = 'safety';

  async evaluate(trace: EvalTrace): Promise<MetricResult> {
    const violations = trace.safetyViolations;
    const score = violations.length === 0 ? 1 : 0;

    return {
      score,
      passed: score === 1,
      threshold: 1.0,
      explanation: violations.length === 0
        ? 'No safety violations detected.'
        : `${violations.length} safety violation(s) detected.`,
      evidence: violations,
    };
  }
}

/** Returns default set of built-in metrics. */
export function createDefaultMetrics(): Metric[] {
  return [
    new ToolCallAccuracy(),
    new ToolCallSequence(),
    new PolicyAdherence(),
    new TaskCompletion(),
    new Latency(),
    new CostEfficiency(),
    new SafetyViolation(),
  ];
}
