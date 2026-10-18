import { beepWav } from './fixtures';

const SOUNDS = 'http://localhost:3100';
// The sounds service's development token (SOUNDS_ADMIN_TOKEN is unset in dev).
const TOKEN = process.env.SOUNDS_ADMIN_TOKEN ?? 'dev-admin';

/**
 * The game tests tick "All" and need at least one library sound. The library starts empty, so
 * if it is, add a few short beeps (tagged "e2e"; delete them from /admin if you like).
 */
export default async function globalSetup() {
  const sounds = (await (await fetch(`${SOUNDS}/v1/sounds`)).json()) as unknown[];
  if (sounds.length > 0) return;
  for (const [label, pitch] of [
    ['E2E beep low', 330],
    ['E2E beep mid', 440],
    ['E2E beep high', 660],
  ] as const) {
    const res = await fetch(`${SOUNDS}/v1/sounds?label=${encodeURIComponent(label)}&tag=e2e`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: new Uint8Array(beepWav(1, pitch)),
    });
    if (!res.ok) throw new Error(`Could not add test sounds to the library: ${res.status}`);
  }
}
