import { expect, test, type Page } from '@playwright/test';

// A full game takes a while even with GAME_FAST=1 (see playwright.config.ts).
test.setTimeout(120_000);

async function join(page: Page, nickname: string, code?: string) {
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  return (await page.getByTestId('room-code').textContent())!.trim();
}

const phase = (page: Page) => page.getByTestId('phase');

/** Votes for the first attempt that isn't the player's own, then sends the ballot. */
async function voteForSomeoneElse(page: Page) {
  await expect(phase(page)).toHaveText('Vote', { timeout: 45_000 });
  await page.getByTestId('vote-list').getByRole('button', { name: 'Vote' }).first().click();
  await page.getByRole('button', { name: 'Send my votes' }).click();
}

test('three players play a 2-round game from lobby back to lobby', async ({ browser }) => {
  const pages = await Promise.all(
    [0, 1, 2].map(async () => (await browser.newContext()).newPage()),
  );
  const [alice, bob, carol] = pages as [Page, Page, Page];

  const code = await join(alice, 'Alice');
  await join(bob, 'Bob', code);
  await join(carol, 'Carol', code);
  await alice.getByLabel('Rounds').fill('2');
  await expect(bob.getByText('Rounds').locator('..')).toContainText('2');

  await alice.getByRole('button', { name: 'Start game' }).click();
  for (const page of pages) await expect(phase(page)).toHaveText('New round');

  for (const round of [1, 2]) {
    // Everyone records (fake mic): playback then has all three attempts. ("Done" is too brief
    // to assert per player: the last upload ends the phase immediately.)
    await Promise.all(
      pages.map(async (page) => {
        await expect(page.getByText(`Round ${round}/2`).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('playback')).toContainText('of 3', { timeout: 45_000 });
      }),
    );
    // Everyone hears the attempts, then votes for one of the others.
    for (const page of pages) await voteForSomeoneElse(page);
    for (const page of pages) {
      await expect(phase(page)).toHaveText(round === 2 ? /Results|Final results/ : 'Results');
    }
    await expect(alice.getByTestId('round-results').getByRole('listitem')).toHaveCount(3);
  }

  for (const page of pages) {
    await expect(phase(page)).toHaveText('Final results', { timeout: 30_000 });
  }
  // 3 players × 1 vote × 2 rounds.
  const scores = await Promise.all(
    ['Alice', 'Bob', 'Carol'].map(async (n) =>
      Number(await alice.getByTestId(`score-${n}`).textContent()),
    ),
  );
  expect(scores.reduce((a, b) => a + b, 0)).toBe(6);
  await expect(alice.getByTestId('podium')).toBeVisible();

  await expect(bob.getByRole('button', { name: 'Back to the lobby' })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Back to the lobby' }).click();
  for (const page of pages) await expect(page.getByTestId('room-code')).toHaveText(code);
});
