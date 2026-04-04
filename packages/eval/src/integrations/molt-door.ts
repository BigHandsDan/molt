import { EvalRun } from '../runner/types.js';

/** Configuration for the MoltDoor client. */
export interface MoltDoorEvalConfig {
  baseUrl: string;
  apiKey?: string;
}

/** Rating payload sent to MoltDoor. */
export interface EvalRating {
  agentId: string;
  evalRunId: string;
  overallScore: number;
  verdict: string;
  metricScores: Record<string, number>;
  timestamp: number;
}

/** Client for posting eval scores as ratings to MoltDoor. */
export class MoltDoorEvalClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: MoltDoorEvalConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  /** Post eval run results as a rating to MoltDoor. */
  async postRating(agentId: string, evalRun: EvalRun): Promise<{ success: boolean; error?: string }> {
    const scores = Object.values(evalRun.aggregateScores);
    const overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const rating: EvalRating = {
      agentId,
      evalRunId: evalRun.id,
      overallScore,
      verdict: evalRun.verdict,
      metricScores: evalRun.aggregateScores,
      timestamp: Date.now(),
    };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/api/agents/${agentId}/ratings`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rating),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Build a rating from an eval run without sending it. */
  buildRating(agentId: string, evalRun: EvalRun): EvalRating {
    const scores = Object.values(evalRun.aggregateScores);
    const overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      agentId,
      evalRunId: evalRun.id,
      overallScore,
      verdict: evalRun.verdict,
      metricScores: evalRun.aggregateScores,
      timestamp: Date.now(),
    };
  }
}
