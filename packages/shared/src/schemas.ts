import { z } from 'zod';
import { MAX_TAGS_PER_SOUND, MAX_VOTES_PER_PLAYER, ROOM_CODE_LENGTH } from './constants.js';

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

export const NicknameSchema = z.string().trim().min(1).max(20);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`));

export const SettingsSchema = z.object({
  rounds: z.number().int().min(1).max(20),
  /** Sounds the host ticked for the game (`lib:` library ids or uploads). None by default. */
  selectedSoundIds: z.array(z.string().max(100)).max(2000),
  extraRecordMs: z.number().int().min(0).max(3000),
  votingMs: z.number().int().min(10_000).max(60_000),
});

export const DEFAULT_SETTINGS: z.infer<typeof SettingsSchema> = {
  rounds: 5,
  selectedSoundIds: [],
  extraRecordMs: 1000,
  votingMs: 20_000,
};

// Client → server payloads
export const RoomCreatePayload = z.object({ nickname: NicknameSchema, color: ColorSchema });
export const RoomJoinPayload = z.object({
  code: RoomCodeSchema,
  nickname: NicknameSchema,
  color: ColorSchema,
});
export const RoomResumePayload = z.object({ code: RoomCodeSchema, sessionToken: z.string() });
export const UpdateSettingsPayload = SettingsSchema.partial();
export const KickPayload = z.object({ playerId: z.string() });
export const DeleteSoundPayload = z.object({ soundId: z.string() });
export const VotePayload = z.object({
  clipIds: z.array(z.string()).max(MAX_VOTES_PER_PLAYER),
});
export const TimeSyncPayload = z.object({ clientTime: z.number() });
export const SetVoiceMutedPayload = z.object({ muted: z.boolean() });
export const SoundLabelSchema = z.string().trim().min(1).max(40);

// Sound library (apps/sounds)

/** A library tag: lowercase words, e.g. "meme", "animal", "movie quote". */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 -]{0,23}$/);
export const TagListSchema = z.array(TagSchema).max(MAX_TAGS_PER_SOUND);

export const LibrarySoundSchema = z.object({
  id: z.string(),
  label: z.string(),
  durationMs: z.number().int().positive(),
  tags: z.array(z.string()),
  /** Absolute (production) or root-relative (dev proxy) URL of the audio file. */
  url: z.string(),
});
export const TagCountSchema = z.object({ name: z.string(), count: z.number().int() });

/** PATCH /v1/sounds/:id */
export const LibrarySoundPatchSchema = z.object({
  label: SoundLabelSchema.optional(),
  tags: TagListSchema.optional(),
});
/** POST /v1/sounds/lookup */
export const LibraryLookupSchema = z.object({ ids: z.array(z.string().max(100)).max(2000) });
