# Deployment

How to run the game on a Debian VPS that already has Docker and nginx. Everything runs in three containers; your nginx handles HTTPS in front of them.

```
                 ┌──────────────── VPS ─────────────────────────────────────────┐
 browsers ─443─► │ nginx (HTTPS, certbot)                                      │
                 │   game.example.com  ──► 127.0.0.1:3000  game container      │
                 │   voice.example.com ──► 127.0.0.1:7880  livekit (signaling) │
                 │   sounds.example.com ─► 127.0.0.1:3100  sounds (library)    │
 browsers ─────► │ 7881/tcp, 7882/udp  ──────────────────► livekit (media)     │
                 └─────────────────────────────────────────────────────────────┘
```

- **game**: built from the repo's `Dockerfile`. One Node process serves the web app, the API and Socket.IO. Player accounts live in its `game-data` volume (`accounts.db`): **back it up**.
- **livekit**: the official LiveKit image, configured by `deploy/livekit.yaml`.
- **sounds**: the sound library, built from `apps/sounds/Dockerfile`. Its data (`library.db` and the audio files) lives in the `sounds-data` Docker volume: **back it up**. It starts empty: add sounds from the admin page.
- **HTTPS is required**: browsers only allow microphone access on secure pages.
- **One instance only**: rooms live in memory. Restarting the game container ends the games in progress, so deploy when nobody is playing.

All deployment files are in [`deploy/`](../deploy).

## 1. Prerequisites

On the server:

- Docker with the Compose plugin (`docker compose version`)
- nginx and certbot: `sudo apt install nginx certbot python3-certbot-nginx`
- git, and access to the repository (a deploy key or HTTPS token for a private repo)

## 2. DNS

Create three records pointing to the server's IP. Add AAAA records too if the server has IPv6.

| Name                   | Type | Value     |
| ---------------------- | ---- | --------- |
| `game.<your domain>`   | A    | server IP |
| `voice.<your domain>`  | A    | server IP |
| `sounds.<your domain>` | A    | server IP |

## 3. Firewall

Open these ports, both in your provider's firewall (security group) and in `ufw` if you use it:

| Port | Protocol | For                             |
| ---- | -------- | ------------------------------- |
| 80   | TCP      | HTTP, certificate issuance      |
| 443  | TCP      | HTTPS: game and voice signaling |
| 7881 | TCP      | Voice media over TCP (fallback) |
| 7882 | UDP      | Voice media                     |

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp
```

> Docker publishes ports without going through `ufw`. That's why the game (3000) and LiveKit signaling (7880) are bound to `127.0.0.1` in `docker-compose.yml`: only nginx can reach them.

## 4. Get the code and configure it

```bash
sudo git clone <repo url> /opt/cyrp
sudo chown -R "$USER" /opt/cyrp
cd /opt/cyrp/deploy
cp .env.example .env
```

Edit `deploy/.env`:

```bash
GAME_DOMAIN=game.yourdomain.com
VOICE_DOMAIN=voice.yourdomain.com
SOUNDS_DOMAIN=sounds.yourdomain.com
LIVEKIT_API_KEY=cyrp3f9a1c2b7d4e        # echo "cyrp$(openssl rand -hex 6)"
LIVEKIT_API_SECRET=...                  # openssl rand -hex 32
SOUNDS_SECRET=...                       # openssl rand -hex 24
```

`deploy/.env` holds secrets: it is git-ignored, so never commit it.

## 5. Start the containers

```bash
cd /opt/cyrp/deploy
docker compose up -d --build
docker compose ps                       # all "running"; game and sounds become "healthy"
curl -s 127.0.0.1:3000/api/health       # {"ok":true}
curl -s 127.0.0.1:3100/health           # {"ok":true,"sounds":0} at first
docker compose logs livekit | grep -i "external ip"
```

LiveKit should report `found external IP via STUN` with your server's public IP, without a "could not validate" warning. If the warning appears, port 7882/udp or 7881/tcp is not reachable: check the firewall.

## 6. nginx and HTTPS

```bash
sudo cp /opt/cyrp/deploy/nginx.conf.example /etc/nginx/sites-available/cyrp
sudo sed -i 's/game.example.com/game.yourdomain.com/; s/voice.example.com/voice.yourdomain.com/;
  s/sounds.example.com/sounds.yourdomain.com/' /etc/nginx/sites-available/cyrp
sudo ln -s /etc/nginx/sites-available/cyrp /etc/nginx/sites-enabled/cyrp
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d game.yourdomain.com -d voice.yourdomain.com -d sounds.yourdomain.com
```

If `nginx -t` complains about a duplicate `map` / `$connection_upgrade`, another site already defines it. Delete the `map` block at the top of the file.

certbot adds the HTTPS config and the HTTP → HTTPS redirect, and renews the certificates automatically.

## 7. Check it works

1. Open `https://game.yourdomain.com` and create a room. The voice status should switch to **Voice connected**.
2. Join from a second device on **another network** (a phone on mobile data). Voice must work across networks, not only on your Wi-Fi.
3. Play a round: recording, playback and voting.

## Managing the sound library

- **`/sounds`** (`https://game.yourdomain.com/sounds`), for any logged-in user: their own sounds (upload several files at once with tags, rename, retag, delete, dialogue lines), up to `USER_SOUNDS_QUOTA_MB` each (default 200 MB, files as uploaded). They're private: a player shares them with a room by ticking "Share my sounds with the room" in the room's lobby, and the host can then pick among them. Admins (`ADMIN_USERNAMES`) also manage the **shared library** there, which every room can use (no quota). "Suggest text" / "Align words" are limited to 20 per user per hour.
- **Bulk import from the server** (a folder of audio files, named after their files; an optional `manifest.json` `{ "sounds": [{ "id", "file", "label" }] }` sets ids and labels):

  ```bash
  cd /opt/cyrp/deploy
  docker compose cp ~/my-sounds sounds:/tmp/import
  docker compose exec sounds node dist/import.js /tmp/import --tag animal --tag classic
  ```

