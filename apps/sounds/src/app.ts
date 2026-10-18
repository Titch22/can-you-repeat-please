import { createHash, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  LibraryLookupSchema,
  LibrarySoundPatchSchema,
  MAX_UPLOAD_BYTES,
  RateLimiter,
  SoundLabelSchema,
  TagListSchema,
  type LibraryErrorCode,
} from '@cyrp/shared';
import type { Library } from './library.js';
import { checkAudio, LibraryError } from './validate.js';

export interface SoundsAppOptions {
  library: Library;
  adminToken: string;
  clientOrigin: string[];
  /** Per-IP limits (tests pass their own). */
  limits?: { failedAuth: RateLimiter; upload: RateLimiter };
}

/** Listings never return more than this many sounds. */
export const MAX_LIST = 2000;

const STATUS: Record<LibraryErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INVALID_PAYLOAD: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  SOUND_TOO_LONG: 422,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
};

/** `?tag=a&tag=b` or `?tag=a,b` → ['a', 'b'] */
const listParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(',')).filter(Boolean),
  );
const msParam = z.coerce.number().int().min(0).optional();

const ListQuery = z.object({
  tag: listParam.pipe(TagListSchema),
  minMs: msParam,
  maxMs: msParam,
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST).default(MAX_LIST),
});

const UploadQuery = z.object({
  label: SoundLabelSchema,
  tag: listParam.pipe(TagListSchema),
});

export function createSoundsApp({
  library,
  adminToken,
  clientOrigin,
  limits = {
    failedAuth: new RateLimiter(10, 60_000), // 10 wrong tokens, then 1 more per minute
    upload: new RateLimiter(60, 1_000), // 60 at once, then 1 per second
  },
}: SoundsAppOptions) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Only JSON and audio are served here: nothing may run as a page or be framed.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(cors({ origin: clientOrigin, maxAge: 3600 }));

  const requireAdmin: RequestHandler = (req, _res, next) => {
    // Guessing the token: after a few failures from one address, refuse everything for a while.
    if (limits.failedAuth.exhausted(req.ip ?? '')) throw new LibraryError('RATE_LIMITED');
    const given = /^Bearer (.+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';
    // Compare digests: same length whatever was sent, and constant-time.
    const digest = (s: string) => createHash('sha256').update(s).digest();
    if (!adminToken || !timingSafeEqual(digest(given), digest(adminToken))) {
      limits.failedAuth.take(req.ip ?? '');
      console.warn(`[admin] rejected token from ${req.ip} (${req.method} ${req.path})`);
      throw new LibraryError('UNAUTHORIZED');
    }
    next();
  };
  /** Who changed what, in the container logs. */
  const audit = (req: express.Request, what: string) =>
    console.log(`[admin] ${req.ip} ${req.method} ${what}`);
  /** Short public caching for listings: admin edits show up within seconds. */
  const listCache: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=15');
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Audio files: named after their content hash, so they never change.
  app.use(
    '/files',
    express.static(library.filesDir, {
      immutable: true,
      maxAge: '365d',
      index: false,
      dotfiles: 'deny',
    }),
  );

  app.get('/v1/sounds', listCache, (req, res) => {
    const query = ListQuery.safeParse(req.query);
    if (!query.success) throw new LibraryError('INVALID_PAYLOAD');
    const { tag, ...rest } = query.data;
    res.json(library.list({ ...rest, tags: tag }));
  });

  app.get('/v1/tags', listCache, (_req, res) => {
    res.json(library.tags());
  });

  // A POST so the id list can be long; read-only (used by the game server when a game starts).
  app.post('/v1/sounds/lookup', express.json({ limit: '200kb' }), (req, res) => {
    const body = LibraryLookupSchema.safeParse(req.body);
    if (!body.success) throw new LibraryError('INVALID_PAYLOAD');
    res.json(library.lookup(body.data.ids));
  });

  app.get('/v1/sounds/:id', (req, res) => {
    const sound = library.get(req.params.id);
    if (!sound) throw new LibraryError('NOT_FOUND');
    res.json(sound);
  });

  // ── Admin ───────────────────────────────────────────────────────────────────

  /** Lets the admin page check a token. */
  app.get('/v1/admin', requireAdmin, (_req, res) => {
    res.json({ ok: true, sounds: library.count() });
  });

  // Raw audio body; ?label=<name>&tag=a&tag=b. 409 DUPLICATE (with the existing sound) if the
  // exact same file is already in the library.
  app.post(
    '/v1/sounds',
    requireAdmin,
    (req, _res, next) => {
      if (!limits.upload.take(req.ip ?? '')) throw new LibraryError('RATE_LIMITED');
      next();
    },
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const query = UploadQuery.safeParse(req.query);
      if (!query.success || !Buffer.isBuffer(req.body)) throw new LibraryError('INVALID_PAYLOAD');
      const { format, durationMs } = await checkAudio(req.body);
      const existing = library.findDuplicate(req.body);
      if (existing) {
        res.status(409).json({ ok: false, error: 'DUPLICATE', sound: existing });
        return;
      }
      const sound = library.add({
        label: query.data.label,
        tags: query.data.tag,
        durationMs,
        format,
        data: req.body,
      });
      audit(req, `added ${sound.id} "${sound.label}" [${sound.tags.join(', ')}]`);
      res.status(201).json(sound);
    },
  );

  app.patch('/v1/sounds/:id', requireAdmin, express.json(), (req, res) => {
    const patch = LibrarySoundPatchSchema.safeParse(req.body);
    if (!patch.success) throw new LibraryError('INVALID_PAYLOAD');
    const sound = library.update(String(req.params.id), patch.data);
    if (!sound) throw new LibraryError('NOT_FOUND');
    if (sound === 'LINES_OUT_OF_RANGE') throw new LibraryError('INVALID_PAYLOAD');
    audit(req, `edited ${sound.id} (${Object.keys(patch.data).join(', ')})`);
    res.json(sound);
  });

  app.delete('/v1/sounds/:id', requireAdmin, (req, res) => {
    if (!library.remove(String(req.params.id))) throw new LibraryError('NOT_FOUND');
    audit(req, `deleted ${String(req.params.id)}`);
    res.json({ ok: true });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof LibraryError) {
      res.status(STATUS[err.code]).json({ ok: false, error: err.code });
    } else if (err?.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
    } else if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD' });
    } else {
      // Never Express's HTML error page.
      console.error('[http] unhandled error', err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'INTERNAL' });
    }
  };
  app.use(onError);

  return app;
}
