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
```

Three channels, each with one job:

- **Socket.IO** carries the game: room membership, settings, phase changes, votes. The server is the only source of truth.
- **HTTP** carries files: LiveKit tokens, recording and sound uploads, and audio downloads.
- **LiveKit** carries live voice only. Game audio (reference sounds, recordings) never goes through LiveKit. Each client fetches and plays it locally.

## Server

```
apps/server/src/
  index.ts              Express + Socket.IO bootstrap; wipes tmp/rooms at startup
  rooms/RoomManager.ts  create/join/leave, codes, host migration, reconnect grace, idle timeout
  game/stateMachine.ts  pure phase transitions (unit tested)
  game/GameRunner.ts    timers and deadlines; calls the state machine and broadcasts
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

- `stateMachine.ts` is a pure function: `(state, event) → state`. Events are `START`, `TICK_DEADLINE`, `VOTE`, `PLAYER_LEFT`, and so on. This keeps all the rules testable without timers or sockets.
- `GameRunner` owns one timer per room. On each deadline it sends `TICK_DEADLINE`.
- Every phase has a `deadline` (server epoch ms) included in `room:state`.

### Timing sync

- On connect, the client pings the server a few times (`time:sync`) and keeps the median clock offset.
- Countdowns and "start playing at T" use the server clock adjusted by that offset.
- **Reference** and **playback** clips are scheduled at a server timestamp (`startsAt`). Clients preload the audio files when the phase starts and play them at `startsAt`. This keeps everyone hearing the same clip within a few tens of ms.
- **Playback** has a sub-index (`playbackIndex`), advanced by the server, so all players hear the same clip at the same time.

## Voice and muting

- **Joining:** after joining a room over Socket.IO, the client calls `POST /api/rooms/:code/voice-token`. The token is scoped to the LiveKit room `cyrp-<code>` with the identity `<playerId>`. The client then connects with `livekit-client`.
- **Muting during RECORDING:**
  - The server calls `RoomServiceClient.updateParticipant(room, identity, { permission: { canPublish: false, canSubscribe: true, … } })` for every participant. This is the enforcement: nobody can leak voice into someone else's recording.
  - The client also mutes its local track as soon as it gets the phase change, so the UI reacts instantly.
  - When the phase ends, the server sets `canPublish: true` again and the client republishes its mic track if the player hadn't muted themselves.
- **Leaving:** when a player is kicked or removed, the server also removes them from the LiveKit room, since their voice token would otherwise stay valid. Closing a room deletes its LiveKit room.
- **Ducking:** during REFERENCE and PLAYBACK, remote voice volume is lowered on the client (default 25%) so the game audio stays audible.
- **Echo:** players on speakers could feed the reference sound back into voice. LiveKit's echo cancellation handles most of it, and ducking helps. Headphones are recommended in the lobby UI.

## Recording pipeline

1. When RECORDING starts, the client opens a **separate** `getUserMedia` stream with `{ echoCancellation: true, noiseSuppression: false, autoGainControl: false }`. Noise suppression is off so animal noises and beatboxing aren't filtered out as "noise".
2. A `MediaRecorder` records `audio/webm;codecs=opus`, or `audio/mp4` on Safari. The duration comes from the phase deadline.
3. When the phase ends, the client uploads the blob with `POST /api/rooms/:code/rounds/:round/recording`.
4. The server checks:
   - the size (2 MB or less),
   - the MIME type and magic bytes,
   - the phase (RECORDING, or a grace period of a few seconds after it),
   - one recording per player per round.
5. The file is stored as `tmp/rooms/<code>/rec-<round>-<playerId>.<ext>`.

## Audio storage and lifecycle

```
sounds/default/            permanent, read-only, shipped with the repo (manifest.json + clips)
tmp/rooms/<code>/          ephemeral, one dir per room
    snd-<uuid>.<ext>       custom lobby sounds
    rec-<round>-<pid>.ext  recordings
```

- Audio is served with `GET /api/rooms/:code/audio/:fileId`. The request needs the player's `sessionToken` (an HTTP header or query param), so only room members can download.
- Recordings are deleted when the game returns to the lobby. Custom sounds are kept for the next game in the same lobby.
- **The room dir is deleted when the room closes**: when the last player leaves (after the 30s reconnect grace period), or after 30 minutes idle.
- At startup, the server wipes `tmp/rooms/`, so nothing survives a crash.

## Security notes

- Every socket payload is validated with zod. Nicknames are length-limited and sanitized.
- Players get a `sessionToken` (random, 128-bit) when they join. It's required for HTTP routes and for reconnecting.
- Uploads are rate-limited and size-limited. Uploaded files are never executed or transcoded on the server.
- LiveKit tokens are short-lived and scoped to one room.

## Deployment (M5)

- **Game server and static web build:** a single Node service on Fly.io or Render. The temp dir lives on the instance's local disk, which is fine since all audio is ephemeral.
- **LiveKit:** LiveKit Cloud (free tier) or a self-hosted `livekit-server`, configured with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
