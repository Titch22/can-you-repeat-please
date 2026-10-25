import type { RequestHandler } from 'express';

/** "https://sounds.example.com/x" → "https://sounds.example.com"; relative paths → null. */
const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/**
 * Security headers for everything the game server sends, and the Content Security Policy of
 * the web app: scripts only from this origin (an injected script couldn't run, nor read the
 * admin token), connections only to this server, the sound library and LiveKit, no framing.
 */
export function securityHeaders(opts: {
  soundsPublicUrl?: string;
  livekitPublicUrl?: string;
}): RequestHandler {
  const sounds = originOf(opts.soundsPublicUrl);
  const livekit = originOf(opts.livekitPublicUrl);
  // LiveKit signals over wss:// and also calls https:// on the same host.
  const livekitHttp = livekit?.replace(/^ws/, 'http');
  const extra = (...origins: (string | null | undefined)[]) => origins.filter(Boolean).join(' ');

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // React sets style attributes (progress bars, avatar colors).
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `media-src 'self' blob: mediastream: ${extra(sounds)}`,
    // blob: the crop editor loads the picked file (in the browser's memory) with fetch.
    `connect-src 'self' blob: ${extra(sounds, livekit, livekitHttp)}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
}
