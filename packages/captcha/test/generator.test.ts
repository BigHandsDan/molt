import { describe, it, expect } from "vitest";
import { generateChallenge } from "../src/engine/generator.js";
import { TOPICS, FORMATS, DIFFICULTIES } from "../src/engine/constants.js";

describe("generateChallenge", () => {
  it("returns a challenge with correct structure", () => {
    const ch = generateChallenge("medium");
    expect(ch.id).toMatch(/^mcc_[a-f0-9]{32}$/);
    expect(ch.topic).toBeDefined();
    expect(ch.format).toBeDefined();
    expect(ch.lineCount).toBeGreaterThanOrEqual(3);
    expect(ch.lineCount).toBeLessThanOrEqual(4);
    expect(ch.asciiTarget).toBeGreaterThanOrEqual(280);
    expect(ch.timeLimitSeconds).toBe(20);
    expect(ch.difficulty).toBe("medium");
    expect(ch.createdAt).toBeGreaterThan(0);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateChallenge().id));
    expect(ids.size).toBe(50);
  });

  it("picks topic from TOPICS array", () => {
    for (let i = 0; i < 20; i++) {
      const ch = generateChallenge();
      expect(TOPICS).toContain(ch.topic);
    }
  });

  it("picks format from FORMATS array", () => {
    const formatNames = FORMATS.map(([name]) => name);
    for (let i = 0; i < 20; i++) {
      const ch = generateChallenge();
      expect(formatNames).toContain(ch.format);
    }
  });

  describe("difficulty: easy", () => {
    it("has 30s time limit and only ascii constraint", () => {
      const ch = generateChallenge("easy");
      expect(ch.timeLimitSeconds).toBe(30);
      expect(ch.wordCount).toBeNull();
      expect(ch.charPosition).toBeNull();
      expect(ch.totalChars).toBeNull();
    });
  });

  describe("difficulty: medium", () => {
    it("has 20s time limit and ascii + word_count", () => {
      const ch = generateChallenge("medium");
      expect(ch.timeLimitSeconds).toBe(20);
      expect(ch.wordCount).toBeTypeOf("number");
      expect(ch.charPosition).toBeNull();
      expect(ch.totalChars).toBeNull();
    });
  });

  describe("difficulty: hard", () => {
    it("has 15s time limit and ascii + word_count + char_position", () => {
      const ch = generateChallenge("hard");
      expect(ch.timeLimitSeconds).toBe(15);
      expect(ch.wordCount).toBeTypeOf("number");
      expect(ch.charPosition).not.toBeNull();
      expect(ch.charPosition![0]).toBeGreaterThanOrEqual(10);
      expect(ch.charPosition![0]).toBeLessThanOrEqual(50);
      expect(ch.charPosition![1]).toMatch(/^[a-z]$/);
      expect(ch.totalChars).toBeNull();
    });
  });

  describe("difficulty: extreme", () => {
    it("has 10s time limit and all constraints", () => {
      const ch = generateChallenge("extreme");
      expect(ch.timeLimitSeconds).toBe(10);
      expect(ch.wordCount).toBeTypeOf("number");
      expect(ch.charPosition).not.toBeNull();
      expect(ch.totalChars).toBeTypeOf("number");
    });
  });

  it("defaults to medium for unknown difficulty", () => {
    const ch = generateChallenge("nonexistent");
    expect(ch.difficulty).toBe("medium");
    expect(ch.timeLimitSeconds).toBe(20);
  });

  it("ASCII target range matches line count", () => {
    for (let i = 0; i < 30; i++) {
      const ch = generateChallenge("easy");
      if (ch.lineCount === 3) {
        expect(ch.asciiTarget).toBeGreaterThanOrEqual(280);
        expect(ch.asciiTarget).toBeLessThanOrEqual(320);
      } else {
        expect(ch.asciiTarget).toBeGreaterThanOrEqual(380);
        expect(ch.asciiTarget).toBeLessThanOrEqual(420);
      }
    }
  });

  it("word count range matches line count for medium", () => {
    for (let i = 0; i < 30; i++) {
      const ch = generateChallenge("medium");
      if (ch.lineCount === 3) {
        expect(ch.wordCount).toBeGreaterThanOrEqual(9);
        expect(ch.wordCount).toBeLessThanOrEqual(16);
      } else {
        expect(ch.wordCount).toBeGreaterThanOrEqual(12);
        expect(ch.wordCount).toBeLessThanOrEqual(22);
      }
    }
  });
});
