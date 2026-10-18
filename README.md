# Can You Repeat Please?

A multiplayer browser party game. A sound plays, everyone tries to imitate it with their mic at the same time, and then the room listens to every attempt and votes for the best ones.

**Play it:** https://game.cyrp.iamthesen.at/

The lobby works like a Discord voice channel: everyone can talk and hear each other. The game mutes everyone only while recording.

## How a game goes

1. One player creates a room and shares the 4-letter code or the link (`/r/ABCD`). Up to 8 players can join.
2. In the lobby, everyone chats by voice. The host picks the number of rounds and the sound source. Players can upload their own sounds.
3. Each round:
   - **Listen:** a sound plays.
   - **Repeat:** everyone imitates it into their mic. Voice chat is muted.
   - **Playback:** every recording is played for the room.
   - **Vote:** each player upvotes up to 2 recordings, not their own.
4. After the last round, a podium shows the winners and everyone goes back to the lobby.

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the full rules.

## Tech stack

- **Client:** React, Vite, TypeScript, Zustand, Tailwind
- **Server:** Node, Express, Socket.IO, TypeScript
- **Voice:** [LiveKit](https://livekit.io) (WebRTC SFU)
- **Shared:** zod schemas and types in `packages/shared`
- **Tests:** Vitest, Playwright

## Quickstart

Prerequisites: Node 20+ and pnpm 9+. You also need a LiveKit server for voice (from M2 on). Pick one:

- **Docker:** `pnpm voice:up` (stop with `pnpm voice:down`). LiveKit advertises the dev machine's LAN IP (`192.168.1.239`, set in `docker-compose.yml`; override with `LIVEKIT_NODE_IP`). It can't be `127.0.0.1`: Firefox ignores loopback addresses for WebRTC. For the same reason (Firefox), the Vite dev server listens on IPv4 `0.0.0.0`: Firefox never starts WebRTC on pages loaded over IPv6 `[::1]`.
- **Native binary:** download `livekit-server` from the [LiveKit releases](https://github.com/livekit/livekit/releases) and run `livekit-server --dev`
- **LiveKit Cloud:** create a free project and put its URL, key and secret in `apps/server/.env`

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev                    # web on :5173, server on :3000
```

### Scripts

| Command                     | What it does                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                  | Runs the web and server dev servers together                                                                    |
| `pnpm build`                | Builds all packages (server → `apps/server/dist`, web → `apps/web/dist`)                                        |
| `pnpm typecheck`            | Type-checks every package                                                                                       |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                                                                               |
| `pnpm test`                 | Unit tests (Vitest)                                                                                             |
| `pnpm test:e2e`             | End-to-end tests (Playwright; starts `pnpm dev` itself). Run `pnpm exec playwright install chromium` once first |

## Repo layout

```
apps/web/          React client
apps/server/       Express + Socket.IO game server
packages/shared/   Socket events, zod schemas, shared types
sounds/default/    Default sound pack: 24 meme classics, manifest.json, CREDITS.md (licenses)
scripts/           Dev scripts
docs/              Design, architecture, protocol, roadmap
```

## Documentation

| Doc                                     | Contents                                                            |
| --------------------------------------- | ------------------------------------------------------------------- |
| [GAME_DESIGN.md](docs/GAME_DESIGN.md)   | Rules, round flow, voting, scoring, settings, edge cases            |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, state machine, voice and mute strategy, audio lifecycle |
| [PROTOCOL.md](docs/PROTOCOL.md)         | Socket.IO events and HTTP routes                                    |
| [ROADMAP.md](docs/ROADMAP.md)           | Milestones and progress                                             |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)     | Running it on a VPS (Docker Compose + nginx)                        |
