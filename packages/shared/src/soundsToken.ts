import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who may write to the sounds service. The game server (which has the accounts) signs it with
 * SOUNDS_SECRET; the sounds service checks it. Server-only (node:crypto): import it as
 * `@cyrp/shared/soundsToken`, never from the browser.
 */
export interface SoundsTokenClaims {
  /** The account's id; 0 for the game server itself. */
  sub: number;
  /** Account admin: may manage the shared library (the game server is one too). */
  admin: boolean;
  /** Expiry, ms since the epoch. */
  exp: number;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function signSoundsToken(claims: SoundsTokenClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The claims of a valid, unexpired token; null otherwise. */
export function verifySoundsToken(
  token: string,
  secret: string,
  now = Date.now(),
): SoundsTokenClaims | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SoundsTokenClaims;
    return typeof claims.sub === 'number' && claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}
