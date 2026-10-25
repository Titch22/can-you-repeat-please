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
  sharesSounds: boolean; // logged in (the socket's session cookie) and sharing their own sounds
}

interface Settings {
  mode: 'classic' | 'teams'; // see GAME_DESIGN.md, Game modes
  rounds: number; // 1–20
  selectedSoundIds: string[]; // sounds ticked for the game; none by default
  extraRecordMs: number; // 0–3000
  votingMs: number; // 10000–60000
  replayReference: boolean; // play the original again before the attempts
}

interface SoundRef {
  id: string;
  label: string;
  durationMs: number;
  url: string;
  uploadedBy?: string;
  tags?: string[]; // library sounds
  lines?: DialogueLine[]; // library dialogues (the reference carries them in Teams mode)
  backgroundUrl?: string | null; // library dialogues: the scene without the voices
}

// Teams mode
type Speaker = 'A' | 'B';
type Role = Speaker | 'both'; // 'both': a player alone in their team
interface DialogueLine {
  startMs: number; // from the start of the file
  endMs: number;
  speaker: Speaker;
  text: string; // subtitle; '' when not transcribed (optional when sent)
  wordStartsMs: number[]; // karaoke: when each word of `text` starts; [] = even pace (optional when sent)
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

| Event                 | Payload                                                      | Ack                                | Who                                                                                                                |
| --------------------- | ------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `room:create`         | `{ nickname, color }`                                        | `{ code, playerId, sessionToken }` | anyone                                                                                                             |
| `room:join`           | `{ code, nickname, color }`                                  | `{ playerId, sessionToken }`       | anyone                                                                                                             |
| `room:resume`         | `{ code, sessionToken }`                                     | `{ playerId }`                     | a player reconnecting                                                                                              |
| `room:leave`          | `{}`                                                         |                                    | player                                                                                                             |
| `room:updateSettings` | `Partial<Settings>`                                          |                                    | host, lobby only                                                                                                   |
| `room:kick`           | `{ playerId }`                                               |                                    | host                                                                                                               |
| `room:deleteSound`    | `{ soundId }`                                                |                                    | the uploader or the host, lobby only                                                                               |
| `room:shareSounds`    | `{ share }`                                                  |                                    | logged in (the socket's session cookie); the host can then tick the player's own sounds. `NOT_LOGGED_IN` otherwise |
| `game:start`          | `{}`                                                         |                                    | host, lobby only                                                                                                   |
| `game:vote`           | `{ clipIds: string[] }` (performance ids, 0–2, not your own) |                                    | player, VOTING only; can be re-sent to change the vote                                                             |
| `game:backToLobby`    | `{}`                                                         |                                    | host, FINAL_RESULTS only                                                                                           |
| `debug:setVoiceMuted` | `{ muted: boolean }`                                         |                                    | host; dev builds only (`NODE_ENV !== 'production'`)                                                                |
| `time:sync`           | `{ clientTime }`                                             | `{ clientTime, serverTime }`       | anyone                                                                                                             |

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

| Method | Route                                      | Body                       | Response                             | Notes                                                                                                                                                                                    |
| ------ | ------------------------------------------ | -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                              |                            | `{ ok: true }`                       |                                                                                                                                                                                          |
| `POST` | `/api/rooms/:code/voice-token`             |                            | `{ url, token }`                     | LiveKit URL (`LIVEKIT_PUBLIC_URL`) and a 15-min JWT for room `cyrp-<code>`; no publish right while `voiceMuted`                                                                          |
| `POST` | `/api/rooms/:code/sounds?label=<name>`     | raw audio bytes            | `SoundRef`                           | Lobby only; ≤2 MB, 0.2–20s (measured by the server), ≤200 per room (one file per request). Errors: 409 `TOO_MANY_SOUNDS` / `WRONG_PHASE`, 415 `UNSUPPORTED_FORMAT`, 422 `SOUND_TOO_LONG` |
| `POST` | `/api/rooms/:code/rounds/:round/recording` | raw audio bytes (the blob) | `{ ok: true }`                       | During RECORDING (until 3s after the window); ≤2 MB; one per player per round. Format sniffed from the bytes: webm, ogg, wav, mp4/m4a, mp3                                               |
| `GET`  | `/api/rooms/:code/audio/:fileId`           |                            | audio bytes                          | Recordings and custom sounds. `?download=<name>` sends it as an attachment named `<name>.<ext>`                                                                                          |
| `GET`  | `/api/rooms/:code/shared-sounds`           |                            | `{ playerId, sounds: SoundRef[] }[]` | The own sounds of the players sharing theirs (logged in, `room:shareSounds { share: true }`); the host can tick them like library sounds (`lib:` ids)                                    |

### Accounts

Logging in sets an HttpOnly session cookie (`cyrp_session`, 30 days, `SameSite=Lax`). Accounts don't change how rooms work: logged in or not, a player joins with a nickname (the username prefills it). Errors are `{ ok: false, error }` with `INVALID_PAYLOAD` (400), `BAD_CREDENTIALS` / `NOT_LOGGED_IN` (401), `INVALID_CODE` / `NOT_ADMIN` (403), `NOT_FOUND` (404), `USERNAME_TAKEN` (409), `RATE_LIMITED` (429).

| Method   | Route                                       | Body                            | Response                                                            | Notes                                                                                                     |
| -------- | ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/account`                              |                                 | `{ user: { username, isAdmin } \| null, signup: 'open' \| 'code' }` | Who is logged in, and whether sign-up needs a code (`ACCOUNT_CREATION`)                                   |
| `POST`   | `/api/account/signup`                       | `{ username, password, code? }` | same as above                                                       | Username 3–20 letters, digits, `_` `.` `-` (unique whatever the case); password 8+. `code`: single-use    |
| `POST`   | `/api/account/login`                        | `{ username, password }`        | same as above                                                       | Rate-limited per address, like sign-up and password change                                                |
| `POST`   | `/api/account/logout`                       |                                 | `{ ok: true }`                                                      |                                                                                                           |
| `GET`    | `/api/account/sounds-token`                 |                                 | `{ token, expiresAt }`                                              | Logged in. The browser's pass to the sounds service (1 hour)                                              |
| `POST`   | `/api/account/password`                     | `{ oldPassword, newPassword }`  | `{ ok: true }`                                                      | Logged in. Logs out the account's other sessions                                                          |
| `GET`    | `/api/admin/users`                          |                                 | `{ username, createdAt, isAdmin }[]`                                | **Admin** (`ADMIN_USERNAMES`)                                                                             |
| `POST`   | `/api/admin/users/:username/reset-password` |                                 | `{ ok: true }`                                                      | **Admin.** A new random password, printed in the server's console only; the user is logged out everywhere |
| `GET`    | `/api/admin/invites`                        |                                 | `{ code, createdAt, usedBy, usedAt }[]`                             | **Admin.** Sign-up codes, newest first                                                                    |
| `POST`   | `/api/admin/invites`                        | `{ count }` (1–50)              | `{ codes: string[] }`                                               | **Admin**                                                                                                 |
| `DELETE` | `/api/admin/invites/:code`                  |                                 | `{ ok: true }`                                                      | **Admin**                                                                                                 |

### Error codes

`ROOM_NOT_FOUND`, `SESSION_EXPIRED` (resume after the grace period), `INTERNAL`, `ROOM_FULL`, `NOT_HOST`, `WRONG_PHASE`, `INVALID_PAYLOAD`, `NICKNAME_TAKEN`, `FILE_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `TOO_MANY_SOUNDS`, `SOUND_TOO_LONG`, `ALREADY_SUBMITTED`, `CANNOT_VOTE_SELF`, `TOO_MANY_VOTES`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_SOUNDS`, `LIBRARY_UNAVAILABLE` (the sounds service didn't answer when the game started), `NO_DIALOGUES` (Teams mode without a ticked dialogue), `SPECTATOR`.

HTTP errors use the same codes in `{ ok: false, error }`, with status 401 (no seat), 409 (wrong phase, already submitted), 403 (spectator), 413 (too large) or 415 (format).

## Sounds API (apps/sounds)

The sound library service, on its own origin (`SOUNDS_PUBLIC_URL`, e.g. `https://sounds.example.com`; `/sounds-api` through the Vite proxy in development). It holds the **shared library** (every room can use it; public reads, CORS for the game origin) and each user's **own sounds** (private; rooms get them only from players sharing theirs). Writes need `Authorization: Bearer <token>`: a token the game server signs with `SOUNDS_SECRET` (`GET /api/account/sounds-token`, 1 hour) for the logged-in user, admin or not. Users write their own sounds (`?scope=mine`, the default, within `USER_SOUNDS_QUOTA_MB`); admins also the library (`?scope=library`). Other users' sounds answer 404. Errors are `{ ok: false, error }` with `UNAUTHORIZED` (401), `NOT_FOUND` (404), `INVALID_PAYLOAD` (400), `FILE_TOO_LARGE` / `QUOTA_EXCEEDED` (413), `UNSUPPORTED_FORMAT` (415), `SOUND_TOO_LONG` (422), `DUPLICATE` (409) or `RATE_LIMITED` (429).

```ts
interface LibrarySound {
  id: string; // "2-hours-later"; inside a room selection it is prefixed: "lib:2-hours-later"
  label: string;
  durationMs: number;
  tags: string[]; // lowercase: letters, digits, spaces, dashes; 24 chars max
  lines: DialogueLine[]; // Teams mode dialogues (tag "team"); [] for other sounds
  url: string; // `${SOUNDS_PUBLIC_URL}/files/<sha256>.<ext>`
  backgroundUrl: string | null; // dialogues: the scene without the voices, same URL scheme
  bytes: number; // space on the server: the file and its background (counted in the quota)
}
```

| Method   | Route                                     | Body                                                                                              | Response                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/health`                                 |                                                                                                   | `{ ok, sounds }`                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET`    | `/v1/sounds?tag=&minMs=&maxMs=&q=`        |                                                                                                   | `LibrarySound[]`                                                   | All filters optional. `tag` repeats (or comma-separated): sounds having **any** of them. Cached 15s                                                                                                                                                                                                                                                                                                                                        |
| `GET`    | `/v1/sounds/:id`                          |                                                                                                   | `LibrarySound`                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST`   | `/v1/sounds/lookup`                       | `{ ids: string[], owners?: number[] }`                                                            | `LibrarySound[]`                                                   | Read-only batch lookup (the game server resolves a selection with it). Unknown ids are left out. `owners`' own sounds are included only with an admin token (the game server)                                                                                                                                                                                                                                                              |
| `GET`    | `/v1/my/sounds?scope=mine\|library`       |                                                                                                   | `{ sounds, usedBytes, quotaBytes }`                                | **Token.** The user's own sounds and quota (`library`: admins; `quotaBytes` null)                                                                                                                                                                                                                                                                                                                                                          |
| `GET`    | `/v1/tags`                                |                                                                                                   | `{ name, count }[]`                                                | Cached 15s                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET`    | `/files/<sha256>.<ext>`                   |                                                                                                   | audio bytes                                                        | Named after the content hash, so never changes: `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                                                                                                                                                                                                                       |
| `GET`    | `/v1/admin`                               |                                                                                                   | `{ ok: true }`                                                     | **Admin.** Checks a token                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST`   | `/v1/sounds?label=<name>&tag=a&tag=b`     | raw audio bytes                                                                                   | `LibrarySound` (201)                                               | **Admin.** Same rules as room uploads (≤2 MB, 0.2–20s). 409 `DUPLICATE` with `{ sound }` if the same file exists                                                                                                                                                                                                                                                                                                                           |
| `PATCH`  | `/v1/sounds/:id`                          | `{ label?, tags?, lines? }`                                                                       | `LibrarySound`                                                     | **Admin.** `tags` and `lines` replace the whole list. Lines: in order, not overlapping, ≥0.3s each, ≤30, within the sound                                                                                                                                                                                                                                                                                                                  |
| `PUT`    | `/v1/sounds/:id/background`               | raw audio bytes                                                                                   | `LibrarySound`                                                     | **Admin.** The scene without the voices (Teams playback). Upload rules, and as long as the sound (±250 ms, else 422 `LENGTH_MISMATCH`)                                                                                                                                                                                                                                                                                                     |
| `DELETE` | `/v1/sounds/:id/background`               |                                                                                                   | `LibrarySound`                                                     | **Admin.** The file is deleted once no sound uses it                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST`   | `/v1/transcribe?language=french\|english` | raw mono float32 samples, 16 kHz                                                                  | `{ text, startMs, endMs }[]`                                       | **Admin.** Speech recognition (Whisper) for "Suggest text": the words said, with their timings. ≤21 s. 503 `TRANSCRIPTION_FAILED` if the model can't run                                                                                                                                                                                                                                                                                   |
| `POST`   | `/v1/align`                               | `{ language, samples, lines: { startMs, endMs, text }[] }` (samples: base64 float32, 16 kHz mono) | `{ wordStartsMs: number[][] }`                                     | **Admin.** Forced alignment (wav2vec2): when each word of each line starts; `[]` for a line it couldn't align. 503 `TRANSCRIPTION_FAILED` if the model can't run                                                                                                                                                                                                                                                                           |
| `POST`   | `/v1/download`                            | `{ url }` (a link to an audio file)                                                               | the audio, with its type; the file name in `X-Title` (URI-encoded) | **Token.** For the crop editor: the browser cuts it and uploads the kept part like a file. Public http(s) addresses on ports 80/443 only (private, loopback, link-local and IPv4-in-IPv6 ones are refused, redirects included), 15 MB and 30 s max, 3 downloads at once service-wide (more: 429), audio only (sniffed): 400 `INVALID_PAYLOAD`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_FORMAT`, 502 `DOWNLOAD_FAILED`; 30 per user per hour |
| `DELETE` | `/v1/sounds/:id`                          |                                                                                                   | `{ ok: true }`                                                     | **Admin.** The file is deleted once no sound uses it. Games already started keep working until they end                                                                                                                                                                                                                                                                                                                                    |
