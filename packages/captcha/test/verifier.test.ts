import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MoltCaptcha } from "../src/index.js";
import type { Challenge } from "../src/engine/types.js";

describe("verifyResponse", () => {
  let captcha: MoltCaptcha;

  beforeEach(() => {
    captcha = new MoltCaptcha();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeResponse(challenge: Challenge): string {
    // Build a response that passes ASCII constraint
    const lines: string[] = [];
    let remaining = challenge.asciiTarget;
    for (let i = 0; i < challenge.lineCount - 1; i++) {
      // Use lowercase letters (97-122) for all but last line
      const charCode = Math.min(remaining - (challenge.lineCount - 1 - i) * 97, 122);
      const safeCode = Math.max(97, Math.min(122, charCode));
      lines.push(`${String.fromCharCode(safeCode)} word`);
      remaining -= safeCode;
    }
    const lastCode = Math.max(65, Math.min(122, remaining));
    lines.push(`${String.fromCharCode(lastCode)} word`);
    return lines.join("\n");
  }

  it("returns null for unknown challenge ID", () => {
    const result = captcha.verify("mcc_nonexistent", "some text");
    expect(result).toBeNull();
  });

  it("consumes challenge (one-time use)", () => {
    const challenge = captcha.generate("easy");
    const response = makeResponse(challenge);
    const result1 = captcha.verify(challenge.id, response);
    expect(result1).not.toBeNull();

    const result2 = captcha.verify(challenge.id, response);
    expect(result2).toBeNull();
  });

  it("passes ASCII sum check with correct response", () => {
    const challenge = captcha.generate("easy");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.asciiSumPass).toBe(true);
    expect(result!.asciiSumActual).toBe(challenge.asciiTarget);
    expect(result!.asciiSumTarget).toBe(challenge.asciiTarget);
  });

  it("fails ASCII sum check with wrong characters", () => {
    const challenge = captcha.generate("easy");
    // Build response with wrong ASCII sum
    const lines = Array.from({ length: challenge.lineCount }, () => "a test");
    const result = captcha.verify(challenge.id, lines.join("\n"));
    expect(result).not.toBeNull();
    // 'a' = 97, so sum = 97 * lineCount, which won't match target
    expect(result!.asciiSumPass).toBe(false);
  });

  it("passes timing check when within limit", () => {
    const challenge = captcha.generate("easy");
    // Still at t=0, well within 30s limit
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.timingPass).toBe(true);
  });

  it("fails timing check when over limit", () => {
    const challenge = captcha.generate("easy");
    // Advance time past 30s limit
    vi.advanceTimersByTime(31_000);
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.timingPass).toBe(false);
    expect(result!.overallPass).toBe(false);
    expect(result!.verdict).toBe("VERIFICATION_FAILED");
  });

  it("checks word count for medium difficulty", () => {
    const challenge = captcha.generate("medium");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.wordCountPass).toBeTypeOf("boolean");
    expect(result!.wordCountActual).toBeTypeOf("number");
    expect(result!.wordCountTarget).toBe(challenge.wordCount);
  });

  it("word count is null for easy difficulty", () => {
    const challenge = captcha.generate("easy");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.wordCountPass).toBeNull();
    expect(result!.wordCountActual).toBeNull();
  });

  it("checks char position for hard difficulty", () => {
    const challenge = captcha.generate("hard");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.charPositionPass).toBeTypeOf("boolean");
  });

  it("checks total chars for extreme difficulty", () => {
    const challenge = captcha.generate("extreme");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.totalCharsPass).toBeTypeOf("boolean");
    expect(result!.totalCharsActual).toBeTypeOf("number");
  });

  it("overall pass requires all active checks", () => {
    // Generate easy and craft perfect response
    const challenge = captcha.generate("easy");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    // ASCII pass + timing pass => overall pass
    expect(result!.asciiSumPass).toBe(true);
    expect(result!.timingPass).toBe(true);
    expect(result!.overallPass).toBe(true);
    expect(result!.verdict).toBe("VERIFIED_AI_AGENT");
  });

  it("verdict is VERIFICATION_FAILED when any check fails", () => {
    const challenge = captcha.generate("easy");
    vi.advanceTimersByTime(31_000); // fail timing
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("VERIFICATION_FAILED");
  });

  it("elapsed seconds is computed correctly", () => {
    const challenge = captcha.generate("easy");
    vi.advanceTimersByTime(5_000); // 5 seconds
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.elapsedSeconds).toBeCloseTo(5, 0);
  });

  it("passes line count check with correct number of lines", () => {
    const challenge = captcha.generate("easy");
    const response = makeResponse(challenge);
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.lineCountPass).toBe(true);
    expect(result!.lineCountActual).toBe(challenge.lineCount);
    expect(result!.lineCountTarget).toBe(challenge.lineCount);
  });

  it("fails line count check with wrong number of lines", () => {
    const challenge = captcha.generate("easy");
    // Build response with too many lines
    const lines = Array.from({ length: challenge.lineCount + 2 }, () => "a test");
    const result = captcha.verify(challenge.id, lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.lineCountPass).toBe(false);
    expect(result!.lineCountActual).toBe(challenge.lineCount + 2);
    expect(result!.overallPass).toBe(false);
  });

  it("handles empty response gracefully", () => {
    const challenge = captcha.generate("easy");
    const result = captcha.verify(challenge.id, "");
    expect(result).not.toBeNull();
    expect(result!.asciiSumActual).toBe(0);
    expect(result!.asciiSumPass).toBe(false);
    expect(result!.lineCountPass).toBe(false);
    expect(result!.lineCountActual).toBe(0);
  });

  it("trims and filters empty lines", () => {
    const challenge = captcha.generate("easy");
    // Build response with extra whitespace and blank lines
    const lines: string[] = [];
    let remaining = challenge.asciiTarget;
    for (let i = 0; i < challenge.lineCount - 1; i++) {
      const charCode = Math.min(remaining - (challenge.lineCount - 1 - i) * 97, 122);
      const safeCode = Math.max(97, Math.min(122, charCode));
      lines.push(`  ${String.fromCharCode(safeCode)} word  `);
      remaining -= safeCode;
    }
    const lastCode = Math.max(65, Math.min(122, remaining));
    lines.push(`  ${String.fromCharCode(lastCode)} word  `);

    const response = "\n" + lines.join("\n\n") + "\n";
    const result = captcha.verify(challenge.id, response);
    expect(result).not.toBeNull();
    expect(result!.asciiSumPass).toBe(true);
  });
});
