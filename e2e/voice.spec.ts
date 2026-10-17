import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Needs a LiveKit server (`docker compose up -d`); skipped otherwise.
const livekitUp = await fetch('http://localhost:7880')
  .then((r) => r.ok)
  .catch(() => false);

test.skip(!livekitUp, 'LiveKit is not running (docker compose up -d)');

async function enterLobby(page: Page, nickname: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('voice-status')).toHaveText('Voice connected', { timeout: 15_000 });
  return (await page.getByTestId('room-code').textContent())!.trim();
}

const micOff = (viewer: Page, nickname: string) =>
  viewer.getByTestId(`player-${nickname}`).getByTitle('Mic off');

test('voice lobby: speaking indicator, self-mute, and the game mute', async ({ newPlayer }) => {
  // The fake mic plays a periodic beep, which LiveKit detects as speech.
  const alice = await newPlayer();
  const bob = await newPlayer();

  const code = await enterLobby(alice, 'Alice');
  await enterLobby(bob, 'Bob', code);

  await expect(bob.getByTestId('player-Alice').locator('[data-speaking="true"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(micOff(bob, 'Alice')).toHaveCount(0);

  // Self-mute is visible to others.
  await bob.getByRole('button', { name: 'Mute' }).click();
  await expect(micOff(alice, 'Bob')).toBeVisible();
  await bob.getByRole('button', { name: 'Unmute' }).click();
  await expect(micOff(alice, 'Bob')).toHaveCount(0);

  // The game mute silences everyone, then everyone comes back.
  await alice.getByRole('button', { name: 'Test recording mute' }).click();
  await expect(bob.getByTestId('room-status')).toHaveText(/Everyone is muted/);
  await expect(micOff(bob, 'Alice')).toBeVisible();
  await expect(micOff(alice, 'Bob')).toBeVisible();
  // Bob's own mute button can't bring his mic back while the game mute is on.
  await expect(micOff(bob, 'Bob')).toBeVisible();

  await alice.getByRole('button', { name: 'End test mute' }).click();
  await expect(bob.getByTestId('room-status')).toHaveText(/Room open · 2 players · voice chat on/);
  await expect(micOff(bob, 'Alice')).toHaveCount(0, { timeout: 10_000 });
  await expect(micOff(alice, 'Bob')).toHaveCount(0, { timeout: 10_000 });
});

test('a kicked player is removed from voice', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const code = await enterLobby(alice, 'Alice');
  await enterLobby(bob, 'Bob', code);

  await alice.getByRole('button', { name: 'Kick' }).click();
  await expect(bob).toHaveURL(/\/$/);
  await expect(alice.getByTestId('player-list').getByRole('listitem')).toHaveCount(1);
});
