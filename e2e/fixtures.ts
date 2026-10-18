import { test as base, type BrowserContext, type Page } from '@playwright/test';

/**
 * `newPlayer()` opens a fresh browser context (its own session = its own player) and closes
 * it when the test ends. Without that, a test's game keeps running in the background and
 * slows down the next tests.
 */
export const test = base.extend<{ newPlayer: () => Promise<Page> }>({
  newPlayer: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect } from '@playwright/test';

/** A playable mono 16-bit PCM WAV: a beep of `seconds` at `pitch` Hz. */
export function beepWav(seconds: number, pitch = 440) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * pitch * i) / rate) * 8000), 44 + i * 2);
  }
  return b;
}
