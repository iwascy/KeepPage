type RateLimitBucket = {
  count: number;
  resetAt: number;
};

/**
 * Simple in-process fixed-window rate limiter.
 * Suitable for single-instance API; multi-instance needs redis later.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly max: number;
  private readonly windowMs: number;
  private hitsSinceSweep = 0;
  private readonly sweepEveryHits: number;

  constructor(options: { max: number; windowMs: number; sweepEveryHits?: number }) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.sweepEveryHits = options.sweepEveryHits ?? 64;
  }

  /**
   * @returns remaining attempts after this hit; `allowed=false` when limited
   */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    this.maybeSweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1, retryAfterSec: Math.ceil(this.windowMs / 1000) };
    }

    if (existing.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    this.buckets.set(key, existing);
    return {
      allowed: true,
      remaining: Math.max(0, this.max - existing.count),
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  private maybeSweep(now: number) {
    this.hitsSinceSweep += 1;
    if (this.hitsSinceSweep < this.sweepEveryHits) {
      return;
    }
    this.hitsSinceSweep = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
