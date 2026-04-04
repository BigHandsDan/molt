/** Self-observability types for agent performance introspection. */

/** Summary report of an agent's eval performance. */
export interface AgentSelfReport {
  agentId: string;
  /** Summary stats from recent eval runs. */
  evalSummary: {
    totalRuns: number;
    passRate: number;
    avgScores: Record<string, number>;
    recentTrend: 'improving' | 'stable' | 'declining';
    lastRunVerdict: string;
    lastRunTimestamp: number;
  };
  /** Latency percentiles from case results. */
  latency: { p50: number; p95: number; p99: number };
  /** Top failure modes — metrics with lowest scores. */
  topFailures: Array<{ metric: string; avgScore: number; failureRate: number }>;
  /** Actionable recommendations for self-improvement. */
  recommendations: string[];
}

/** Trend direction for an agent's eval performance. */
export type TrendDirection = 'improving' | 'stable' | 'declining';
