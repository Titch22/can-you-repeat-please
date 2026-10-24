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
  type MySounds,
} from '@cyrp/shared';
import { verifySoundsToken, type SoundsTokenClaims } from '@cyrp/shared/soundsToken';
import type { Aligner } from './align.js';
import type { Library, Owner } from './library.js';
import type { Transcriber } from './transcribe.js';
import { checkAudio, LibraryError } from './validate.js';

export interface SoundsAppOptions {
  library: Library;
  /** Checks the tokens the game server signs for logged-in users (SOUNDS_SECRET). */
  secret: string;
  /** Each user's sounds together, in bytes. */
  quotaBytes: number;
  clientOrigin: string[];
  /** Speech recognition for the admin's "Suggest text" (tests pass a fake). */
  transcribe: Transcriber;
  /** Word timings by forced alignment, for the karaoke (tests pass a fake). */
  align: Aligner;
  /** Per-IP (and per-user for speech) limits; tests pass their own. */
  limits?: { failedAuth: RateLimiter; upload: RateLimiter; speech: RateLimiter };
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
  QUOTA_EXCEEDED: 413,
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

/** "library": the shared library (admins); default: the user's own sounds. */
const ScopeParam = z.enum(['mine', 'library']).default('mine');

const UploadQuery = z.object({
  label: SoundLabelSchema,
  tag: listParam.pipe(TagListSchema),
  scope: ScopeParam,
});

export function createSoundsApp({
  library,
  secret,
  quotaBytes,
  clientOrigin,
  transcribe,
  align,
  limits = {
    failedAuth: new RateLimiter(10, 60_000), // 10 wrong tokens, then 1 more per minute
    upload: new RateLimiter(60, 1_000), // 60 at once, then 1 per second
    speech: new RateLimiter(20, 180_000), // per user: 20 at once, then 20 per hour
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

  const bearer = (req: express.Request) =>
    /^Bearer (.+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';
  /** A logged-in user (a token signed by the game server): `res.locals.auth`. */
  const requireUser: RequestHandler = (req, res, next) => {
    // Forged tokens: after a few failures from one address, refuse everything for a while.
    if (limits.failedAuth.exhausted(req.ip ?? '')) throw new LibraryError('RATE_LIMITED');
    const auth = verifySoundsToken(bearer(req), secret);
    if (!auth) {
      limits.failedAuth.take(req.ip ?? '');
      throw new LibraryError('UNAUTHORIZED');
    }
    res.locals.auth = auth;
    next();
  };
  const authOf = (res: express.Response) => res.locals.auth as SoundsTokenClaims;
  /** Whose sounds a request works on: the user's own, or the shared library (admins only). */
  const ownerFor = (res: express.Response, scope: 'mine' | 'library'): Owner => {
    const auth = authOf(res);
    if (scope === 'mine') return auth.sub;
    if (!auth.admin) throw new LibraryError('UNAUTHORIZED');
    return null;
  };
  /** Sound `id`, if this user may change it: their own, or a library one for admins. */
  const editable = (res: express.Response, id: string) => {
    const auth = authOf(res);
    const owner = library.ownerOf(id);
    // Other users' sounds look like they don't exist.
    if (owner === undefined || (owner === null ? !auth.admin : owner !== auth.sub)) {
      throw new LibraryError('NOT_FOUND');
    }
    return owner;
  };
  /** Throws QUOTA_EXCEEDED if `owner` (a user; the library has no quota) can't store `bytes` more. */
  const checkQuota = (owner: Owner, bytes: number) => {
    if (owner !== null && library.usedBytes(owner) + bytes > quotaBytes) {
      throw new LibraryError('QUOTA_EXCEEDED');
    }
  };
  /** Speech recognition and alignment are heavy: per user. */
  const speechLimit: RequestHandler = (_req, res, next) => {
    if (!limits.speech.take(`user:${authOf(res).sub}`)) throw new LibraryError('RATE_LIMITED');
    next();
  };
  /** Who changed what, in the container logs. */
  const audit = (req: express.Request, res: express.Response, what: string) =>
    console.log(`[sounds] user ${authOf(res).sub} (${req.ip}) ${req.method} ${what}`);
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
  // `owners`' own sounds are included for the game server only (its token: user 0, admin).
  app.post('/v1/sounds/lookup', express.json({ limit: '200kb' }), (req, res) => {
    const body = LibraryLookupSchema.safeParse(req.body);
    if (!body.success) throw new LibraryError('INVALID_PAYLOAD');
    const claims = verifySoundsToken(bearer(req), secret);
    const owners = claims?.admin && claims.sub === 0 ? body.data.owners : [];
    res.json(library.lookup(body.data.ids, owners));
  });

  app.get('/v1/sounds/:id', (req, res) => {
    const sound = library.ownerOf(req.params.id) === null ? library.get(req.params.id) : null;
    if (!sound) throw new LibraryError('NOT_FOUND');
    res.json(sound);
  });

  // ── Logged-in users (their own sounds; admins also manage the shared library) ──

  app.get('/v1/my/sounds', requireUser, (req, res) => {
    const scope = ScopeParam.safeParse(req.query.scope);
    if (!scope.success) throw new LibraryError('INVALID_PAYLOAD');
    const owner = ownerFor(res, scope.data);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      sounds: library.list({}, owner),
      usedBytes: library.usedBytes(owner),
      quotaBytes: owner === null ? null : quotaBytes,
    } satisfies MySounds);
  });

  // Raw audio body; ?label=<name>&tag=a&tag=b. 409 DUPLICATE (with the existing sound) if the
  // exact same file is already in the library.
  const uploadLimit: RequestHandler = (req, _res, next) => {
    if (!limits.upload.take(req.ip ?? '')) throw new LibraryError('RATE_LIMITED');
    next();
  };
  const rawAudio = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

  app.post('/v1/sounds', requireUser, uploadLimit, rawAudio, async (req, res) => {
    const query = UploadQuery.safeParse(req.query);
    if (!query.success || !Buffer.isBuffer(req.body)) throw new LibraryError('INVALID_PAYLOAD');
    const owner = ownerFor(res, query.data.scope);
    const { format, durationMs } = await checkAudio(req.body);
    checkQuota(owner, req.body.length);
    const existing = library.findDuplicate(req.body, owner);
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
      owner,
    });
    audit(req, res, `added ${sound.id} "${sound.label}" [${sound.tags.join(', ')}]`);
    res.status(201).json(sound);
  });

