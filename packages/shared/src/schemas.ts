import { z } from 'zod';
import { MAX_VOTES_PER_PLAYER, ROOM_CODE_LENGTH } from './constants.js';

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
  soundSource: z.enum(['default', 'custom', 'mixed']),
  extraRecordMs: z.number().int().min(0).max(3000),
  votingMs: z.number().int().min(10_000).max(60_000),
});

export const DEFAULT_SETTINGS: z.infer<typeof SettingsSchema> = {
  rounds: 5,
  soundSource: 'default',
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
