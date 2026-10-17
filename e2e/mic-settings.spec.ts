import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Counts getUserMedia calls: each one can show the browser's permission prompt (Firefox). */
async function countMicRequests(page: Page) {
  await page.addInitScript(() => {
    const w = window as typeof window & { micRequests: number };
    w.micRequests = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      w.micRequests++;
      return original(constraints);
    };
  });
}
const micRequests = (page: Page) =>
  page.evaluate(() => (window as typeof window & { micRequests: number }).micRequests);

async function enter(page: Page, nickname: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('voice-status')).toHaveText('Voice connected', { timeout: 15_000 });
  return (await page.getByTestId('room-code').textContent())!.trim();
}

test('mic level indicator, also while muted', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const code = await enter(alice, 'Alice');
  await enter(bob, 'Bob', code);

  // The fake mic makes sound: the indicator sees it, client side.
  const meter = alice.getByTestId('mic-level');
  await expect(meter).toHaveAttribute('data-detected', 'true', { timeout: 10_000 });

  // Muted: others see the mic-off badge, but the meter still works (mic test).
  await alice.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(bob.getByTestId('player-Alice').getByTitle('Mic off')).toBeVisible();
  // The meter reads the mic itself, not the (now silent) voice track: it still hears sound.
  // (Chrome's fake mic beeps on and off, Firefox's plays a continuous tone.)
  await alice.waitForTimeout(1000);
  await expect(meter).toHaveAttribute('data-detected', 'true', { timeout: 10_000 });
});

test('pick another microphone without dropping voice', async ({ newPlayer, browserName }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  await countMicRequests(alice);
  const code = await enter(alice, 'Alice');
  await enter(bob, 'Bob', code);
  expect(await micRequests(alice)).toBe(1);

  await alice.getByRole('button', { name: 'Mic settings' }).click();
  const select = alice.getByLabel('Microphone');
  const options = select.locator('option');
  // "Browser default" + at least one real mic, with labels (the mic is granted).
  await expect(options).not.toHaveCount(1);
  await expect(alice.getByTestId('mic-test-status')).toHaveText('Sound detected ✓', {
    timeout: 10_000,
  });

  test.skip(browserName !== 'chromium', 'only Chromium exposes several fake microphones');
  const ids = await options.evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
  const other = ids.filter((id) => id && id !== 'default' && id !== 'communications').at(-1)!;
  await select.selectOption(other);
  await expect(select).toHaveValue(other);
  expect(await micRequests(alice)).toBe(2); // exactly one more request for the switch

  // Voice keeps going on the new mic: still connected, and Bob still hears Alice speak.
  await expect(alice.getByTestId('voice-status')).toHaveText('Voice connected');
  await expect(bob.getByTestId('player-Alice').locator('[data-speaking="true"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(alice.getByTestId('mic-level')).toHaveAttribute('data-detected', 'true', {
    timeout: 10_000,
  });

  // The choice is remembered for the next visit.
  expect(await alice.evaluate(() => localStorage.getItem('cyrp.audioInput'))).toBe(other);
});

test('mic boost is saved; listeners can raise a voice to 300%', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const errors: string[] = [];
  bob.on('pageerror', (e) => errors.push(e.message));
  const code = await enter(alice, 'Alice');
  await enter(bob, 'Bob', code);

  // Sender side: the boost is remembered across visits.
  await alice.getByRole('button', { name: 'Mic settings' }).click();
  await alice.getByLabel('Mic boost').fill('2.5');
  await expect(alice.getByTestId('mic-boost-value')).toHaveText('250%');
  await alice.reload();
  await expect(alice.getByTestId('voice-status')).toHaveText('Voice connected', {
    timeout: 15_000,
  });
  await expect(alice.getByTestId('mic-boost-value')).toHaveText('250%');

  // Listener side: above 100% (an <audio> element would throw past 1.0).
  await bob.getByLabel('Volume of Alice').fill('3');
  await expect(bob.getByTestId('volume-Alice')).toHaveText('300%');
  await expect(bob.getByTestId('player-Alice').locator('[data-speaking="true"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(bob.getByTestId('voice-status')).toHaveText('Voice connected');
  expect(errors).toEqual([]);
});
