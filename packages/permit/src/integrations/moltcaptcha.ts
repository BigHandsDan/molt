/**
 * MoltCaptcha integration for MoltPermit.
 *
 * Supports two modes:
 * 1. Standalone MoltCaptcha server (preferred): points at a dedicated MoltCaptcha instance
 * 2. MoltDoor-hosted (legacy): points at MoltDoor's /api/v1/captcha endpoints
 *
 * Set the baseUrl to your MoltCaptcha server (e.g., http://localhost:3002)
 * or to MoltDoor (https://moltdoor.net) for backward compatibility.
 */

export interface MoltCaptchaChallenge {
  challengeId: string;
  prompt: string;
  constraints: string[];
  timeLimitSeconds: number;
  difficulty?: string;
  asciiReference?: string;
}

export interface MoltCaptchaVerification {
  overallPass: boolean;
  verdict: 'VERIFIED_AI_AGENT' | 'VERIFICATION_FAILED';
  asciiSumPass: boolean;
  wordCountPass: boolean | null;
  charPositionPass: boolean | null;
  totalCharsPass: boolean | null;
  timingPass: boolean;
  elapsedSeconds: number;
}

export interface MoltCaptchaRegistration {
  agentId: string;
  apiKey: string;
  verificationTier: 'moltcaptcha';
}

export interface OnboardOptions {
  difficulty?: 'easy' | 'medium' | 'hard' | 'extreme';
  agentInfo: {
    name: string;
    description?: string;
  };
  solveFn?: (challenge: MoltCaptchaChallenge) => Promise<string>;
}

export interface MoltCaptchaClientConfig {
  baseUrl: string;
  /**
   * 'standalone' = dedicated MoltCaptcha server (GET /challenge, POST /verify)
   * 'moltdoor' = MoltDoor-hosted endpoints (GET /api/v1/captcha, POST /api/v1/register)
   */
  mode: 'standalone' | 'moltdoor';
  apiKey?: string;
}

export class MoltCaptchaClient {
  private config: MoltCaptchaClientConfig;

  constructor(baseUrlOrConfig?: string | Partial<MoltCaptchaClientConfig>) {
    if (typeof baseUrlOrConfig === 'string') {
      // Detect mode from URL
      const url = baseUrlOrConfig;
      const isMoltDoor = url.includes('moltdoor');
      this.config = {
        baseUrl: url,
        mode: isMoltDoor ? 'moltdoor' : 'standalone',
      };
    } else {
      this.config = {
        baseUrl: baseUrlOrConfig?.baseUrl || 'https://moltdoor.net',
        mode: baseUrlOrConfig?.mode || 'moltdoor',
        apiKey: baseUrlOrConfig?.apiKey,
      };
    }
  }

  async getChallenge(difficulty: string = 'medium'): Promise<MoltCaptchaChallenge> {
    const url = this.config.mode === 'standalone'
      ? `${this.config.baseUrl}/challenge?difficulty=${encodeURIComponent(difficulty)}`
      : `${this.config.baseUrl}/api/v1/captcha?difficulty=${encodeURIComponent(difficulty)}`;

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to get captcha challenge: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as MoltCaptchaChallenge;
  }

  async verify(challengeId: string, responseText: string): Promise<MoltCaptchaVerification> {
    if (this.config.mode !== 'standalone') {
      throw new Error('Direct verification is only available in standalone mode. In moltdoor mode, verification happens during registration.');
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(`${this.config.baseUrl}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ challengeId, response: responseText }),
    });

    if (!response.ok) {
      throw new Error(`Verification failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as MoltCaptchaVerification;
  }

  async register(
    challengeId: string,
    solution: string,
    agentInfo: { name: string; description?: string },
  ): Promise<MoltCaptchaRegistration> {
    // Registration always goes through MoltDoor (it creates the agent profile)
    const moltdoorUrl = this.config.mode === 'moltdoor'
      ? this.config.baseUrl
      : 'https://moltdoor.net';

    const response = await fetch(`${moltdoorUrl}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        captchaResponse: solution,
        ...agentInfo,
      }),
    });

    if (!response.ok) {
      throw new Error(`Registration failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as MoltCaptchaRegistration;
  }

  async onboard(options: OnboardOptions): Promise<MoltCaptchaRegistration> {
    const challenge = await this.getChallenge(options.difficulty || 'medium');

    if (!options.solveFn) {
      throw new Error('solveFn is required to solve the captcha challenge');
    }

    const solution = await options.solveFn(challenge);
    return this.register(challenge.challengeId, solution, options.agentInfo);
  }

  /**
   * Solve a challenge end-to-end: get challenge → solve → verify.
   * For standalone mode only. Does NOT register with MoltDoor.
   */
  async solveAndVerify(
    difficulty: string,
    solveFn: (challenge: MoltCaptchaChallenge) => Promise<string>,
  ): Promise<MoltCaptchaVerification> {
    const challenge = await this.getChallenge(difficulty);
    const solution = await solveFn(challenge);
    return this.verify(challenge.challengeId, solution);
  }
}
