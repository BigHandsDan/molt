import { describe, it, expect } from "vitest";
import { formatChallengeForAgent } from "../src/engine/formatter.js";
import type { Challenge } from "../src/engine/types.js";

function makeChallenge(overrides?: Partial<Challenge>): Challenge {
  return {
    id: "mcc_abc123def456abc123def456abc123de",
    topic: "verification",
    format: "haiku",
    lineCount: 3,
    asciiTarget: 300,
    wordCount: null,
    charPosition: null,
    totalChars: null,
    timeLimitSeconds: 20,
    difficulty: "medium",
    createdAt: Date.now() / 1000,
    ...overrides,
  };
}

describe("formatChallengeForAgent", () => {
  it("returns correct structure", () => {
    const ch = makeChallenge();
    const fmt = formatChallengeForAgent(ch);
    expect(fmt.challengeId).toBe(ch.id);
    expect(fmt.difficulty).toBe("medium");
    expect(fmt.timeLimitSeconds).toBe(20);
    expect(fmt.prompt).toContain("HAIKU");
    expect(fmt.prompt).toContain("verification");
    expect(fmt.asciiReference).toContain("A=65");
    expect(fmt.instructions.note).toContain("MoltCaptcha");
  });

  it("includes line count constraint always", () => {
    const ch = makeChallenge();
    const fmt = formatChallengeForAgent(ch);
    expect(fmt.constraints[0]).toContain("3 lines");
  });

  it("includes ASCII constraint always", () => {
    const ch = makeChallenge();
    const fmt = formatChallengeForAgent(ch);
    expect(fmt.constraints[1]).toContain("ASCII");
    expect(fmt.constraints[1]).toContain("300");
  });

  it("includes word count constraint when present", () => {
    const ch = makeChallenge({ wordCount: 12 });
    const fmt = formatChallengeForAgent(ch);
    const wcConstraint = fmt.constraints.find(c => c.includes("word count"));
    expect(wcConstraint).toBeDefined();
    expect(wcConstraint).toContain("12");
  });

  it("includes char position constraint when present", () => {
    const ch = makeChallenge({ charPosition: [25, "x"] });
    const fmt = formatChallengeForAgent(ch);
    const cpConstraint = fmt.constraints.find(c => c.includes("position 25"));
    expect(cpConstraint).toBeDefined();
    expect(cpConstraint).toContain("'x'");
  });

  it("includes total chars constraint when present", () => {
    const ch = makeChallenge({ totalChars: 95 });
    const fmt = formatChallengeForAgent(ch);
    const tcConstraint = fmt.constraints.find(c => c.includes("character count"));
    expect(tcConstraint).toBeDefined();
    expect(tcConstraint).toContain("95");
  });

  it("always adds semantic coherence constraint", () => {
    const ch = makeChallenge();
    const fmt = formatChallengeForAgent(ch);
    const lastConstraint = fmt.constraints[fmt.constraints.length - 1];
    expect(lastConstraint).toContain("semantically coherent");
  });

  it("formats different format names correctly", () => {
    const formats = [
      { format: "haiku", expected: "HAIKU (3 lines)" },
      { format: "quatrain", expected: "QUATRAIN (4 lines, rhyming)" },
      { format: "free_verse_3", expected: "FREE VERSE (3 lines)" },
      { format: "free_verse_4", expected: "FREE VERSE (4 lines)" },
      { format: "micro_story", expected: "MICRO-STORY (exactly 3 sentences)" },
    ];
    for (const { format, expected } of formats) {
      const ch = makeChallenge({ format });
      const fmt = formatChallengeForAgent(ch);
      expect(fmt.prompt).toContain(expected);
    }
  });
});
