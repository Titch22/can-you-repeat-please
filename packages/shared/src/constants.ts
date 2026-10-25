export const MAX_PLAYERS = 8;
/** An on/off environment variable: "true", "1", "yes" or "on" (any case); off otherwise. */
export const envFlag = (value: string | undefined) => /^(true|1|yes|on)$/i.test(value ?? '');
/** Open rooms on one server (default; MAX_ROOMS env): beyond, room:create fails with SERVER_FULL. */
export const MAX_ROOMS = 20;
/** All room audio (uploads + recordings) on the server's disk at once. */
export const MAX_TMP_BYTES = 2 * 1024 * 1024 * 1024;
export const MIN_PLAYERS = 2;
/** Teams mode: at least two teams, so there is always someone else's team to vote for. */
export const MIN_PLAYERS_TEAMS = 3;
export const MAX_VOTES_PER_PLAYER = 2;
export const ROOM_CODE_LENGTH = 4;
export const RECONNECT_GRACE_MS = 30_000;
export const ROOM_IDLE_TIMEOUT_MS = 30 * 60_000;

/** Longest recording window: the longest custom sound plus the max extra recording time. */
export const MAX_RECORDING_MS = 23_000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CUSTOM_SOUND_MS = 20_000;
export const MIN_CUSTOM_SOUND_MS = 200;
/** Safety net against filling the disk; there is no per-player limit. */
export const MAX_CUSTOM_SOUNDS_PER_ROOM = 200;
/** Prefix of library sound ids inside a room's selection (`lib:2-hours-later`). */
export const LIBRARY_ID_PREFIX = 'lib:';
export const MAX_TAGS_PER_SOUND = 20;
/** Library sounds with this tag (and lines for both characters) are Teams mode dialogues. */
export const TEAM_TAG = 'team';
export const MAX_DIALOGUE_LINES = 30;
export const MIN_DIALOGUE_LINE_MS = 300;
/** Speech recognition input (POST /v1/transcribe): mono float32 samples at this rate. */
export const TRANSCRIBE_SAMPLE_RATE = 16_000;
/** How long after the recording window uploads are still accepted. */
export const RECORDING_UPLOAD_GRACE_MS = 3_000;
