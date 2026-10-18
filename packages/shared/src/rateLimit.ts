/**
 * Token bucket per key (an IP, a socket…): `capacity` actions at once, refilled at one action
 * every `refillMs`. In memory, so per server process. Used by the game and sounds servers.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private capacity: number,
    private refillMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Uses one action for `key`. False when it has none left (the action should be refused). */
  take(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) / this.refillMs);
    bucket.at = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.prune(now);
    return allowed;
  }

  /** True if `key` has no action left right now (without using one). */
  exhausted(key: string): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    return bucket.tokens + (this.now() - bucket.at) / this.refillMs < 1;
  }

  /** Drops a key (e.g. a closed connection). */
  forget(key: string) {
    this.buckets.delete(key);
  }

  /** Forgets keys whose bucket has refilled anyway. */
  private prune(now: number) {
    for (const [key, b] of this.buckets) {
      if (b.tokens + (now - b.at) / this.refillMs >= this.capacity) this.buckets.delete(key);
    }
  }
}

/**
 * The client's address behind one reverse proxy (nginx appends it to X-Forwarded-For), or the
 * socket's own address without a proxy.
 */
export function clientAddress(forwardedFor: string | string[] | undefined, remote: string) {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const last = header?.split(',').at(-1)?.trim();
  return last || remote;
}
