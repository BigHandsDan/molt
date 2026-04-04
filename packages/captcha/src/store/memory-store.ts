import type { Challenge } from "../engine/types.js";
import type { ChallengeStore } from "./types.js";

export class MemoryChallengeStore implements ChallengeStore {
  private challenges = new Map<string, Challenge>();
  private lastCleanup = Date.now() / 1000;
  private cleanupIntervalSeconds = 60;

  save(challenge: Challenge): void {
    this.lazyCleanup();
    this.challenges.set(challenge.id, challenge);
  }

  get(id: string): Challenge | null {
    this.lazyCleanup();
    return this.challenges.get(id) ?? null;
  }

  consume(id: string): Challenge | null {
    this.lazyCleanup();
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    this.challenges.delete(id);
    return challenge;
  }

  cleanup(): number {
    const now = Date.now() / 1000;
    let removed = 0;
    for (const [id, ch] of this.challenges) {
      if (now - ch.createdAt > ch.timeLimitSeconds + 60) {
        this.challenges.delete(id);
        removed++;
      }
    }
    this.lastCleanup = now;
    return removed;
  }

  private lazyCleanup(): void {
    const now = Date.now() / 1000;
    if (now - this.lastCleanup > this.cleanupIntervalSeconds) {
      this.cleanup();
    }
  }
}
