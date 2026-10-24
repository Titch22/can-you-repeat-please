# Architecture

## Overview

```
┌──────────────────────────┐   Socket.IO (game state, actions)   ┌──────────────────────────────┐
│   Browser (React app)    │ ◄─────────────────────────────────► │  Game server (Node/Express)  │
│                          │   HTTP (tokens, uploads, audio)     │  - rooms (in memory)         │
│  - UI / Zustand store    │ ◄─────────────────────────────────► │  - game state machine        │
│  - MediaRecorder         │                                     │  - audio temp storage        │
│  - livekit-client        │                                     │  - LiveKit admin (server SDK)│
└────────────┬─────────────┘                                     └──────────────┬───────────────┘
             │ WebRTC (voice)                                                   │ Server API
             ▼                                                                  ▼ (tokens, permissions)
       ┌─────────────────────────────────────────────────────────────────────────────┐
       │                         LiveKit SFU (voice chat)                            │
       └─────────────────────────────────────────────────────────────────────────────┘

 Browser ──HTTP (list, play, admin)──► Sounds service (apps/sounds) ◄──lookup at game start── Game server
```

Three channels, each with one job:

- **Socket.IO** carries the game: room membership, settings, phase changes, votes. The server is the only source of truth.
- **HTTP** carries files: LiveKit tokens, recording and sound uploads, and audio downloads.
- **LiveKit** carries live voice only. Game audio (reference sounds, recordings) never goes through LiveKit. Each client fetches and plays it locally.

