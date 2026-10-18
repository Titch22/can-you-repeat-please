import type { Page } from '@playwright/test';
import { beepWav, expect, test } from './fixtures';

async function lobby(page: Page, nickname: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  return (await page.getByTestId('room-code').textContent())!.trim();
}

async function upload(page: Page, fileName: string, seconds = 1) {
  await page.getByTestId('sound-file').setInputFiles({
    name: fileName,
    mimeType: 'audio/wav',
    buffer: beepWav(seconds),
  });
  await expect(page.getByLabel('Sound name')).toHaveValue(fileName.replace(/\.wav$/, ''));
  await page.getByRole('button', { name: 'Add sound' }).click();
  await expect(page.getByTestId(`sound-${fileName.replace(/\.wav$/, '')}`)).toBeVisible();
  // The grid updates over the socket, possibly before the upload request itself has finished:
  // wait for the form to be ready again.
  await expect(page.getByRole('button', { name: 'Upload a sound' })).toBeVisible();
}

test('upload a sound, pick only uploads, and play it as the round sound', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const code = await lobby(alice, 'Alice');
  await lobby(bob, 'Bob', code);

  // 4s, so the Listen phase lasts long enough to observe even on a loaded machine (GAME_FAST).
  await upload(bob, 'Moo moo.wav', 4);
  for (const page of [alice, bob]) {
    await expect(page.getByTestId('sound-Moo moo')).toContainText('4.0s · by Bob');
  }

  // Nothing is ticked by default, uploads included: the game can't start yet.
  await expect(alice.getByTestId('sound-count')).toHaveText(/^0 of \d+ in the game$/);
  await expect(alice.getByRole('button', { name: 'Start game' })).toBeDisabled();

  // Only the host ticks sounds, by clicking anywhere on the tile (its buttons keep their action).
  await expect(bob.getByLabel('Use “Moo moo” in the game')).toBeDisabled();
  const tile = alice.getByTestId('sound-Moo moo');
  const box = alice.getByLabel('Use “Moo moo” in the game');
  await expect(box).not.toBeChecked();
  await tile.getByText('Moo moo').click();
  await expect(box).toBeChecked();
  await tile.getByRole('button', { name: 'Play “Moo moo”' }).click();
  await expect(box).toBeChecked();
  await tile.click({ position: { x: 3, y: 3 } });
  await expect(box).not.toBeChecked();
  await bob.getByTestId('sound-Moo moo').getByText('Moo moo').click(); // not the host: no effect
  await expect(box).not.toBeChecked();
  await alice.getByRole('button', { name: 'Only uploads' }).click();
  await expect(bob.getByTestId('sound-count')).toHaveText(/^1 of \d+ in the game$/);
  // Pack-independent: Moo moo is the only ticked sound.
  await expect(bob.getByTestId('sound-grid').getByRole('checkbox', { checked: true })).toHaveCount(
    1,
  );

  await alice.getByLabel('Rounds').fill('1');
  await alice.getByRole('button', { name: 'Start game' }).click();
  await expect(bob.getByTestId('phase')).toHaveText('Listen', { timeout: 15_000 });
  await expect(bob.getByText('Moo moo')).toBeVisible();
});

test('uploader and host can delete uploads; others cannot', async ({ newPlayer }) => {
  const alice = await newPlayer();
  const bob = await newPlayer();
  const carol = await newPlayer();
  const code = await lobby(alice, 'Alice');
  await lobby(bob, 'Bob', code);
  await lobby(carol, 'Carol', code);

  await upload(bob, 'Kazoo.wav');
  await upload(bob, 'Burp.wav');
  await expect(carol.getByTestId('sound-Kazoo')).toBeVisible();
  await expect(carol.getByRole('button', { name: 'Delete “Kazoo”' })).toHaveCount(0);

  await bob.getByRole('button', { name: 'Delete “Kazoo”' }).click();
  await alice.getByRole('button', { name: 'Delete “Burp”' }).click();
  for (const page of [alice, bob, carol]) {
    await expect(page.getByTestId('sound-Kazoo')).toHaveCount(0);
    await expect(page.getByTestId('sound-Burp')).toHaveCount(0);
  }
});

test('accepts sounds up to 20 seconds, rejects longer ones', async ({ newPlayer }) => {
  const alice = await newPlayer();
  await lobby(alice, 'Alice');
  await alice.getByTestId('sound-file').setInputFiles({
    name: 'Long but fine.wav',
    mimeType: 'audio/wav',
    buffer: beepWav(19),
  });
  await alice.getByRole('button', { name: 'Add sound' }).click();
  await expect(alice.getByTestId('sound-Long but fine')).toContainText('19.0s');
  await expect(alice.getByRole('button', { name: 'Upload a sound' })).toBeVisible();

  await alice.getByTestId('sound-file').setInputFiles({
    name: 'Long.wav',
    mimeType: 'audio/wav',
    buffer: beepWav(22),
  });
  await alice.getByRole('button', { name: 'Add sound' }).click();
  await expect(alice.getByRole('alert')).toContainText('too long');
});
