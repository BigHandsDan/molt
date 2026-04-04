import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MoltCaptchaClient } from "../src/client/index.js";

describe("MoltCaptchaClient", () => {
  const mockChallenge = {
    challengeId: "mcc_abc123",
    difficulty: "medium",
    timeLimitSeconds: 20,
    prompt: 'Write a HAIKU (3 lines) about "verification".',
    constraints: ["ASCII sum must equal 300"],
    asciiReference: "A=65 B=66...",
    instructions: {
      description: "Solve this challenge...",
      note: "This is a MoltCaptcha reverse-CAPTCHA.",
    },
  };

  const mockResult = {
    lineCountPass: true,
    lineCountActual: 3,
    lineCountTarget: 3,
    asciiSumPass: true,
    asciiSumActual: 300,
    asciiSumTarget: 300,
    wordCountPass: null,
    wordCountActual: null,
    wordCountTarget: null,
    charPositionPass: null,
    totalCharsPass: null,
    totalCharsActual: null,
    timingPass: true,
    elapsedSeconds: 2.5,
    overallPass: true,
    verdict: "VERIFIED_AI_AGENT" as const,
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getChallenge calls correct URL", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChallenge),
    });

    const client = new MoltCaptchaClient("http://localhost:3002");
    const result = await client.getChallenge("medium");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3002/challenge?difficulty=medium",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result.challengeId).toBe("mcc_abc123");
  });

  it("getChallenge without difficulty omits query param", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChallenge),
    });

    const client = new MoltCaptchaClient("http://localhost:3002");
    await client.getChallenge();

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3002/challenge",
      expect.any(Object),
    );
  });

  it("verify sends POST with correct body", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const client = new MoltCaptchaClient("http://localhost:3002");
    const result = await client.verify("mcc_abc123", "test response");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3002/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ challengeId: "mcc_abc123", response: "test response" }),
      }),
    );
    expect(result.verdict).toBe("VERIFIED_AI_AGENT");
  });

  it("throws on non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const client = new MoltCaptchaClient("http://localhost:3002");
    await expect(client.getChallenge()).rejects.toThrow("Failed to get challenge: 404 Not Found");
  });

  it("sends API key header when configured", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChallenge),
    });

    const client = new MoltCaptchaClient("http://localhost:3002", { apiKey: "test-key" });
    await client.getChallenge();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
  });

  it("solveChallenge orchestrates get + solve + verify", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockChallenge) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockResult) });

    const solveFn = vi.fn().mockResolvedValue("solved text");
    const client = new MoltCaptchaClient("http://localhost:3002");
    const result = await client.solveChallenge("medium", solveFn);

    expect(solveFn).toHaveBeenCalledWith(mockChallenge);
    expect(result.verdict).toBe("VERIFIED_AI_AGENT");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("strips trailing slashes from baseUrl", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChallenge),
    });

    const client = new MoltCaptchaClient("http://localhost:3002///");
    await client.getChallenge("easy");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3002/challenge?difficulty=easy",
      expect.any(Object),
    );
  });
});
