import { describe, expect, it } from 'vitest';
import { signSoundsToken, verifySoundsToken } from './soundsToken';

describe('sounds token', () => {
  const claims = { sub: 7, admin: false, exp: 2_000 };

  it('round-trips, and refuses a forged, re-signed or expired token', () => {
    const token = signSoundsToken(claims, 'secret-1');
    expect(verifySoundsToken(token, 'secret-1', 1_000)).toEqual(claims);
    expect(verifySoundsToken(token, 'secret-2', 1_000)).toBeNull();
    expect(verifySoundsToken(token, 'secret-1', 2_000)).toBeNull();
    const [, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, admin: true })).toString('base64url');
    expect(verifySoundsToken(`${forged}.${mac}`, 'secret-1', 1_000)).toBeNull();
    expect(verifySoundsToken('nonsense', 'secret-1', 1_000)).toBeNull();
  });
});
