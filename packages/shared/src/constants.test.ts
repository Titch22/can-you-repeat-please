import { describe, expect, it } from 'vitest';
import { envFlag } from './constants';

describe('envFlag', () => {
  it('is on only for an explicit yes', () => {
    for (const on of ['true', 'TRUE', '1', 'yes', 'on']) expect(envFlag(on)).toBe(true);
    for (const off of [undefined, '', 'false', '0', 'no', 'off', 'nope'])
      expect(envFlag(off)).toBe(false);
  });
});
