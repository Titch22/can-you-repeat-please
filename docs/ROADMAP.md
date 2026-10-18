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

- [x] `sounds/default/`: 24 meme classics (CC0/CC BY clips + synthesized public-domain tunes), `manifest.json`, `CREDITS.md`
- [x] `GameRunner` + pure `rules.ts`, with unit tests (transitions, votes, scoring, leavers)
- [x] GameRunner timers, deadlines, `time:sync`
- [x] Reference phase: preload, then synced play at `startsAt`
- [x] Recording phase: server-enforced mute, `useRecorder` hook, level meter, upload
- [x] Playback phase: shuffled clips shown with their author, synced by the playback `index`
- [x] Voting phase: up to 2 votes, no self-vote, ends early when everyone has voted
- [x] Round results, final podium, back to lobby; recordings deleted
- [x] Playwright e2e test: 3 fake-mic players, 2 rounds

## M4: Custom sounds

- [x] Lobby upload UI (file picker, name, preview, delete)
- [x] Server validation (size, format, duration measured server-side, per-player cap)
- [x] Sound picker grid with checkboxes (host, nothing ticked by default), replacing the default/custom/mixed setting; start blocked with no sound ticked
- [x] Tests: files deleted on delete and when the lobby ends; e2e upload → pick → play

## M5: Polish and deploy

- [x] Visual identity: logo and favicon, Outfit + Inter fonts (self-hosted), design tokens, shared UI components, animations (respecting reduced motion)
- [x] Mic picker and mic level indicator, mobile layout
- ~~UI sound effects~~ (dropped by choice)
- ~~Output device picker, Safari (mp4) support~~ (dropped)
- [ ] Rate limiting, input sanitizing, error toasts
- [x] Production setup: Dockerfile, compose stack (game + LiveKit) behind nginx, deployment guide
- [x] Deploy on the VPS and play with real friends: https://game.cyrp.iamthesen.at/

## Later ideas

- "Best of" clip reel to download at the end of a game
- Themed sound packs (animals, machines, memes)
- Audio similarity score as a bonus next to votes
- Team mode
