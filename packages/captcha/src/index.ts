import { generateChallenge } from "./engine/generator.js";
import { verifyResponse } from "./engine/verifier.js";
import { formatChallengeForAgent } from "./engine/formatter.js";
import { MemoryChallengeStore } from "./store/memory-store.js";
import type { Challenge, VerificationResult, ChallengeFormatted, MoltCaptchaStats } from "./engine/types.js";
import type { ChallengeStore } from "./store/types.js";

export class MoltCaptcha {
  private store: ChallengeStore;
  private stats: MoltCaptchaStats = {
    challengesGenerated: 0,
    verificationsAttempted: 0,
    verificationsPassed: 0,
    verificationsFailed: 0,
    challengesExpired: 0,
  };

  constructor(options?: { store?: ChallengeStore }) {
    this.store = options?.store ?? new MemoryChallengeStore();
  }

  generate(difficulty?: string): Challenge {
    const challenge = generateChallenge(difficulty);
    this.store.save(challenge);
    this.stats.challengesGenerated++;
    return challenge;
  }

  format(challenge: Challenge): ChallengeFormatted {
    return formatChallengeForAgent(challenge);
  }

  verify(challengeId: string, responseText: string): VerificationResult | null {
    const challenge = this.store.consume(challengeId);
    if (!challenge) return null;
    this.stats.verificationsAttempted++;
    const result = verifyResponse(challenge, responseText);
    if (result.overallPass) {
      this.stats.verificationsPassed++;
    } else {
      this.stats.verificationsFailed++;
    }
    return result;
  }

  getStats(): MoltCaptchaStats {
    return { ...this.stats };
  }
}

// Re-export everything
export { generateChallenge } from "./engine/generator.js";
export { verifyResponse } from "./engine/verifier.js";
export { formatChallengeForAgent } from "./engine/formatter.js";
export { MemoryChallengeStore } from "./store/memory-store.js";
export type { Challenge, VerificationResult, ChallengeFormatted, Difficulty, DifficultyConfig, MoltCaptchaStats } from "./engine/types.js";
export type { ChallengeStore } from "./store/types.js";
export { TOPICS, FORMATS, FORMAT_NAMES, DIFFICULTIES, ASCII_REF } from "./engine/constants.js";
