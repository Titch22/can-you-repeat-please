import { MAX_CUSTOM_SOUND_MS, MAX_CUSTOM_SOUNDS_PER_ROOM, type ErrorCode } from '@cyrp/shared';

const MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'This room does not exist (anymore).',
  SESSION_EXPIRED: 'Your seat in this room has expired.',
  INTERNAL: 'Something went wrong. Please try again.',
  ROOM_FULL: 'This room is full.',
  NOT_HOST: 'Only the host can do that.',
  WRONG_PHASE: 'You can’t do that right now.',
  INVALID_PAYLOAD: 'Invalid input.',
  NICKNAME_TAKEN: 'Someone in this room already uses that nickname.',
  FILE_TOO_LARGE: 'That file is too large (2 MB max).',
  UNSUPPORTED_FORMAT: 'That file isn’t a supported sound (mp3, ogg, wav, webm, m4a).',
  TOO_MANY_SOUNDS: `This room has reached the upload limit (${MAX_CUSTOM_SOUNDS_PER_ROOM} sounds).`,
  SOUND_TOO_LONG: `That sound is too long (${MAX_CUSTOM_SOUND_MS / 1000} seconds max).`,
  ALREADY_SUBMITTED: 'Already submitted.',
  CANNOT_VOTE_SELF: 'You can’t vote for yourself.',
  TOO_MANY_VOTES: 'You can only vote for 2 recordings.',
  NOT_ENOUGH_PLAYERS: 'You need at least 2 players to start.',
  NOT_ENOUGH_SOUNDS: 'Tick at least one sound to play with.',
  NO_DIALOGUES:
    'Teams mode needs at least one ticked dialogue (a sound tagged “team” with its lines).',
  SERVER_FULL: 'All rooms are taken right now. Try again in a few minutes.',
  RATE_LIMITED: 'Slow down! Too many attempts, wait a minute and try again.',
  LIBRARY_UNAVAILABLE: 'The sound library is unavailable right now. Try again in a moment.',
  SPECTATOR: 'You’re watching this game; you’ll play in the next one.',
};

export const errorMessage = (code: ErrorCode) => MESSAGES[code] ?? MESSAGES.INTERNAL;
