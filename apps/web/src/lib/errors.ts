import type { ErrorCode } from '@cyrp/shared';

const MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'This room does not exist (anymore).',
  SESSION_EXPIRED: 'Your seat in this room has expired.',
  INTERNAL: 'Something went wrong. Please try again.',
  ROOM_FULL: 'This room is full.',
  NOT_HOST: 'Only the host can do that.',
  WRONG_PHASE: 'You can’t do that right now.',
  INVALID_PAYLOAD: 'Invalid input.',
  NICKNAME_TAKEN: 'Someone in this room already uses that nickname.',
  FILE_TOO_LARGE: 'That file is too large.',
  UNSUPPORTED_FORMAT: 'That file format is not supported.',
  TOO_MANY_SOUNDS: 'You have uploaded too many sounds.',
  ALREADY_SUBMITTED: 'Already submitted.',
  CANNOT_VOTE_SELF: 'You can’t vote for yourself.',
  TOO_MANY_VOTES: 'You can only vote for 2 recordings.',
  NOT_ENOUGH_PLAYERS: 'You need at least 2 players to start.',
  NOT_ENOUGH_SOUNDS: 'There are no sounds to play with. Upload some or pick the default pack.',
  SPECTATOR: 'You’re watching this game; you’ll play in the next one.',
};

export const errorMessage = (code: ErrorCode) => MESSAGES[code] ?? MESSAGES.INTERNAL;
