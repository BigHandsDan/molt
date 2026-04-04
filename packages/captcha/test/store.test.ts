import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryChallengeStore } from "../src/store/memory-store.js";
import type { Challenge } from "../src/engine/types.js";

function makeChallenge(overrides?: Partial<Challenge>): Challenge {
  return {
    id: `mcc_${Math.random().toString(16).slice(2).padEnd(32, "0")}`,
    topic: "test",
    format: "haiku",
    lineCount: 3,
    asciiTarget: 300,
    wordCount: null,
    charPosition: null,
    totalChars: null,
    timeLimitSeconds: 30,
    difficulty: "easy",
    createdAt: Date.now() / 1000,
    ...overrides,
  };
}

describe("MemoryChallengeStore", () => {
  let store: MemoryChallengeStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    store = new MemoryChallengeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves and retrieves a challenge", () => {
    const ch = makeChallenge();
    store.save(ch);
    expect(store.get(ch.id)).toEqual(ch);
  });

  it("returns null for unknown ID", () => {
    expect(store.get("mcc_nonexistent")).toBeNull();
  });

  it("consume returns and deletes challenge", () => {
    const ch = makeChallenge();
    store.save(ch);
    const consumed = store.consume(ch.id);
    expect(consumed).toEqual(ch);
    expect(store.get(ch.id)).toBeNull();
  });

  it("consume returns null for unknown ID", () => {
    expect(store.consume("mcc_nonexistent")).toBeNull();
  });

  it("consume is one-time: second call returns null", () => {
    const ch = makeChallenge();
    store.save(ch);
    expect(store.consume(ch.id)).toEqual(ch);
    expect(store.consume(ch.id)).toBeNull();
  });

  it("cleanup removes expired challenges", () => {
    const ch = makeChallenge({ timeLimitSeconds: 10 });
    store.save(ch);

    // Advance past expiry (timeLimitSeconds + 60 = 70 seconds)
    vi.advanceTimersByTime(71_000);
    const removed = store.cleanup();
    expect(removed).toBe(1);
    expect(store.get(ch.id)).toBeNull();
  });

  it("cleanup keeps valid challenges", () => {
    const ch = makeChallenge({ timeLimitSeconds: 30 });
    store.save(ch);

    // Only 10 seconds elapsed (< 30 + 60 = 90s expiry)
    vi.advanceTimersByTime(10_000);
    const removed = store.cleanup();
    expect(removed).toBe(0);
    expect(store.get(ch.id)).not.toBeNull();
  });

  it("lazy cleanup triggers on access after interval", () => {
    const ch = makeChallenge({ timeLimitSeconds: 5 });
    store.save(ch);

    // Advance past cleanup interval (60s) and expiry (5+60=65s)
    vi.advanceTimersByTime(70_000);

    // The next get triggers lazy cleanup
    expect(store.get(ch.id)).toBeNull();
  });
});
