/** Result of a rate limit check, indicating whether the request is allowed. */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

/** In-memory sliding-window rate limiter keyed by API key ID. */
export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private windowMs = 60_000; // 60 seconds

  /**
   * Check whether a request is within the rate limit for a given key.
   * @param keyId - The API key ID to check.
   * @param limit - Maximum requests allowed per window.
   * @returns The rate limit result with remaining count and reset time.
   */
  checkRate(keyId: string, limit: number): RateLimitResult {
    const now = Date.now();
    const entry = this.windows.get(keyId);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      // New window
      this.windows.set(keyId, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(now + this.windowMs),
      };
    }

    // Existing window
    entry.count++;
    const resetAt = new Date(entry.windowStart + this.windowMs);

    if (entry.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    return {
      allowed: true,
      remaining: limit - entry.count,
      resetAt,
    };
  }

  /** Reset the rate limit window for a key. */
  reset(keyId: string): void {
    this.windows.delete(keyId);
  }
}
