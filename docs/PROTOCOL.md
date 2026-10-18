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
  mode: 'classic' | 'teams'; // see GAME_DESIGN.md, Game modes
  rounds: number; // 1–20
  selectedSoundIds: string[]; // sounds ticked for the game; none by default
  extraRecordMs: number; // 0–3000
  votingMs: number; // 10000–60000
}

interface SoundRef {
  id: string;
  label: string;
  durationMs: number;
  url: string;
  uploadedBy?: string;
  tags?: string[]; // library sounds
  lines?: DialogueLine[]; // library dialogues (the reference carries them in Teams mode)
}

// Teams mode
type Speaker = 'A' | 'B';
type Role = Speaker | 'both'; // 'both': a player alone in their team
interface DialogueLine {
  startMs: number; // from the start of the file
  endMs: number;
  speaker: Speaker;
}
interface Team {
  id: string;
  members: { playerId: string; role: Role }[];
}

// What players vote for: a recording (classic), or a team's recordings (teams), stitched by
// the reference's lines when played.
interface Performance {
  id: string; // the recording's id (classic) or the team's id (teams)
  playerIds: string[]; // they all score its votes
  parts: { playerId: string; url: string; role: Role | null }[]; // role null in classic
  durationMs: number;
}

type PlaybackItem =
  | { kind: 'reference'; url: string; durationMs: number }
  | { kind: 'performance'; performance: Performance; durationMs: number };

interface RoomState {
  code: string;
  players: Player[];
  settings: Settings;
  sounds: SoundRef[]; // this room's uploads (uploadedBy set); library sounds come from the sounds API
  phase: Phase;
  voiceMuted: boolean; // voice chat muted by the game (recording)
  deadline: number | null; // end of the current phase, server epoch ms
  round: number; // 1-based, 0 in the lobby
  reference: (SoundRef & { startsAt: number }) | null;
  recording: { startsAt: number; endsAt: number } | null; // window after the 3-2-1
  submittedPlayerIds: string[]; // whose recording arrived this round
  playback: { items: PlaybackItem[]; index: number; startsAt: number } | null;
  teams: Team[] | null; // Teams mode, from the round intro on
  performances: Performance[]; // playback order; PLAYBACK, VOTING and ROUND_RESULTS only
  myPerformanceId: string | null; // per viewer: theirs or their team's
  myVotes: string[]; // per viewer
  votedPlayerIds: string[]; // who has voted (not what they voted for)
  roundResults: { performanceId: string; playerIds: string[]; votes: number }[] | null;
}
```

## Socket.IO events

### Client → server

Every event takes an ack callback that receives `{ ok: true, ... } | { ok: false, error: string }`.

| Event                 | Payload                                                      | Ack                                | Who                                                    |
| --------------------- | ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| `room:create`         | `{ nickname, color }`                                        | `{ code, playerId, sessionToken }` | anyone                                                 |
| `room:join`           | `{ code, nickname, color }`                                  | `{ playerId, sessionToken }`       | anyone                                                 |
| `room:resume`         | `{ code, sessionToken }`                                     | `{ playerId }`                     | a player reconnecting                                  |
| `room:leave`          | `{}`                                                         |                                    | player                                                 |
| `room:updateSettings` | `Partial<Settings>`                                          |                                    | host, lobby only                                       |
| `room:kick`           | `{ playerId }`                                               |                                    | host                                                   |
| `room:deleteSound`    | `{ soundId }`                                                |                                    | the uploader or the host, lobby only                   |
| `game:start`          | `{}`                                                         |                                    | host, lobby only                                       |
| `game:vote`           | `{ clipIds: string[] }` (performance ids, 0–2, not your own) |                                    | player, VOTING only; can be re-sent to change the vote |
| `game:backToLobby`    | `{}`                                                         |                                    | host, FINAL_RESULTS only                               |
| `debug:setVoiceMuted` | `{ muted: boolean }`                                         |                                    | host; dev builds only (`NODE_ENV !== 'production'`)    |
| `time:sync`           | `{ clientTime }`                                             | `{ clientTime, serverTime }`       | anyone                                                 |

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

| Method | Route                                      | Body                       | Response         | Notes                                                                                                                                                                                    |
| ------ | ------------------------------------------ | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                              |                            | `{ ok: true }`   |                                                                                                                                                                                          |
| `POST` | `/api/rooms/:code/voice-token`             |                            | `{ url, token }` | LiveKit URL (`LIVEKIT_PUBLIC_URL`) and a 15-min JWT for room `cyrp-<code>`; no publish right while `voiceMuted`                                                                          |
| `POST` | `/api/rooms/:code/sounds?label=<name>`     | raw audio bytes            | `SoundRef`       | Lobby only; ≤2 MB, 0.2–20s (measured by the server), ≤200 per room (one file per request). Errors: 409 `TOO_MANY_SOUNDS` / `WRONG_PHASE`, 415 `UNSUPPORTED_FORMAT`, 422 `SOUND_TOO_LONG` |
| `POST` | `/api/rooms/:code/rounds/:round/recording` | raw audio bytes (the blob) | `{ ok: true }`   | During RECORDING (until 3s after the window); ≤2 MB; one per player per round. Format sniffed from the bytes: webm, ogg, wav, mp4/m4a, mp3                                               |
| `GET`  | `/api/rooms/:code/audio/:fileId`           |                            | audio bytes      | Recordings and custom sounds. `?download=<name>` sends it as an attachment named `<name>.<ext>`                                                                                          |

### Error codes

`ROOM_NOT_FOUND`, `SESSION_EXPIRED` (resume after the grace period), `INTERNAL`, `ROOM_FULL`, `NOT_HOST`, `WRONG_PHASE`, `INVALID_PAYLOAD`, `NICKNAME_TAKEN`, `FILE_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `TOO_MANY_SOUNDS`, `SOUND_TOO_LONG`, `ALREADY_SUBMITTED`, `CANNOT_VOTE_SELF`, `TOO_MANY_VOTES`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_SOUNDS`, `LIBRARY_UNAVAILABLE` (the sounds service didn't answer when the game started), `NO_DIALOGUES` (Teams mode without a ticked dialogue), `SPECTATOR`.

HTTP errors use the same codes in `{ ok: false, error }`, with status 401 (no seat), 409 (wrong phase, already submitted), 403 (spectator), 413 (too large) or 415 (format).

## Sounds API (apps/sounds)

The sound library service, on its own origin (`SOUNDS_PUBLIC_URL`, e.g. `https://sounds.example.com`; `/sounds-api` through the Vite proxy in development). Reads are public (CORS for the game origin); writes need `Authorization: Bearer <SOUNDS_ADMIN_TOKEN>`. Errors are `{ ok: false, error }` with `UNAUTHORIZED` (401), `NOT_FOUND` (404), `INVALID_PAYLOAD` (400), `FILE_TOO_LARGE` (413), `UNSUPPORTED_FORMAT` (415), `SOUND_TOO_LONG` (422) or `DUPLICATE` (409).