A fourth component, the **sounds service**, holds the curated sound library. Browsers fetch the list and the audio files from it directly; the game server only asks it for the selected sounds when a game starts (see [Sound library](#sound-library)).

## Server

```
apps/server/src/
  index.ts              Express + Socket.IO bootstrap; wipes tmp/rooms at startup
  rooms/RoomManager.ts  create/join/leave, codes, host migration, reconnect grace, idle timeout
  game/rules.ts         pure rules: sound picking, vote validation, tally (unit tested)
  game/GameRunner.ts    phase transitions, timers and deadlines; early phase ends (unit tested
                        with fake timers)
  game/timing.ts        fixed phase durations (normal and GAME_FAST)
  routes/audio.ts       recording upload, room audio serving
  voice/livekit.ts      token minting, setPublishAllowed(room, bool)
  audio/storage.ts      per-room temp dir, saving and validating files, deleteRoom(code)
  routes/               HTTP routes (see PROTOCOL.md)
  sockets/              Socket.IO handlers; validate payloads with shared zod schemas
```

- **State is in memory.** The server is a single instance and holds `Map<code, Room>`. Scaling out later would mean Redis plus the Socket.IO Redis adapter. That's out of scope for now.
- **Server-authoritative.** Clients send _intents_ (`game:vote`, `room:updateSettings`). The server validates them, updates state, and broadcasts a full `room:state` snapshot. Rooms are small, so full snapshots are cheap and avoid diffing bugs.

## Game state machine

```
LOBBY ─start─► ROUND_INTRO ─► REFERENCE ─► RECORDING ─► PLAYBACK ─► VOTING ─► ROUND_RESULTS
  ▲                ▲                                                               │
  │                └──────────────────── more rounds ◄─────────────────────────────┤
  └──────────────── backToLobby ◄──── FINAL_RESULTS ◄──── last round ──────────────┘
```

- `GameRunner` owns one timer per room and moves it through the phases. Player actions (an upload, a vote, someone leaving) can end a phase early: recording ends once every connected player's upload has arrived, voting once everyone has voted. The game ends early when fewer than 2 players remain.
- The rules themselves (picking sounds, validating a ballot, tallying votes) are pure functions in `rules.ts`. `GameRunner` is tested by driving whole games with fake timers.
- Every phase has a `deadline` (server epoch ms) included in `room:state`.

### Timing sync

- On connect, the client pings the server a few times (`time:sync`) and keeps the median clock offset.
- Countdowns and "start playing at T" use the server clock adjusted by that offset.
- **Reference** and **playback** clips are scheduled at a server timestamp (`startsAt`). Clients preload the audio files when the phase starts and play them at `startsAt`. This keeps everyone hearing the same clip within a few tens of ms.
- **Loudness:** every game sound (library, uploads, recordings) is normalized in the browser when decoded: a gated RMS (50 ms windows, -50 dBFS gate) sets a gain toward -20 dBFS, capped at 6x so near-silent recordings don't become loud noise, and a shared limiter catches the peaks. See `apps/web/src/lib/loudness.ts`.
- **Playback** has a sub-index (`playbackIndex`), advanced by the server, so all players hear the same clip at the same time.

### Phase timings

Fixed durations live in `apps/server/src/game/timing.ts`. `GAME_FAST=1` switches to shorter ones; the Playwright config sets it when it starts the server itself.

### Teams mode

- `GameState.mode` is fixed when the game starts. At each round start, `pairTeams` (rules.ts) shuffles the players into pairs with random A / B roles (one player alone, role `both`, when the count is odd).
- **Recording is unchanged:** every player records over the whole scene, from the same synchronized start. A recording's timeline is therefore the scene's: line timecodes apply to it directly.
- **Performances:** after recording, `buildPerformances` makes one per team that recorded (classic: one per recording). Votes, tallies and results all work on performances; every player of a performance scores its votes.
- **Stitching happens in the browser** (`apps/web/src/lib/dialogue.ts`): for each line of the reference, the recording of whoever voices that line, from the line's start, for its length. `playSegmentsAt` (lib/audio.ts) schedules those slices on the decoded buffers with 15 ms fades, at the server-synchronized start, so everyone hears the stitched scene together. Downloads render the same segments in an `OfflineAudioContext` and encode a WAV.
- **Dialogue lines** live in the sound library (`sound_lines` table), edited in `/admin` on a waveform.

## Voice and muting

- **Joining:** after joining a room over Socket.IO, the client calls `POST /api/rooms/:code/voice-token`. The token is scoped to the LiveKit room `cyrp-<code>` with the identity `<playerId>`. The client then connects with `livekit-client`.
- **Muting during RECORDING:**
  - The server calls `RoomServiceClient.updateParticipant(room, identity, { permission: { canPublish: false, canSubscribe: true, … } })` for every participant. This is the enforcement: nobody can leak voice into someone else's recording.
  - The client also mutes its local track as soon as it gets the phase change, so the UI reacts instantly.
  - When the phase ends, the server sets `canPublish: true` again and the client republishes its mic track if the player hadn't muted themselves.
- **Leaving:** when a player is kicked or removed, the server also removes them from the LiveKit room, since their voice token would otherwise stay valid. Closing a room deletes its LiveKit room.
- **Ducking:** during REFERENCE and PLAYBACK, remote voice volume is lowered on the client (default 25%) so the game audio stays audible.
- **Mic selection and level:** players pick their mic in the voice bar's "Mic settings" (saved per browser). Switching opens the new device once (`setInputDevice` in `apps/web/src/lib/mic.ts`), swaps it in as the shared mic stream and replaces the published voice track (`LocalTrack.replaceTrack`), so there's no republish; later recordings use it too. A live level meter reads the shared stream itself, so it works while muted. It shares `levelMeter.ts` with the speaking ring: each read looks at all the audio since the previous read, so short sounds aren't missed when a background tab's timers are throttled. Output device selection isn't offered: browsers outside Chromium can't route Web Audio (game sounds) to another device.
- **Loud enough voices:** the mic is captured without auto gain (for recordings), so quiet mics stay quiet. Two fixes:
  - **Mic boost (sender):** each player can raise their own voice (100–400%, in Mic settings). The published voice track comes from a Web Audio chain: shared mic → gain → limiter → `MediaStreamDestination`. Until the browser allows audio, a plain copy of the mic is published instead (a suspended context would send silence), then swapped. Recordings stay raw; they're loudness-normalized at playback.
  - **Listener boost:** per-player volume goes up to 300%. Voices play through LiveKit's `webAudioMix` on our shared audio context, so `setVolume` drives a gain node instead of an `<audio>` element, which caps at 1.
- **Echo:** players on speakers could feed the reference sound back into voice. LiveKit's echo cancellation handles most of it, and ducking helps. Headphones are recommended in the lobby UI.

## Recording pipeline

1. When RECORDING starts, the client opens a **separate** `getUserMedia` stream with `{ echoCancellation: true, noiseSuppression: false, autoGainControl: false }`. Noise suppression is off so animal noises and beatboxing aren't filtered out as "noise".
2. A `MediaRecorder` records `audio/webm;codecs=opus`, or `audio/mp4` on Safari. The duration comes from the phase deadline.
3. When the window closes, the client uploads the blob as the raw request body with `POST /api/rooms/:code/rounds/:round/recording`. The phase ends as soon as every connected player's recording has arrived, or 3s after the window otherwise.
4. The server checks:
   - the size (2 MB or less),
   - the format, from the file's first bytes (the declared Content-Type is ignored),
   - the phase (RECORDING, which includes the 3s upload grace),
   - one recording per player per round.
5. The file is stored as `tmp/rooms/<code>/rec-<round>-<playerId>.<ext>`.

## Audio storage and lifecycle

```
data/sounds/               the sound library (dev; a Docker volume in production): library.db + files/
tmp/rooms/<code>/          ephemeral, one dir per room
    snd-<uuid>.<ext>       custom lobby sounds
    rec-<round>-<pid>.ext  recordings
```

- Audio is served with `GET /api/rooms/:code/audio/:fileId`. The request needs the player's `sessionToken` (an HTTP header or query param), so only room members can download.
- Recordings are deleted when the game returns to the lobby. Custom sounds are kept for the next game in the same lobby, until their uploader or the host deletes them.
- Custom sound durations are measured by the server (`music-metadata`), not trusted from the client: they drive the recording window.
- **The room dir is deleted when the room closes**: when the last player leaves (after the 30s reconnect grace period), or after 30 minutes idle.
- At startup, the server wipes `tmp/rooms/`, so nothing survives a crash.

## Security notes

In a room, a player is a nickname plus a random session token. Optional player accounts (username and password) only prefill the nickname for now. The threats that matter are someone abusing the server (filling the disk, flooding), griefing a room, taking over an account, or tampering with the library.

- **Accounts:** passwords are hashed with scrypt and a random salt (`node:crypto`). Login sets an HttpOnly, `SameSite=Lax` cookie (`Secure` in production); the database only keeps a SHA-256 of each session token. Cross-site requests carry no cookie, and the JSON bodies need a CORS preflight that only `CLIENT_ORIGIN` passes. Sign-up, login and password changes are rate-limited per address; a login for an unknown username takes as long as a wrong password. Admin password resets are printed in the server console, never sent to a browser.

- **Input:** every socket payload and HTTP query is validated with zod. Nicknames and labels are NFC-normalised and stripped of control and invisible characters (zero-width, bidi overrides), so two names that look alike are equal. React renders all user text as text (no `innerHTML`).
- **Sessions:** players get a `sessionToken` (random, 128-bit) when they join. HTTP routes take it from the `X-Session-Token` header only, never the URL (logs, history). One socket holds at most one seat.
- **What clients see:** `toState` is built per viewer. No tokens, file paths or future sounds are sent. Votes are private (only who has voted). Recordings appear at playback, behind random URLs that still need a seat in the room.
- **Abuse limits:**
  - at most 200 rooms and 2 GB of room audio on disk (`SERVER_FULL`);
  - per-address rate limits on entering rooms and uploading (`RATE_LIMITED`);
  - a per-connection limit on socket events (the connection is dropped);
  - nginx `limit_req` zones in front.
- **Files:** uploads are ≤ 2 MB, recognised by their bytes, measured by the server, never executed or transcoded. They are served with `nosniff` and `Content-Security-Policy: sandbox`, so a file opened directly can't act as a page.
- **Web app headers:**
  - a strict CSP: scripts only from the game's origin; connections only to the game, the library and LiveKit; no framing;
  - `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`.
- **Voice:** LiveKit tokens last 2 minutes, are scoped to one room, and allow the microphone only (no camera, screen share or data messages).
- **Admin (sound library):**
  - writes need the bearer token, compared in constant time;
  - production refuses tokens under 16 characters;
  - after 10 wrong tokens an address is locked out for a while (429);
  - every write is logged with its address;
  - the admin page keeps the token for the tab only, unless "Remember on this device" is ticked, and forgets it as soon as the server refuses it;
  - the nginx example shows how to restrict admin writes to your own address.

## Deployment

Self-hosted on a VPS with Docker Compose behind the host's nginx: see [DEPLOYMENT.md](DEPLOYMENT.md).

- **Game container** (`Dockerfile`): one Node process serves the built web app (with a fallback to `index.html` for client routes), the API and Socket.IO, so everything is same-origin. Temp audio lives on the container's disk, which is fine since it's ephemeral.
- **LiveKit container**: signaling proxied by nginx (`wss://voice.…`), media on 7881/tcp and 7882/udp, public IP discovered via STUN (`use_external_ip`).
- In production (`NODE_ENV=production`) the debug socket events are off.

## Sound library

```
apps/sounds/src/
  index.ts        bootstrap (the library starts empty: fill it from /admin or cli/import.ts)
  library.ts      SQLite (node:sqlite) metadata + content-addressed files
  app.ts          public read API, admin API (bearer token), static /files
  importDir.ts    folder import (reads manifest.json ids and labels when present)
  cli/import.ts   `pnpm --filter @cyrp/sounds import <dir> --tag <tag>`
packages/audio/   format sniffing and duration measuring, shared with the game server
```

- **A separate service** with its own origin (`sounds.<domain>`), so its files can be cached hard (nginx `proxy_cache`, and a CDN like Cloudflare later) independently of the game.
- **Storage:** `library.db` holds `sounds(id, label, duration_ms, file, mime, bytes, created_at)` and `sound_tags(sound_id, tag)`. Files are `files/<sha256>.<ext>`: a file's URL never changes (immutable caching), and uploading the same bytes twice is detected (`DUPLICATE`).
- **Curated:** only the admin page writes (bearer token, compared in constant time). Room uploads never enter the library.
- **Lobby:** the client fetches the whole list once (metadata only, small) and filters it locally, so tag chips and the length filter are instant. Library ids are prefixed `lib:` inside `settings.selectedSoundIds` so they can't clash with upload ids.
- **Game start:** `GameRunner.start` resolves the ticked `lib:` ids with `POST /v1/sounds/lookup` (5s timeout), adds the ticked uploads, and keeps the result for the whole game. Sounds deleted from the library in the meantime are skipped; if the service is down, the start fails with `LIBRARY_UNAVAILABLE` and the lobby stays as it was.
- **Playback:** reference sound URLs point at the sounds service; browsers fetch them with CORS (no session token: library files are public) and decode them like any other game sound.
