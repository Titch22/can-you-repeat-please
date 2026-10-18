import { beepWav } from './fixtures';

const SOUNDS = 'http://localhost:3100';
// The sounds service's development token (SOUNDS_ADMIN_TOKEN is unset in dev).
const TOKEN = process.env.SOUNDS_ADMIN_TOKEN ?? 'dev-admin';

interface Sound {
  id: string;
  tags: string[];
  lines: { speaker: string }[];
}

async function add(label: string, wav: Buffer, tags: string[]) {
  const query = new URLSearchParams({ label });
  for (const t of tags) query.append('tag', t);
  const res = await fetch(`${SOUNDS}/v1/sounds?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: new Uint8Array(wav),
  });
  // 409: the same file is already there (e.g. untagged); reuse it.
  const body = (await res.json()) as Sound & { sound?: Sound };
  if (res.status === 409 && body.sound) return body.sound;
  if (!res.ok) throw new Error(`Could not add test sounds to the library: ${res.status}`);
  return body;
}

/**
 * The game tests need library sounds: at least one sound (classic) and one dialogue (teams).
 * The library starts empty, so add short beeps (tagged "e2e") when they're missing. Delete
 * them from /admin if you like.
 */
export default async function globalSetup() {
  const sounds = (await (await fetch(`${SOUNDS}/v1/sounds`)).json()) as Sound[];
  if (sounds.length === 0) {
    for (const [label, pitch] of [
      ['E2E beep low', 330],
      ['E2E beep mid', 440],
      ['E2E beep high', 660],
    ] as const) {
      await add(label, beepWav(1, pitch), ['e2e']);
    }
  }
  const isDialogue = (s: Sound) =>
    s.tags.includes('team') &&
    s.lines.some((l) => l.speaker === 'A') &&
    s.lines.some((l) => l.speaker === 'B');
  if (!sounds.some(isDialogue)) {
    const dialogue = await add('E2E dialogue', beepWav(3, 520), ['e2e', 'team']);
    const res = await fetch(`${SOUNDS}/v1/sounds/${dialogue.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: ['e2e', 'team'],
        lines: [
          { startMs: 0, endMs: 1200, speaker: 'A' },
          { startMs: 1500, endMs: 2800, speaker: 'B' },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Could not set the test dialogue's lines: ${res.status}`);
  }
}
