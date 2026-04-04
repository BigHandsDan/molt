import type { Challenge } from "../engine/types.js";

export interface ChallengeStore {
  save(challenge: Challenge): void;
  get(id: string): Challenge | null;
  consume(id: string): Challenge | null;
  cleanup(): number;
}