```ts
interface LibrarySound {
  id: string; // "2-hours-later"; inside a room selection it is prefixed: "lib:2-hours-later"
  label: string;
  durationMs: number;
  tags: string[]; // lowercase: letters, digits, spaces, dashes; 24 chars max
  lines: DialogueLine[]; // Teams mode dialogues (tag "team"); [] for other sounds
  url: string; // `${SOUNDS_PUBLIC_URL}/files/<sha256>.<ext>`
}
```

| Method   | Route                                 | Body                        | Response             | Notes                                                                                                                     |
| -------- | ------------------------------------- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/health`                             |                             | `{ ok, sounds }`     |                                                                                                                           |
| `GET`    | `/v1/sounds?tag=&minMs=&maxMs=&q=`    |                             | `LibrarySound[]`     | All filters optional. `tag` repeats (or comma-separated): sounds having **any** of them. Cached 15s                       |
| `GET`    | `/v1/sounds/:id`                      |                             | `LibrarySound`       |                                                                                                                           |
| `POST`   | `/v1/sounds/lookup`                   | `{ ids: string[] }`         | `LibrarySound[]`     | Read-only batch lookup (the game server resolves a selection with it). Unknown ids are left out                           |
| `GET`    | `/v1/tags`                            |                             | `{ name, count }[]`  | Cached 15s                                                                                                                |
| `GET`    | `/files/<sha256>.<ext>`               |                             | audio bytes          | Named after the content hash, so never changes: `Cache-Control: public, max-age=31536000, immutable`                      |
| `GET`    | `/v1/admin`                           |                             | `{ ok: true }`       | **Admin.** Checks a token                                                                                                 |
| `POST`   | `/v1/sounds?label=<name>&tag=a&tag=b` | raw audio bytes             | `LibrarySound` (201) | **Admin.** Same rules as room uploads (≤2 MB, 0.2–20s). 409 `DUPLICATE` with `{ sound }` if the same file exists          |
| `PATCH`  | `/v1/sounds/:id`                      | `{ label?, tags?, lines? }` | `LibrarySound`       | **Admin.** `tags` and `lines` replace the whole list. Lines: in order, not overlapping, ≥0.3s each, ≤30, within the sound |
| `DELETE` | `/v1/sounds/:id`                      |                             | `{ ok: true }`       | **Admin.** The file is deleted once no sound uses it. Games already started keep working until they end                   |
