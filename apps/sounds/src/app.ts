import { createHash, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  AlignRequestSchema,
  LibraryLookupSchema,
  LibrarySoundPatchSchema,
  MAX_CUSTOM_SOUND_MS,
  MAX_UPLOAD_BYTES,
  RateLimiter,
  SoundLabelSchema,
  TagListSchema,
  TRANSCRIBE_SAMPLE_RATE,
  TranscriptLanguageSchema,
  type LibraryErrorCode,
} from '@cyrp/shared';
import type { Aligner } from './align.js';
import type { Library } from './library.js';
import type { Transcriber } from './transcribe.js';
import { checkAudio, LibraryError } from './validate.js';

export interface SoundsAppOptions {
  library: Library;
  adminToken: string;
  clientOrigin: string[];
  /** Speech recognition for the admin's "Suggest text" (tests pass a fake). */
  transcribe: Transcriber;
  /** Word timings by forced alignment, for the karaoke (tests pass a fake). */
  align: Aligner;
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
  LENGTH_MISMATCH: 422,
  TRANSCRIPTION_FAILED: 503,
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

/** Longest transcription input: the longest sound, plus a margin. */
const MAX_TRANSCRIBE_SAMPLES = ((MAX_CUSTOM_SOUND_MS + 1000) / 1000) * TRANSCRIBE_SAMPLE_RATE;

/** A background may be this much longer or shorter than its sound (encoders pad a little). */
const BACKGROUND_TOLERANCE_MS = 250;

const UploadQuery = z.object({
  label: SoundLabelSchema,
  tag: listParam.pipe(TagListSchema),
});

export function createSoundsApp({
  library,
  adminToken,
  clientOrigin,
  transcribe,
  align,
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
  const uploadLimit: RequestHandler = (req, _res, next) => {
    if (!limits.upload.take(req.ip ?? '')) throw new LibraryError('RATE_LIMITED');
    next();
  };
  const rawAudio = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

  app.post('/v1/sounds', requireAdmin, uploadLimit, rawAudio, async (req, res) => {
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
  });

  app.patch('/v1/sounds/:id', requireAdmin, express.json(), (req, res) => {
    const patch = LibrarySoundPatchSchema.safeParse(req.body);
    if (!patch.success) throw new LibraryError('INVALID_PAYLOAD');
    const sound = library.update(String(req.params.id), patch.data);
    if (!sound) throw new LibraryError('NOT_FOUND');
    if (sound === 'LINES_OUT_OF_RANGE') throw new LibraryError('INVALID_PAYLOAD');
    audit(req, `edited ${sound.id} (${Object.keys(patch.data).join(', ')})`);
    res.json(sound);
  });

  // Raw audio body: the scene without the voices (Teams mode), as long as the sound itself.
  app.put('/v1/sounds/:id/background', requireAdmin, uploadLimit, rawAudio, async (req, res) => {
    const id = String(req.params.id);
    const sound = library.get(id);
    if (!sound) throw new LibraryError('NOT_FOUND');
    if (!Buffer.isBuffer(req.body)) throw new LibraryError('INVALID_PAYLOAD');
    const { format, durationMs } = await checkAudio(req.body);
    if (Math.abs(durationMs - sound.durationMs) > BACKGROUND_TOLERANCE_MS) {
      throw new LibraryError('LENGTH_MISMATCH');
    }
    const updated = library.setBackground(id, { data: req.body, format })!;
    audit(req, `set the background of ${id}`);
    res.json(updated);
  });

  app.delete('/v1/sounds/:id/background', requireAdmin, (req, res) => {
    const id = String(req.params.id);
    const sound = library.setBackground(id, null);
    if (!sound) throw new LibraryError('NOT_FOUND');
    audit(req, `removed the background of ${id}`);
    res.json(sound);
  });

  // Raw body: mono float32 samples at TRANSCRIBE_SAMPLE_RATE (the admin page decodes the sound;
  // no audio decoder needed here). Answers the words said, with their timings.
  app.post('/v1/transcribe', requireAdmin, uploadLimit, rawAudio, async (req, res) => {
    const language = TranscriptLanguageSchema.safeParse(req.query.language);
    const body = req.body as unknown;
    if (!language.success || !Buffer.isBuffer(body) || body.length === 0 || body.length % 4) {
      throw new LibraryError('INVALID_PAYLOAD');
    }
    if (body.length / 4 > MAX_TRANSCRIBE_SAMPLES) throw new LibraryError('SOUND_TOO_LONG');
    // Copied: a Float32Array needs a 4-byte aligned buffer, which Buffer doesn't guarantee.
    const samples = new Float32Array(new Uint8Array(body).buffer);
    let words;
    try {
      words = await transcribe(samples, language.data);
    } catch (err) {
      console.error('[transcribe] failed', err);
      throw new LibraryError('TRANSCRIPTION_FAILED');
    }
    audit(req, `transcribed ${(samples.length / TRANSCRIBE_SAMPLE_RATE).toFixed(1)}s`);
    res.json(words);
  });

  // JSON: the sound as base64 float32 samples, and the lines whose words to time.
  app.post(
    '/v1/align',
    requireAdmin,
    uploadLimit,
    express.json({ limit: '3mb' }),
    async (req, res) => {
      const body = AlignRequestSchema.safeParse(req.body);
      if (!body.success) throw new LibraryError('INVALID_PAYLOAD');
      const bytes = Buffer.from(body.data.samples, 'base64');
      if (bytes.length === 0 || bytes.length % 4) throw new LibraryError('INVALID_PAYLOAD');
      if (bytes.length / 4 > MAX_TRANSCRIBE_SAMPLES) throw new LibraryError('SOUND_TOO_LONG');
      const samples = new Float32Array(new Uint8Array(bytes).buffer);
      let wordStartsMs;
      try {
        wordStartsMs = await align(samples, body.data.language, body.data.lines);
      } catch (err) {
        console.error('[align] failed', err);
        throw new LibraryError('TRANSCRIPTION_FAILED');
      }
      audit(req, `aligned ${body.data.lines.length} lines`);
      res.json({ wordStartsMs });
    },
  );

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
