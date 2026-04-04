import { EvalStore } from '../store/store.js';
import { EvalRun } from '../runner/types.js';
import { LatencyAggregator } from '../metrics/latency-aggregator.js';
import { AgentSelfReport, TrendDirection } from './types.js';

/** Provides agents with a read-only view into their own eval performance data. */
export class AgentObserver {
  private store: EvalStore;
  private latencyAggregator: LatencyAggregator;

  constructor(store: EvalStore) {
    this.store = store;
    this.latencyAggregator = new LatencyAggregator();
  }

  /** Generate a self-report for an agent based on their eval history. */
  generateReport(
    agentId: string,
    options?: { maxRuns?: number; includeRecommendations?: boolean },
  ): AgentSelfReport {
    const maxRuns = options?.maxRuns ?? 50;
    const includeRecommendations = options?.includeRecommendations ?? true;
    const runs = this.store.getRunsByAgent(agentId, maxRuns);

    if (runs.length === 0) {
      return {
        agentId,
        evalSummary: {
          totalRuns: 0,
          passRate: 0,
          avgScores: {},
          recentTrend: 'stable',
          lastRunVerdict: 'none',
          lastRunTimestamp: 0,
        },
        latency: { p50: 0, p95: 0, p99: 0 },
        topFailures: [],
        recommendations: includeRecommendations
          ? ['No eval runs found. Run evaluations to establish a performance baseline.']
          : [],
      };
    }

    const passRate = runs.filter((r) => r.verdict === 'pass').length / runs.length;
    const avgScores = this.computeAvgScores(runs);
    const latency = this.latencyAggregator.compute(runs);
    const trend = this.getTrend(agentId);
    const lastRun = runs[0]; // runs are sorted desc by timestamp

    const topFailures = this.computeTopFailures(runs);
    const recommendations = includeRecommendations
      ? this.getRecommendations(agentId)
      : [];

    return {
      agentId,
      evalSummary: {
        totalRuns: runs.length,
        passRate,
        avgScores,
        recentTrend: trend,
        lastRunVerdict: lastRun.verdict,
        lastRunTimestamp: lastRun.timestamp,
      },
      latency: { p50: latency.p50, p95: latency.p95, p99: latency.p99 },
      topFailures,
      recommendations,
    };
  }

  /** Get trend direction for an agent (are they getting better or worse?). */
  getTrend(agentId: string, windowSize = 5): TrendDirection {
    const runs = this.store.getRunsByAgent(agentId, windowSize * 2);

    if (runs.length < 2) return 'stable';

    // Split into recent and previous windows
    const recentRuns = runs.slice(0, Math.min(windowSize, runs.length));
    const previousRuns = runs.slice(Math.min(windowSize, runs.length));

    if (previousRuns.length === 0) return 'stable';

    const recentAvg = this.computeOverallAvg(recentRuns);
    const previousAvg = this.computeOverallAvg(previousRuns);

    const delta = recentAvg - previousAvg;
    const threshold = 0.05; // 5% change threshold

    if (delta > threshold) return 'improving';
    if (delta < -threshold) return 'declining';
    return 'stable';
  }

