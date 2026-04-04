import { randomBytes, randomInt } from "node:crypto";
import type { Challenge } from "./types.js";
import { TOPICS, FORMATS, DIFFICULTIES } from "./constants.js";

function randInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}

function randChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

export function generateChallenge(difficulty: string = "medium"): Challenge {
  if (!(difficulty in DIFFICULTIES)) difficulty = "medium";
  const config = DIFFICULTIES[difficulty];

  const topic = randChoice(TOPICS);
  const [format, lineCount] = randChoice(FORMATS);

  // ASCII target: sum of first letter of each line
  const asciiTarget = lineCount === 3 ? randInt(280, 320) : randInt(380, 420);

  let wordCount: number | null = null;
  let charPosition: [number, string] | null = null;
  let totalChars: number | null = null;

  if (config.constraints.includes("word_count")) {
    wordCount = lineCount === 3 ? randInt(9, 16) : randInt(12, 22);
  }
  if (config.constraints.includes("char_position")) {
    const pos = randInt(10, 50);
    const char = String.fromCharCode(randInt(97, 122)); // a-z
    charPosition = [pos, char];
  }
  if (config.constraints.includes("total_chars")) {
    totalChars = lineCount === 3 ? randInt(60, 120) : randInt(80, 160);
  }

  const id = `mcc_${randomBytes(16).toString("hex")}`;
  const challenge: Challenge = {
    id,
    topic,
    format,
    lineCount,
    asciiTarget,
    wordCount,
    charPosition,
    totalChars,
    timeLimitSeconds: config.timeLimit,
    difficulty,
    createdAt: Date.now() / 1000,
  };

  return challenge;
}
