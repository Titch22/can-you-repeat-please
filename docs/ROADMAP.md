# Roadmap

Each milestone should end with something you can play or demo.

## M0: Docs and scaffolding

- [x] README and design docs (game design, architecture, protocol, roadmap)
- [x] pnpm workspace: `apps/web`, `apps/server`, `packages/shared`
- [x] TypeScript configs, ESLint, Prettier, and a root `pnpm dev` that runs web and server together
- [x] `docker-compose.yml` with `livekit/livekit-server --dev`
- [x] `.env.example` files (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PORT`)
- [x] Vitest and Playwright set up with one smoke test each

## M1: Rooms and lobby (no voice)

- [x] Home page: nickname and color picker, create room, join by code
- [x] `/r/:code` deep link
- [x] RoomManager: codes, 8-player cap, host, host migration, kick
- [x] Session token, `room:resume`, 30s reconnect grace
- [x] Lobby UI: player list, settings panel (editable by the host only)
- [x] Room closes and its temp dir is deleted when empty or idle

## M2: Voice lobby

- [x] `voice-token` endpoint (livekit-server-sdk)
- [x] Join LiveKit when entering a room; leave when leaving
- [x] Speaking indicators, self-mute, per-player volume sliders
- [x] Mic permission flow and a "headphones recommended" hint
- [x] `setPublishAllowed(room, bool)` helper, with a dev-only "Test recording mute" button

## M3: Core game loop (default sound pack)

- [ ] `sounds/default/` with about 30 CC0 clips and `manifest.json`
- [ ] Pure `stateMachine.ts` with unit tests (transitions, votes, scoring, leavers)
- [ ] GameRunner timers, deadlines, `time:sync`
- [ ] Reference phase: preload, then synced play at `startsAt`
- [ ] Recording phase: server-enforced mute, `useRecorder` hook, level meter, upload
- [ ] Playback phase: shuffled anonymous clips, synced by `playbackIndex`
- [ ] Voting phase: up to 2 votes, no self-vote, ends early when everyone has voted
- [ ] Round results, final podium, back to lobby; recordings deleted
- [ ] Playwright e2e test: 3 fake-mic players, 2 rounds

## M4: Custom sounds

- [ ] Lobby upload UI (drag and drop, label, preview, delete)
- [ ] Server validation (size, duration, format, per-player cap)
- [ ] `soundSource` setting: default, custom or mixed; start blocked if there aren't enough sounds
- [ ] Test that files are deleted when the lobby ends

## M5: Polish and deploy

- [ ] Visual identity, animations, UI sound effects
- [ ] Mic and output device picker, mobile layout, Safari (mp4) support
- [ ] Rate limiting, input sanitizing, error toasts
- [ ] Deploy (Fly.io or Render, plus LiveKit Cloud) and play with real friends

## Later ideas

- "Best of" clip reel to download at the end of a game
- Themed sound packs (animals, machines, memes)
- Audio similarity score as a bonus next to votes
- Team mode
