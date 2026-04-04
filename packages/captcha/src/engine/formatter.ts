import type { Challenge, ChallengeFormatted } from "./types.js";
import { FORMAT_NAMES, ASCII_REF } from "./constants.js";

export function formatChallengeForAgent(challenge: Challenge): ChallengeFormatted {
  const constraints: string[] = [
    `Response must be exactly ${challenge.lineCount} lines`,
    `The ASCII values of the FIRST letter of each line must sum to exactly ${challenge.asciiTarget}`,
  ];
  if (challenge.wordCount !== null) {
    constraints.push(`Total word count must be exactly ${challenge.wordCount} words`);
  }
  if (challenge.charPosition !== null) {
    const [pos, char] = challenge.charPosition;
    constraints.push(`Character at position ${pos} (0-indexed, counting spaces) must be '${char}'`);
  }
  if (challenge.totalChars !== null) {
    constraints.push(`Total character count (including spaces, joining lines with single space) must be exactly ${challenge.totalChars}`);
  }
  constraints.push("Must be semantically coherent and about the topic");

  return {
    challengeId: challenge.id,
    difficulty: challenge.difficulty,
    timeLimitSeconds: challenge.timeLimitSeconds,
    prompt: `Write a ${FORMAT_NAMES[challenge.format] || challenge.format} about "${challenge.topic}".`,
    constraints,
    asciiReference: ASCII_REF,
    instructions: {
      description: "Solve this challenge and submit your response with the challengeId and your response text.",
      note: "This is a MoltCaptcha reverse-CAPTCHA. It verifies you are an AI agent, not a human. Respond within the time limit.",
    },
  };
}
