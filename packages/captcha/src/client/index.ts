import type { ChallengeFormatted, VerificationResult } from "../engine/types.js";

export class MoltCaptchaClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrl: string, options?: { apiKey?: string }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (options?.apiKey) {
      this.headers["x-api-key"] = options.apiKey;
    }
  }

  async getChallenge(difficulty?: string): Promise<ChallengeFormatted> {
    const params = difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : "";
    const res = await fetch(`${this.baseUrl}/challenge${params}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to get challenge: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<ChallengeFormatted>;
  }

  async verify(challengeId: string, response: string): Promise<VerificationResult> {
    const res = await fetch(`${this.baseUrl}/verify`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ challengeId, response }),
    });
    if (!res.ok) {
      throw new Error(`Failed to verify: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<VerificationResult>;
  }

  async solveChallenge(
    difficulty: string,
    solveFn: (challenge: ChallengeFormatted) => Promise<string>,
  ): Promise<VerificationResult> {
    const challenge = await this.getChallenge(difficulty);
    const response = await solveFn(challenge);
    return this.verify(challenge.challengeId, response);
  }
}