- **Suggest text** and **Align words** (dialogue subtitles and karaoke timing) run in the sounds container: speech recognition (Whisper, ~80 MB) and word alignment (wav2vec2: French ~355 MB, English ~95 MB). Each model is downloaded from Hugging Face on first use and kept in the `sounds-data` volume under `models/` (no need to back it up). Loaded, they take **~800 MB** (Whisper) and **~650 MB** (French alignment) of RAM, so up to ~1.5 GB right after a "Suggest text"; each is freed after 5 idle minutes. A request uses a few seconds of CPU.
- **Sounds from YouTube:** both upload forms accept a YouTube link (logged-in users). The sounds image ships yt-dlp (pinned in `apps/sounds/Dockerfile`; bump `YTDLP_VERSION` and its checksum when YouTube changes break it). YouTube often asks server addresses for a bot check: if links fail with "YouTube refused the server", that's it, and file uploads still work. Downloading from YouTube may go against its terms of service: your call as the operator.
- **Backup:** the `sounds-data` and `game-data` volumes are the only state worth keeping.

  ```bash
  docker run --rm -v cyrp_sounds-data:/data -v "$PWD":/backup debian:stable-slim \
    tar czf /backup/sounds-$(date +%F).tgz -C /data .
  docker run --rm -v cyrp_game-data:/data -v "$PWD":/backup debian:stable-slim \
    tar czf /backup/game-$(date +%F).tgz -C /data .
  ```

## Player accounts

- **Sign-up** needs a single-use code from an admin, unless `ACCOUNT_CREATION=open` in `deploy/.env` (anyone can then sign up). Playing doesn't need an account.
- **Admins** are the usernames listed in `ADMIN_USERNAMES` (comma-separated). They manage codes and accounts at `https://game.yourdomain.com/admin/accounts`.
- **The first account:** with sign-up closed and no account yet, the game prints a code at startup. Create your own account with it (with a name listed in `ADMIN_USERNAMES`):

  ```bash
  docker compose logs game | grep 'no account yet'
  ```

- **Password resets:** an admin's "Reset password" gives the account a new random password, printed in the game's console, never shown in the browser. Read it and hand it over:

  ```bash
  docker compose logs game | grep 'reset by'
  ```

  Players change it from `/account` (with the current one).

## Upgrading an existing install to the sound library

Installs from before the library need, once:

1. A DNS record for `sounds.<your domain>`.
2. Two new lines in `deploy/.env`: `SOUNDS_DOMAIN=sounds.yourdomain.com` and `SOUNDS_SECRET=$(openssl rand -hex 24)`. Compose refuses to start without them.
3. The new nginx blocks from `deploy/nginx.conf.example`: the `proxy_cache_path` line at the top and the `sounds.example.com` server. Then `sudo nginx -t && sudo systemctl reload nginx` and `sudo certbot --nginx -d sounds.yourdomain.com`.
4. `docker compose up -d --build`, as for any update.
5. Optional, but recommended: copy the `limit_req_zone` lines and the `location /api/` and `location /v1/` blocks of the updated `deploy/nginx.conf.example` into your nginx site (rate limits, and an optional allowlist for admin writes). The web app is rebuilt with the library's URL baked in. The library starts empty: fill it from `/sounds` as an admin (or with the import command above).

## Upgrading to user sounds

`SOUNDS_ADMIN_TOKEN` is gone: the library is now managed from `/sounds` by account admins (`ADMIN_USERNAMES`). In `deploy/.env`, replace the `SOUNDS_ADMIN_TOKEN=` line with `SOUNDS_SECRET=$(openssl rand -hex 24)` (compose refuses to start without it), optionally set `USER_SOUNDS_QUOTA_MB`, then `docker compose up -d --build`. Existing sounds become the shared library.

## Updating

```bash
cd /opt/cyrp && git pull
cd deploy && docker compose up -d --build
docker image prune -f                   # clean up old images
```

This restarts the game container and ends games in progress.

## Operations

```bash
cd /opt/cyrp/deploy
docker compose logs -f game             # game server logs
docker compose logs -f livekit          # voice server logs
docker compose logs -f sounds           # sound library logs
docker compose restart game
docker compose down                     # stop everything
```

The containers restart on their own after a crash or a reboot (`restart: unless-stopped`). Only the sound library needs backing up (see above): all game audio (recordings, room uploads) is temporary by design and is wiped at every start.

## Troubleshooting

| Symptom                                         | Likely cause                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stuck on "Joining voice…", then "unavailable"   | 7882/udp and 7881/tcp blocked (provider firewall!), or `VOICE_DOMAIN` doesn't resolve. Check `docker compose logs livekit`.                               |
| Voice works on Wi-Fi but not from outside       | Same: media ports not open to the internet.                                                                                                               |
| Browser never asks for the microphone           | The page isn't served over HTTPS.                                                                                                                         |
| "Connection lost, reconnecting…" loops          | WebSocket upgrade headers missing in nginx (`Upgrade` / `Connection`).                                                                                    |
| "The sound library is unreachable" in the lobby | The sounds container is down, `SOUNDS_DOMAIN` doesn't resolve, or its nginx site / certificate is missing. `curl -s 127.0.0.1:3100/health` on the server. |
| Recordings fail with 413                        | nginx `client_max_body_size` too small for the game site (needs ≥ 3m).                                                                                    |
| Voice fails only on strict corporate networks   | Those block everything except 443. It needs LiveKit's built-in TURN/TLS server, which requires a third hostname and certificate; not set up yet.          |
