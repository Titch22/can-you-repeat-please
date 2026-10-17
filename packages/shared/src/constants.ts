export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const MAX_VOTES_PER_PLAYER = 2;
export const ROOM_CODE_LENGTH = 4;
export const RECONNECT_GRACE_MS = 30_000;
export const ROOM_IDLE_TIMEOUT_MS = 30 * 60_000;

export const MAX_RECORDING_MS = 10_000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CUSTOM_SOUND_MS = 10_000;
export const MAX_CUSTOM_SOUNDS_PER_PLAYER = 5;
/** How long after the recording window uploads are still accepted. */
export const RECORDING_UPLOAD_GRACE_MS = 3_000;

export const ALLOWED_AUDIO_MIME = [
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
] as const;
