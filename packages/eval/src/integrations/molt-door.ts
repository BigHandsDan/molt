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

// NOTE: Requires MoltDoor /api/agents/:id/ratings endpoint (planned feature)

/**
 * Client for posting eval scores as ratings to MoltDoor.
 *
 * The ratings endpoint (`POST /api/agents/:id/ratings`) is a planned MoltDoor feature.
 * Use `buildRating()` or `dryRunPostRating()` to construct the payload without sending it.
 *
 * Expected API contract:
 * - `POST /api/agents/:id/ratings` with `EvalRating` JSON body
 * - Returns `201 Created` on success
 * - Requires `Authorization: Bearer <apiKey>` header
 */
export class MoltDoorEvalClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: MoltDoorEvalConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  /**
   * Post eval run results as a rating to MoltDoor.
   * NOTE: Requires MoltDoor /api/agents/:id/ratings endpoint (planned feature).
   */
  async postRating(agentId: string, evalRun: EvalRun): Promise<{ success: boolean; error?: string }> {
    const rating = this.buildRating(agentId, evalRun);

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

  /**
   * Build a rating payload without sending it (dry run).
   * Useful when the MoltDoor ratings endpoint is not yet available.
   */
  dryRunPostRating(agentId: string, evalRun: EvalRun): { rating: EvalRating; url: string } {
    const rating = this.buildRating(agentId, evalRun);
    return {
      rating,
      url: `${this.baseUrl}/api/agents/${agentId}/ratings`,
    };
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
