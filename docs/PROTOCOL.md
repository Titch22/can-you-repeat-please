# Protocol

The source of truth is the set of zod schemas in `packages/shared/src/schemas.ts`. This document describes them; if the two ever disagree, the code wins.

## Core types

```ts
type Phase =
  | 'LOBBY'
  | 'ROUND_INTRO'
  | 'REFERENCE'
  | 'RECORDING'
  | 'PLAYBACK'
  | 'VOTING'
  | 'ROUND_RESULTS'
  | 'FINAL_RESULTS';

interface Player {
  id: string; // public id, used as the LiveKit identity
  nickname: string; // 1–20 chars
  color: string; // hex
  isHost: boolean;
  connected: boolean;
  isSpectator: boolean; // joined mid-game
  score: number;
}

interface Settings {
  rounds: number; // 1–20
  soundSource: 'default' | 'custom' | 'mixed';
  extraRecordMs: number; // 0–3000
  votingMs: number; // 10000–60000
}

interface SoundRef {
  id: string;
  label: string;
  durationMs: number;
  url: string;
  uploadedBy?: string;
}

interface PlaybackItem {
  kind: 'reference' | 'clip';
  clipId: string | null; // set for clips; what votes refer to
  playerId: string | null; // author of the clip (null for the reference)
  url: string;
  durationMs: number;
}

interface RoomState {
  code: string;
  players: Player[];
  settings: Settings;
  customSounds: SoundRef[];
  phase: Phase;
  voiceMuted: boolean; // voice chat muted by the game (recording)
  deadline: number | null; // end of the current phase, server epoch ms
  round: number; // 1-based, 0 in the lobby
  reference: (SoundRef & { startsAt: number }) | null;
  recording: { startsAt: number; endsAt: number } | null; // window after the 3-2-1
  submittedPlayerIds: string[]; // whose recording arrived this round
  playback: { items: PlaybackItem[]; index: number; startsAt: number } | null;
  clips: { id: string; url: string; durationMs: number; playerId: string }[]; // playback order
  myClipId: string | null; // per viewer
  myVotes: string[]; // per viewer
  votedPlayerIds: string[]; // who has voted (not what they voted for)
  roundResults: { clipId: string; playerId: string; votes: number; url: string }[] | null;
}
```

## Socket.IO events

### Client → server

Every event takes an ack callback that receives `{ ok: true, ... } | { ok: false, error: string }`.

| Event                 | Payload                                     | Ack                                | Who                                                    |
| --------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `room:create`         | `{ nickname, color }`                       | `{ code, playerId, sessionToken }` | anyone                                                 |
| `room:join`           | `{ code, nickname, color }`                 | `{ playerId, sessionToken }`       | anyone                                                 |
| `room:resume`         | `{ code, sessionToken }`                    | `{ playerId }`                     | a player reconnecting                                  |
| `room:leave`          | `{}`                                        |                                    | player                                                 |
| `room:updateSettings` | `Partial<Settings>`                         |                                    | host, lobby only                                       |
| `room:kick`           | `{ playerId }`                              |                                    | host                                                   |
| `room:deleteSound`    | `{ soundId }`                               |                                    | the uploader or the host, lobby only                   |
| `game:start`          | `{}`                                        |                                    | host, lobby only                                       |
| `game:vote`           | `{ clipIds: string[] }` (0–2, not your own) |                                    | player, VOTING only; can be re-sent to change the vote |
| `game:backToLobby`    | `{}`                                        |                                    | host, FINAL_RESULTS only                               |
| `debug:setVoiceMuted` | `{ muted: boolean }`                        |                                    | host; dev builds only (`NODE_ENV !== 'production'`)    |
| `time:sync`           | `{ clientTime }`                            | `{ clientTime, serverTime }`       | anyone                                                 |

### Server → client

| Event         | Payload              | When                                                                                |
| ------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `room:state`  | `RoomState`          | After any change; full snapshot                                                     |
| `room:kicked` | `{ reason }`         | The player was kicked                                                               |
| `room:closed` | `{}`                 | The room was closed                                                                 |
| `voice:mute`  | `{ muted: boolean }` | Sent at the same time as the RECORDING start and end, so clients can mute instantly |
| `error`       | `{ message }`        | Unexpected errors                                                                   |

## HTTP routes

Every route under `/api/rooms/:code/*` needs the header `X-Session-Token: <sessionToken>`. Routes used as `<audio src>` also accept `?t=<sessionToken>`.

| Method | Route                                      | Body                       | Response         | Notes                                                                                                                                      |
| ------ | ------------------------------------------ | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/health`                              |                            | `{ ok: true }`   |                                                                                                                                            |
| `POST` | `/api/rooms/:code/voice-token`             |                            | `{ url, token }` | LiveKit URL (`LIVEKIT_PUBLIC_URL`) and a 15-min JWT for room `cyrp-<code>`; no publish right while `voiceMuted`                            |
| `POST` | `/api/rooms/:code/sounds`                  | multipart `file`, `label`  | `SoundRef`       | Lobby only; ≤2 MB, ≤10s, ≤5 per player                                                                                                     |
| `POST` | `/api/rooms/:code/rounds/:round/recording` | raw audio bytes (the blob) | `{ ok: true }`   | During RECORDING (until 3s after the window); ≤2 MB; one per player per round. Format sniffed from the bytes: webm, ogg, wav, mp4/m4a, mp3 |
| `GET`  | `/api/rooms/:code/audio/:fileId`           |                            | audio bytes      | Recordings and custom sounds                                                                                                               |
| `GET`  | `/sounds/default/:file`                    |                            | audio bytes      | Static default pack, public                                                                                                                |

### Error codes

`ROOM_NOT_FOUND`, `SESSION_EXPIRED` (resume after the grace period), `INTERNAL`, `ROOM_FULL`, `NOT_HOST`, `WRONG_PHASE`, `INVALID_PAYLOAD`, `NICKNAME_TAKEN`, `FILE_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `TOO_MANY_SOUNDS`, `ALREADY_SUBMITTED`, `CANNOT_VOTE_SELF`, `TOO_MANY_VOTES`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_SOUNDS`, `SPECTATOR`.

HTTP errors use the same codes in `{ ok: false, error }`, with status 401 (no seat), 409 (wrong phase, already submitted), 403 (spectator), 413 (too large) or 415 (format).
