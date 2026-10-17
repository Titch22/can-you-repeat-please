import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function createRoom(page: Page, nickname: string) {
  await page.goto('/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z]{4}$/);
  return (await page.getByTestId('room-code').textContent())!.trim();
}

test('create, join by link, sync settings, resume after reload, kick', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();

  const code = await createRoom(alice, 'Alice');
  await expect(alice.getByTestId('room-status')).toHaveText(/waiting for players \(1\/2\)/);

  // Bob arrives through the invite link.
  await bob.goto(`/r/${code}`);
  await bob.getByLabel('Nickname').fill('Bob');
  await bob.getByRole('button', { name: 'Join' }).click();
  for (const page of [alice, bob]) {
    await expect(page.getByTestId('player-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('room-status')).toHaveText(/Room open · 2 players/);
  }

  // Only the host can edit settings; changes reach everyone.
  await expect(bob.getByLabel('Rounds')).toBeDisabled();
  await alice.getByLabel('Rounds').fill('8');
  await expect(bob.getByText('Rounds').locator('..')).toContainText('8');

  // Reloading keeps Bob's seat.
  await bob.reload();
  await expect(bob.getByTestId('room-code')).toHaveText(code);
  await expect(alice.getByTestId('player-list').getByRole('listitem')).toHaveCount(2);

  // Kicked players land on the home page with a notice.
  await alice.getByRole('button', { name: 'Kick' }).click();
  await expect(bob).toHaveURL(/\/$/);
  await expect(bob.getByText('You were kicked by the host.')).toBeVisible();
  await expect(alice.getByTestId('player-list').getByRole('listitem')).toHaveCount(1);
});

test('joining from the home page with a code, and a duplicate nickname', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const code = await createRoom(alice, 'Alice');

  await bob.goto('/');
  await bob.getByLabel('Nickname').fill('alice');
  await bob.getByLabel('Room code').fill(code.toLowerCase());
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(bob.getByRole('alert')).toContainText('already uses that nickname');

  await bob.getByLabel('Nickname').fill('Bob');
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(bob.getByTestId('room-code')).toHaveText(code);
});
