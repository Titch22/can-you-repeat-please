import { RateLimiter } from '@cyrp/shared';

/** Per-client rate limits. Tests pass looser ones. */
export interface Limits {
  /** room:create and room:join, per IP. */
  enterRoom: RateLimiter;
  /** Room sound uploads, per IP. */
  upload: RateLimiter;
  /** Any socket event, per connection. */
  socketEvents: RateLimiter;
  /** Sign-up, login and password change, per IP. */
  auth: RateLimiter;
}

/** No practical limit: for the end-to-end tests, which run every player from one address. */
export const noLimits = (): Limits => ({
  enterRoom: new RateLimiter(1e9, 1),
  upload: new RateLimiter(1e9, 1),
  socketEvents: new RateLimiter(1e9, 1),
  auth: new RateLimiter(1e9, 1),
});

export const defaultLimits = (): Limits => ({
  enterRoom: new RateLimiter(10, 6_000), // 10 at once, then 10 per minute
  upload: new RateLimiter(30, 2_000), // 30 at once, then 30 per minute
  socketEvents: new RateLimiter(40, 50), // bursts of 40, then 20 per second
  auth: new RateLimiter(10, 6_000), // 10 at once, then 10 per minute
});