  /** Get the agent's weakest metrics (lowest average scores). */
  getWeaknesses(
    agentId: string,
    limit = 3,
  ): Array<{ metric: string; avgScore: number }> {
    const runs = this.store.getRunsByAgent(agentId, 50);
    if (runs.length === 0) return [];

    const avgScores = this.computeAvgScores(runs);
    return Object.entries(avgScores)
      .map(([metric, avgScore]) => ({ metric, avgScore }))
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, limit);
  }

  /** Get the agent's strongest metrics (highest average scores). */
  getStrengths(
    agentId: string,
    limit = 3,
  ): Array<{ metric: string; avgScore: number }> {
    const runs = this.store.getRunsByAgent(agentId, 50);
    if (runs.length === 0) return [];

    const avgScores = this.computeAvgScores(runs);
    return Object.entries(avgScores)
      .map(([metric, avgScore]) => ({ metric, avgScore }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, limit);
  }

  /** Generate improvement recommendations based on eval data. */
  getRecommendations(agentId: string): string[] {
    const runs = this.store.getRunsByAgent(agentId, 50);
    if (runs.length === 0) {
      return ['No eval runs found. Run evaluations to establish a performance baseline.'];
    }

    const recommendations: string[] = [];
    const avgScores = this.computeAvgScores(runs);
    const passRate = runs.filter((r) => r.verdict === 'pass').length / runs.length;
    const trend = this.getTrend(agentId);
    const weaknesses = this.getWeaknesses(agentId, 3);
    const topFailures = this.computeTopFailures(runs);

    // Pass rate recommendations
    if (passRate < 0.5) {
      recommendations.push(
        `Critical: pass rate is ${(passRate * 100).toFixed(0)}%. Review failing cases and address systematic issues.`,
      );
    } else if (passRate < 0.8) {
      recommendations.push(
        `Pass rate is ${(passRate * 100).toFixed(0)}%. Focus on the most common failure patterns to improve reliability.`,
      );
    }

    // Trend-based recommendations
    if (trend === 'declining') {
      recommendations.push(
        'Performance is declining. Compare recent runs to earlier baselines to identify regressions.',
      );
    }

    // Weakness-based recommendations
    for (const weakness of weaknesses) {
      if (weakness.avgScore < 0.5) {
        recommendations.push(
          `Metric "${weakness.metric}" is critically low (${(weakness.avgScore * 100).toFixed(0)}%). Prioritize improvement in this area.`,
        );
      } else if (weakness.avgScore < 0.7) {
        recommendations.push(
          `Metric "${weakness.metric}" is below target (${(weakness.avgScore * 100).toFixed(0)}%). Consider targeted improvements.`,
        );
      }
    }

    // Failure rate recommendations
    for (const failure of topFailures) {
      if (failure.failureRate > 0.5) {
        recommendations.push(
          `"${failure.metric}" fails in ${(failure.failureRate * 100).toFixed(0)}% of cases. Investigate root causes for this metric.`,
        );
      }
    }

    // Consistency recommendation
    if (runs.length >= 3) {
      const scores = Object.values(avgScores);
      if (scores.length >= 2) {
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        if (maxScore - minScore > 0.3) {
          recommendations.push(
            'Large variance between metrics. Focus on bringing weaker metrics closer to stronger ones for consistent performance.',
          );
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is solid across all metrics. Continue monitoring for regressions.');
    }

    return recommendations;
  }

  /** Compute average scores across all metrics for a set of runs. */
  private computeAvgScores(runs: EvalRun[]): Record<string, number> {
    const scoreSums: Record<string, number> = {};
    const scoreCounts: Record<string, number> = {};

    for (const run of runs) {
      for (const [metric, score] of Object.entries(run.aggregateScores)) {
        scoreSums[metric] = (scoreSums[metric] ?? 0) + score;
        scoreCounts[metric] = (scoreCounts[metric] ?? 0) + 1;
      }
    }

    const result: Record<string, number> = {};
    for (const metric of Object.keys(scoreSums)) {
      result[metric] = scoreSums[metric] / scoreCounts[metric];
    }
    return result;
  }

  /** Compute a single overall average across all metrics for a set of runs. */
  private computeOverallAvg(runs: EvalRun[]): number {
    const avgScores = this.computeAvgScores(runs);
    const values = Object.values(avgScores);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** Compute top failure modes from metric scores across runs. */
  private computeTopFailures(
    runs: EvalRun[],
  ): Array<{ metric: string; avgScore: number; failureRate: number }> {
    const metricStats: Record<string, { totalScore: number; totalCases: number; failures: number }> = {};

    for (const run of runs) {
      for (const cr of run.caseResults) {
        for (const [metricName, mr] of Object.entries(cr.metricResults)) {
          if (!metricStats[metricName]) {
            metricStats[metricName] = { totalScore: 0, totalCases: 0, failures: 0 };
          }
          metricStats[metricName].totalScore += mr.score;
          metricStats[metricName].totalCases += 1;
          if (!mr.passed) {
            metricStats[metricName].failures += 1;
          }
        }
      }
    }

    return Object.entries(metricStats)
      .map(([metric, stats]) => ({
        metric,
        avgScore: stats.totalCases > 0 ? stats.totalScore / stats.totalCases : 0,
        failureRate: stats.totalCases > 0 ? stats.failures / stats.totalCases : 0,
      }))
      .filter((f) => f.failureRate > 0)
      .sort((a, b) => b.failureRate - a.failureRate);
  }
}
