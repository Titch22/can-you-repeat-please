import { z } from 'zod';
import {
  MAX_DIALOGUE_LINES,
  MAX_TAGS_PER_SOUND,
  MAX_VOTES_PER_PLAYER,
  MIN_DIALOGUE_LINE_MS,
  MIN_DUB_CLIP_MS,
  ROOM_CODE_LENGTH,
} from './constants.js';

export const PhaseSchema = z.enum([
  'LOBBY',
  'ROUND_INTRO',
  'REFERENCE',
  'RECORDING',
  'PLAYBACK',
  'VOTING',
  'ROUND_RESULTS',
  'FINAL_RESULTS',
]);

/**
 * Text shown to other players: NFC-normalised, without control or invisible format characters
 * (zero-width spaces, bidi overrides…), so two names that look the same are the same.
 */
export const visibleText = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ''))
    .pipe(z.string().trim().min(1).max(max));

export const NicknameSchema = visibleText(20);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`));

/**
 * classic: everyone imitates the same sound. teams: pairs dub the two characters of a dialogue.
 * dub: everyone talks over a muted YouTube clip at once, and hears the mashup. No votes.
 */
export const GameModeSchema = z.enum(['classic', 'teams', 'dub']);

export const SettingsSchema = z.object({
  mode: GameModeSchema,
  rounds: z.number().int().min(1).max(20),
  /** Sounds the host ticked for the game (`lib:` library ids or uploads). None by default. */
  selectedSoundIds: z.array(z.string().max(100)).max(2000),
  extraRecordMs: z.number().int().min(0).max(3000),
  votingMs: z.number().int().min(10_000).max(60_000),
  /** Play the original again before the attempts (off suits long sounds). */
  replayReference: z.boolean(),
});

export const DEFAULT_SETTINGS: z.infer<typeof SettingsSchema> = {
  mode: 'classic',
  rounds: 5,
  selectedSoundIds: [],
  extraRecordMs: 1000,
  votingMs: 20_000,
  replayReference: false,
};

// Client → server payloads
export const RoomCreatePayload = z.object({
  nickname: NicknameSchema,
  color: ColorSchema,
});
export const RoomJoinPayload = z.object({
  code: RoomCodeSchema,
  nickname: NicknameSchema,
  color: ColorSchema,
});
export const RoomResumePayload = z.object({ code: RoomCodeSchema, sessionToken: z.string() });
export const UpdateSettingsPayload = SettingsSchema.partial();
export const KickPayload = z.object({ playerId: z.string() });
export const DeleteSoundPayload = z.object({ soundId: z.string() });
/** Logged-in players: share (or stop sharing) their own sounds, so the host can pick them. */
export const ShareSoundsPayload = z.object({ share: z.boolean() });
export const VotePayload = z.object({
  clipIds: z.array(z.string()).max(MAX_VOTES_PER_PLAYER),
});
export const TimeSyncPayload = z.object({ clientTime: z.number() });
export const SetVoiceMutedPayload = z.object({ muted: z.boolean() });
export const SoundLabelSchema = visibleText(40);

const YOUTUBE_ID = /^[\w-]{11}$/;

/** The video id of a YouTube link (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(link: string) {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? url.pathname === '/watch'
          ? url.searchParams.get('v')
          : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1]
        : null;
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** A YouTube clip for Dub mode: from `startMs` to `endMs` of the video. */
export const AddClipPayload = z
  .object({
    youtubeId: z.string().regex(YOUTUBE_ID),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    label: SoundLabelSchema,
  })
  .refine((c) => c.endMs - c.startMs >= MIN_DUB_CLIP_MS, { message: 'clip too short' });

/** Query of a recording upload: ms of it before the clip starts (Dub mode, negative if after). */
export const RecordingLeadSchema = z.coerce.number().int().min(-60_000).max(60_000).catch(0);

// Sound library (apps/sounds)

/** A library tag: lowercase words, e.g. "meme", "animal", "movie quote". */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 -]{0,23}$/);
export const TagListSchema = z.array(TagSchema).max(MAX_TAGS_PER_SOUND);

export const SpeakerSchema = z.enum(['A', 'B']);

/** One line of a dialogue: who speaks, from when to when (ms from the start of the file). */
export const DialogueLineSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  speaker: SpeakerSchema,
  /** What is said (subtitle); empty when not transcribed yet. */
  text: z.string().trim().max(200).default(''),
  /**
   * When each word of `text` starts (ms from the start of the file), for the karaoke. A word
   * ends where the next starts, the last one with the line. Empty: an even pace is assumed.
   */
  wordStartsMs: z.array(z.number().int().min(0)).max(100).default([]),
});

/**
 * Word starts made valid for a line from `startMs` to `endMs`: inside it, in order. For timings
 * from speech recognition (slightly off the line's edges) and after moving a line's edges.
 */
export function fitWordStarts(starts: number[], startMs: number, endMs: number) {
  let previous = startMs;
  return starts.map((t) => (previous = Math.min(endMs - 1, Math.max(previous, t))));
}

/** The words of a line's text, as the karaoke times them (whitespace-separated). */
export const textWords = (text: string) => text.match(/\S+/g) ?? [];

/** A dialogue's lines: in order, not overlapping, each long enough to say something. */
export const DialogueLinesSchema = z
  .array(DialogueLineSchema)
  .max(MAX_DIALOGUE_LINES)
  .superRefine((lines, ctx) => {
    lines.forEach((line, i) => {
      if (line.endMs - line.startMs < MIN_DIALOGUE_LINE_MS) {
        ctx.addIssue({ code: 'custom', path: [i], message: 'line too short' });
      }
      const prev = lines[i - 1];
      if (prev && line.startMs < prev.endMs) {
        ctx.addIssue({ code: 'custom', path: [i], message: 'lines overlap or are out of order' });
      }
      const starts = line.wordStartsMs;
      if (
        starts.length &&
        (starts.length !== textWords(line.text).length ||
          starts.some((t, j) => t < line.startMs || t >= line.endMs || t < (starts[j - 1] ?? 0)))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'wordStartsMs'],
          message: 'one start per word, in order, within the line',
        });
      }
    });
  });

export const LibrarySoundSchema = z.object({
  id: z.string(),
  label: z.string(),
  durationMs: z.number().int().positive(),
  tags: z.array(z.string()),
  /** Dialogue lines (Teams mode); empty for ordinary sounds. */
  lines: z.array(DialogueLineSchema).default([]),
  /** Absolute (production) or root-relative (dev proxy) URL of the audio file. */
  url: z.string(),
  /** Dialogues: the same scene without the voices (music and effects), played under the players. */
  backgroundUrl: z.string().nullable().default(null),
  /** Space on the server's disk: the file and its background, as counted in the quota. */
  bytes: z.number().int().default(0),
});
export const TagCountSchema = z.object({ name: z.string(), count: z.number().int() });

/** PATCH /v1/sounds/:id */
export const LibrarySoundPatchSchema = z.object({
  label: SoundLabelSchema.optional(),
  tags: TagListSchema.optional(),
  /** Replaces all lines; [] clears them. Must also end within the sound (checked by the server). */
  lines: DialogueLinesSchema.optional(),
});
/**
 * Language of a sound to transcribe. Whisper doesn't detect it reliably on such short clips:
 * without one it assumes English and translates to it.
 */
export const TranscriptLanguageSchema = z.enum(['french', 'english']);

/**
 * POST /v1/align: the sound as mono float32 samples at TRANSCRIBE_SAMPLE_RATE (base64; the
 * longest sound fits in 2 MB of base64), and the lines whose words to time.
 */
export const AlignRequestSchema = z.object({
  language: TranscriptLanguageSchema,
  samples: z.base64().max(2_000_000),
  lines: z
    .array(
      z.object({
        startMs: z.number().int().min(0),
        endMs: z.number().int().positive(),
        text: z.string().max(200),
      }),
    )
    .max(MAX_DIALOGUE_LINES),
});

/** POST /v1/sounds/lookup */
export const LibraryLookupSchema = z.object({
  ids: z.array(z.string().max(100)).max(2000),
  /** Users whose own sounds may be included (the game server only: players sharing theirs). */
  owners: z.array(z.number().int()).max(50).default([]),
});

// Accounts (game server, /api/account)

/** Letters (any script), digits, `_`, `.` and `-`; fits a nickname, so it can prefill one. */
export const UsernameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().regex(/^[\p{L}\p{N}_.-]{3,20}$/u));
export const PasswordSchema = z.string().min(8).max(200);

export const SignupSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  /** Needed unless sign-up is open (ACCOUNT_CREATION=open). */
  code: z.string().trim().max(64).optional(),
});
export const LoginSchema = z.object({
  username: z.string().max(100),
  password: z.string().max(200),
});
export const PasswordChangeSchema = z.object({
  oldPassword: z.string().max(200),
  newPassword: PasswordSchema,
});
export const InviteCountSchema = z.object({ count: z.number().int().min(1).max(50) });
