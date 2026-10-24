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

| Setting              | Values                                         | Default |
| -------------------- | ---------------------------------------------- | ------- |
| Game mode            | Classic, Teams (see [Game modes](#game-modes)) | Classic |
| Rounds               | 1–20                                           | 5       |
| Sounds               | Checkbox per sound: library + lobby uploads    | none    |
| Extra recording time | 0–3s added to the sound's length               | 1s      |
| Voting time          | 10–60s                                         | 20s     |
| Replay the original  | On, off (playback starts with the attempts)    | off     |

### Custom sounds

- Any player can upload sounds in the lobby. Limits: **20 seconds or less** (measured by the server), **2 MB or less**, no limit per player (at most 200 per room, as a safety net). Accepted formats: mp3, ogg, wav, webm, m4a. Several files can be uploaded at once. For a single file, the uploader names the sound (default: the file name); several files are named after their file names.
- Custom sounds belong to the lobby. They are **never stored long-term**: they live in the room's temporary folder and are **deleted when the lobby ends** (the last player leaves or the room times out), when deleted by their uploader or the host, and at every server restart.
- They stay available for the next games of the same lobby.

### Sound library

- The game's own sounds live in a **curated library**, served by a separate sounds service (see [ARCHITECTURE.md](ARCHITECTURE.md#sound-library)). Each sound has a name, a duration and **tags** (e.g. _meme_, _animal_, _movie_).
- Only an admin adds, renames, tags or deletes library sounds, on the `/admin` page (not linked from the game, unlocked by the admin token). Players can't add to the library: their uploads stay temporary (above).
- The library starts empty: the admin fills it from the admin page.

### Choosing the sounds

- The lobby lists every sound (the shared library, then the room's uploads) in a grid with a preview button and a checkbox. Only the host can tick and untick; everyone sees the selection.
- Filters narrow the grid: a name search, a maximum length (2, 3, 5 or 10 seconds) and tag chips (a sound shows if it has **any** of the selected tags; "uploaded here" shows the room's uploads). Filters are per player and only change what is shown.
- Shortcuts: **All** and **None** tick or untick every sound **shown** (so "every _animal_ sound under 3s" is two clicks), **Only uploads** ticks exactly the room's uploads.
- Nothing is ticked by default, uploads included: the host picks the sounds before starting. The whole tile is clickable.
- The game picks one ticked sound per round. A sound isn't picked again until every ticked sound has been used, so a short selection still works for long games. The game can't start until at least one sound is ticked.

## Game modes

The host picks the mode in the lobby settings.

### Classic

Everyone imitates the same sound, every attempt is played back, and everyone votes (the rest of this document).

### Teams

Random pairs dub a short movie dialogue: each member of a pair voices one of its two characters, and the pairs compete.

- **Dialogues** are library sounds tagged **team** whose lines are marked in `/admin`: for each line, who speaks (character **A** or **B**), from when to when, and what is said (the subtitle; "Suggest text" fills it with speech recognition, to correct by hand). A dialogue can also get a **background**: the same scene without the voices, made outside the app (UVR, or `demucs --two-stems=vocals`). One file per scene; any number of lines (A, B, A…). Only dialogues are listed and played in this mode; room uploads aren't used.
- **At least 3 players**, so there are always at least two teams to vote between.
- **Teams change every round**: players are shuffled into pairs, and each member of a pair gets a random character. With an odd number of players, one player is alone and voices **both** characters. Late joiners watch until the next game.
- **Listen:** the whole scene plays, with a timeline of its lines; each player's lines are outlined. Subtitles follow the scene karaoke-style: the line being said fills up word by word (timed from the audio by "Suggest text" / "Align words", by tapping along in `/admin`, or at an even pace if not timed), and the next one is dimmed.
- **Repeat:** everyone records at the same time, over the whole scene, as in Classic. A cue follows the scene: **YOUR LINE!** during your character's lines, your partner's name during theirs, and a countdown before your next line. The subtitles show what to say.
- **Playback:** the original, then each team's **stitched** performance: during each line, the recording of whoever voices that character, at the original timing. The lines of a member who didn't record stay silent. If the dialogue has a background, it plays under the voices, at the original's level.
- **Vote:** for other teams (not your own), up to 2 as in Classic. Each vote gives **a point to every member** of the team. The podium stays per player.
- Each performance can be replayed and downloaded as a WAV of the stitched scene.

## Round flow

Pause lengths are set in `apps/server/src/game/timing.ts`.

| #   | Phase             | Length                                          | Voice chat         | What happens                                                                                                                                                                                  |
| --- | ----------------- | ----------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Round intro**   | 3s                                              | on                 | "Round 2/5" title card                                                                                                                                                                        |
| 2   | **Reference**     | sound length + 3s                               | on, volume lowered | The reference sound plays for everyone at the same time, then "Get ready to repeat it!"                                                                                                       |
| 3   | **Recording**     | 3s + sound length + extra time (max 23s) + 2.5s | **muted**          | A 3-2-1 countdown, then everyone records at the same time. A level meter shows the mic is picking up sound. Then "Time's up!" while the last recordings arrive                                |
| 4   | **Playback**      | 3s + (clip length + 1.5s) × (players + 1)       | on, volume lowered | "Here come the attempts!", then the reference plays once more (if "Replay the original" is on), then each recording plays in turn, in shuffled order, with the name of the player who made it |
| 5   | **Voting**        | voting time                                     | on                 | Each player upvotes **up to 2** recordings, not their own. Clips can be replayed or downloaded. The phase ends early once everyone has voted                                                  |
| 6   | **Round results** | 6s                                              | on                 | Votes received this round and total scores                                                                                                                                                    |

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
