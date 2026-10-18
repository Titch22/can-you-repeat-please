# Game Design

## Concept

"Can You Repeat Please?" is a "friendslop" party game: short, chaotic, meant to be played with friends on a voice call. The fun comes from hearing your friends try to imitate a goat, a dial-up modem or a car alarm.

## Players and rooms

- Rooms hold **2 to 8 players**.
- There are no accounts. Players pick a **nickname** and an **avatar color**.
- Players join with a **4-letter room code** or a shareable link: `/r/ABCD`.
- The room creator is the **host**. Only the host can:
  - change the settings,
  - start the game,
  - kick a player.
- If the host leaves, the player who joined earliest becomes host.
- Players can join a room while a game is running. They become **spectators** until the next game starts.

## Lobby

- The lobby is an **open voice channel**: everyone hears and talks to everyone by default.
- Each player can:
  - mute their own mic,
  - change each other player's volume,
  - see who is speaking.
- The host sets the game settings. Everyone sees the current values.

### Settings

| Setting              | Values                                           | Default |
| -------------------- | ------------------------------------------------ | ------- |
| Rounds               | 1–20                                             | 5       |
| Sounds               | Checkbox per sound: default pack + lobby uploads | none    |
| Extra recording time | 0–3s added to the sound's length                 | 1s      |
| Voting time          | 10–60s                                           | 20s     |

### Custom sounds

- Any player can upload sounds in the lobby. Limits: **20 seconds or less** (measured by the server), **2 MB or less**, no limit per player (at most 200 per room, as a safety net). Accepted formats: mp3, ogg, wav, webm, m4a. Several files can be uploaded at once. For a single file, the uploader names the sound (default: the file name); several files are named after their file names.
- Custom sounds belong to the lobby. They are **never stored long-term**: they live in the room's temporary folder and are **deleted when the lobby ends** (the last player leaves or the room times out), when deleted by their uploader or the host, and at every server restart.
- They stay available for the next games of the same lobby.

### Choosing the sounds

- The lobby lists every sound (the default pack, then uploads) in a grid with a preview button and a checkbox. Only the host can tick and untick; everyone sees the selection. Shortcuts: **All**, **None**, **Only uploads**.
- Nothing is ticked by default, uploads included: the host picks the sounds before starting. The whole tile is clickable.
- The game picks one ticked sound per round. A sound isn't picked again until every ticked sound has been used, so a short selection still works for long games. The game can't start until at least one sound is ticked.

## Round flow

Pause lengths are set in `apps/server/src/game/timing.ts`.

| #   | Phase             | Length                                          | Voice chat         | What happens                                                                                                                                                   |
| --- | ----------------- | ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Round intro**   | 3s                                              | on                 | "Round 2/5" title card                                                                                                                                         |
| 2   | **Reference**     | sound length + 3s                               | on, volume lowered | The reference sound plays for everyone at the same time, then "Get ready to repeat it!"                                                                        |
| 3   | **Recording**     | 3s + sound length + extra time (max 23s) + 2.5s | **muted**          | A 3-2-1 countdown, then everyone records at the same time. A level meter shows the mic is picking up sound. Then "Time's up!" while the last recordings arrive |
| 4   | **Playback**      | 3s + (clip length + 1.5s) × (players + 1)       | on, volume lowered | "Here come the attempts!", then the reference plays once more, then each recording plays in turn, in shuffled order, with the name of the player who made it   |
| 5   | **Voting**        | voting time                                     | on                 | Each player upvotes **up to 2** recordings, not their own. Clips can be replayed or downloaded. The phase ends early once everyone has voted                   |
| 6   | **Round results** | 6s                                              | on                 | Votes received this round and total scores                                                                                                                     |

After the last round comes **Final results**: a podium and per-round highlights (the most-voted clip of each round). The host can then send everyone back to the lobby. Settings and custom sounds are kept.

## Scoring

- Each upvote received is worth **1 point**.
- Players who didn't record get 0 for the round. They can still vote.
- Ties are shared: equal scores get the same podium place.

## Edge cases

| Situation                      | Behavior                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A player leaves during a round | Their recording, if uploaded, is still played and can receive votes. Their votes still count. They drop off the scoreboard if they don't come back before the game ends |
| A player disconnects           | They have 30s to reconnect into the same seat. Their session token is kept in sessionStorage (per tab, survives a reload)                                               |
| A recording fails to upload    | That player is shown as "no recording" for the round                                                                                                                    |
| Nobody recorded                | Playback and voting are skipped; the game goes straight to round results                                                                                                |
| Fewer than 2 players remain    | The game ends early and shows final results                                                                                                                             |
| A player denies mic permission | They can still join, hear, vote and spectate, but they can't record or talk                                                                                             |
| The host leaves mid-game       | The game continues; host rights move to the next player                                                                                                                 |
