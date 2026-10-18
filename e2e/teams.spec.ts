import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// One teams round: about 40s with GAME_FAST=1, more at normal speed.
test.setTimeout(180_000);

async function join(page: Page, nickname: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  return (await page.getByTestId('room-code').textContent())!.trim();
}

const phase = (page: Page) => page.getByTestId('phase');

test('teams mode: a pair and a solo player dub a dialogue and vote for each other', async ({
  newPlayer,
}) => {
  const pages = await Promise.all([0, 1, 2].map(() => newPlayer()));
  const [alice, bob, carol] = pages as [Page, Page, Page];
  const code = await join(alice, 'Alice');
  await join(bob, 'Bob', code);

  // Teams mode needs 3 players, and only lists dialogues.
  await alice.getByRole('button', { name: 'Teams', exact: true }).click();
  await expect(bob.getByTestId('mode-hint')).toContainText('pairs');
  await alice.getByRole('button', { name: 'All', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await expect(alice.getByText('Waiting for at least 3 players')).toBeVisible();
  await join(carol, 'Carol', code);
  await expect(alice.getByTestId('sound-grid')).toContainText('lines');
  await alice.getByLabel('Rounds').fill('1');
  await alice.getByRole('button', { name: 'Start game' }).click();

  // Everyone learns their team: one pair, one player alone voicing both characters.
  for (const page of pages) {
    await expect(page.getByTestId('my-team')).toBeVisible({ timeout: 30_000 });
  }
  const intros = await Promise.all(pages.map((p) => p.getByTestId('my-team').textContent()));
  expect(intros.filter((t) => t?.includes('alone'))).toHaveLength(1);
  expect(intros.filter((t) => t?.includes('You’re with'))).toHaveLength(2);

  // While recording, the cue follows the dialogue: someone's line, or a wait.
  await expect(alice.getByTestId('recorder')).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('[data-status="recording"]')).toBeVisible({ timeout: 15_000 });

  // Playback: the original, then the two teams.
  for (const page of pages) {
    await expect(page.getByTestId('playback')).toContainText('of 2', { timeout: 45_000 });
  }

  // The stitched performance downloads as a WAV named after the team (before the last vote
  // ends the phase).
  await expect(phase(alice)).toHaveText('Vote', { timeout: 45_000 });
  const [download] = await Promise.all([
    alice.waitForEvent('download'),
    alice
      .getByRole('button', { name: /^Download .+’s performance$/ })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/ - .+\.wav$/);
  expect(fs.statSync(await download.path()).size).toBeGreaterThan(44);

  // Each player votes for the other team; their own is marked and has no Vote button.
  for (const page of pages) {
    await expect(phase(page)).toHaveText('Vote', { timeout: 45_000 });
    const list = page.getByTestId('vote-list');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('(your team)');
    await list.getByRole('button', { name: 'Vote' }).click();
    await page.getByRole('button', { name: 'Send my votes' }).click();
  }

  for (const page of pages) {
    await expect(phase(page)).toHaveText(/Results|Final results/, { timeout: 30_000 });
  }
  // Every player got their team's vote(s): the pair 1 (from the solo player), the solo 2.
  await expect(alice.getByTestId('podium')).toBeVisible({ timeout: 30_000 });
  const scores = await Promise.all(
    ['Alice', 'Bob', 'Carol'].map(async (n) =>
      Number(await alice.getByTestId(`score-${n}`).textContent()),
    ),
  );
  expect(scores.sort()).toEqual([1, 1, 2]);
});
