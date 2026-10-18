import { describe, expect, it } from 'vitest';
import { clientAddress, RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  it('allows a burst of `capacity`, then refills one action per period', () => {
    let now = 0;
    const limit = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => limit.take('a'))).toEqual([true, true, true, false]);
    expect(limit.exhausted('a')).toBe(true);
    expect(limit.take('b')).toBe(true); // keys are independent
    now = 999;
    expect(limit.take('a')).toBe(false);
    now = 2000;
    expect(limit.take('a')).toBe(true);
    now = 100_000;
    expect([1, 2, 3, 4].map(() => limit.take('a'))).toEqual([true, true, true, false]);
  });
});

describe('clientAddress', () => {
  it('takes the address nginx appended, not one the client made up', () => {
    expect(clientAddress('6.6.6.6, 1.2.3.4', '127.0.0.1')).toBe('1.2.3.4');
    expect(clientAddress(['6.6.6.6', '1.2.3.4'], '127.0.0.1')).toBe('1.2.3.4');
    expect(clientAddress(undefined, '::1')).toBe('::1');
  });
});