  app.patch('/v1/sounds/:id', requireUser, express.json(), (req, res) => {
    const patch = LibrarySoundPatchSchema.safeParse(req.body);
    if (!patch.success) throw new LibraryError('INVALID_PAYLOAD');
    editable(res, String(req.params.id));
    const sound = library.update(String(req.params.id), patch.data);
    if (!sound) throw new LibraryError('NOT_FOUND');
    if (sound === 'LINES_OUT_OF_RANGE') throw new LibraryError('INVALID_PAYLOAD');
    audit(req, res, `edited ${sound.id} (${Object.keys(patch.data).join(', ')})`);
    res.json(sound);
  });

  // Raw audio body: the scene without the voices (Teams mode), as long as the sound itself.
  app.put('/v1/sounds/:id/background', requireUser, uploadLimit, rawAudio, async (req, res) => {
    const id = String(req.params.id);
    const owner = editable(res, id);
    const sound = library.get(id)!;
    if (!Buffer.isBuffer(req.body)) throw new LibraryError('INVALID_PAYLOAD');
    const { format, durationMs } = await checkAudio(req.body);
    // The background it replaces doesn't count.
    const replaced = library.backgroundBytes(id) ?? 0;
    checkQuota(owner, req.body.length - replaced);
    if (Math.abs(durationMs - sound.durationMs) > BACKGROUND_TOLERANCE_MS) {
      throw new LibraryError('LENGTH_MISMATCH');
    }
    const updated = library.setBackground(id, { data: req.body, format })!;
    audit(req, res, `set the background of ${id}`);
    res.json(updated);
  });

  app.delete('/v1/sounds/:id/background', requireUser, (req, res) => {
    const id = String(req.params.id);
    editable(res, id);
    const sound = library.setBackground(id, null);
    if (!sound) throw new LibraryError('NOT_FOUND');
    audit(req, res, `removed the background of ${id}`);
    res.json(sound);
  });

  // Raw body: mono float32 samples at TRANSCRIBE_SAMPLE_RATE (the admin page decodes the sound;
  // no audio decoder needed here). Answers the words said, with their timings.
  app.post('/v1/transcribe', requireUser, speechLimit, rawAudio, async (req, res) => {
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
    audit(req, res, `transcribed ${(samples.length / TRANSCRIBE_SAMPLE_RATE).toFixed(1)}s`);
    res.json(words);
  });

  // JSON: the sound as base64 float32 samples, and the lines whose words to time.
  app.post(
    '/v1/align',
    requireUser,
    speechLimit,
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
      audit(req, res, `aligned ${body.data.lines.length} lines`);
      res.json({ wordStartsMs });
    },
  );

  app.delete('/v1/sounds/:id', requireUser, (req, res) => {
    editable(res, String(req.params.id));
    library.remove(String(req.params.id));
    audit(req, res, `deleted ${String(req.params.id)}`);
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
