import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// One dub round: about 30s with GAME_FAST=1, more at normal speed.
test.setTimeout(180_000);

/**
 * Tests can't depend on YouTube: a stand-in for its player API. It logs each play with its
 * sound on or off, and reports a time set with `ytTime` (the moment a player scrubbed to).
 */
const FAKE_API = `
window.ytPlays = [];
window.YT = {
  Player: class {
    constructor(_frame, { events }) {
      this.events = events;
      this.at = 0;
      this.muted = false;
      setTimeout(() => events.onReady(), 0);
    }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    setVolume() {}
    seekTo(seconds) { this.at = seconds; }
    playVideo() {
      window.ytPlays.push({ at: this.at, muted: this.muted });
      setTimeout(() => this.events.onStateChange({ data: 1 }), 50);
    }
    pauseVideo() {}
    getCurrentTime() { return window.ytTime ?? this.at; }
    getDuration() { return 600; }
  },
};
window.onYouTubeIframeAPIReady();
`;

async function fakeYouTube(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_API }),
  );
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>video</title>' }),
  );
}

async function join(page: Page, nickname: string, code?: string) {
  await fakeYouTube(page);
  await page.goto(code ? `/r/${code}` : '/');
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: code ? 'Join' : 'Create room' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  return (await page.getByTestId('room-code').textContent())!.trim();
}

const setVideoTime = (page: Page, seconds: number | null) =>
  page.evaluate((s) => {
    (window as unknown as { ytTime?: number }).ytTime = s ?? undefined;
  }, seconds);

test('dub mode: a player adds a YouTube clip, and everyone hears the mashup', async ({
  newPlayer,
}) => {
  const pages = await Promise.all([0, 1, 2].map(() => newPlayer()));
  const [alice, bob, carol] = pages as [Page, Page, Page];
  const code = await join(alice, 'Alice');
  await join(bob, 'Bob', code);
  await join(carol, 'Carol', code);

  await alice.getByRole('button', { name: 'Dub', exact: true }).click();
  await expect(bob.getByTestId('mode-hint')).toContainText('YouTube');
  await alice.getByLabel('Rounds').fill('1');

  // Any player can add a clip: a link that isn't YouTube is refused, a real one shows the video.
  await bob.getByLabel('YouTube link').fill('https://example.com/video');
  await expect(bob.getByText('That isn’t a link to a YouTube video.')).toBeVisible();
  await bob.getByLabel('YouTube link').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(bob.getByTestId('clip-preview')).toBeVisible();

  // Marking the moments: the end must come after the start, however far.
  await expect(bob.getByRole('button', { name: 'Start here' })).toBeEnabled();
  await setVideoTime(bob, 10);
  await bob.getByRole('button', { name: 'Start here' }).click();
  await setVideoTime(bob, 5);
  await bob.getByRole('button', { name: 'End here' }).click();
  await expect(bob.getByText('at least a second after the start')).toBeVisible();
  await bob.getByLabel('Name of the clip').fill('The big scene');
  await expect(bob.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await setVideoTime(bob, 12);
  await bob.getByRole('button', { name: 'End here' }).click();
  await expect(bob.getByTestId('clip-times')).toHaveText('0:10.0 → 0:12.0');
  await bob.getByRole('button', { name: 'Add', exact: true }).click();
  await setVideoTime(bob, null);

  // The clip is in the room; the host ticks it, and only then can the game start.
  await expect(alice.getByTestId('sound-The big scene')).toBeVisible();
  await expect(alice.getByText('Tick at least one clip.')).toBeVisible();
  await alice.getByRole('button', { name: 'All', exact: true }).click();
  await alice.getByRole('button', { name: 'Start game' }).click();

  for (const page of pages) {
    await expect(page.getByTestId('dub-video')).toBeVisible({ timeout: 30_000 });
  }
  await expect(alice.getByTestId('recorder')).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('[data-status="recording"]')).toContainText('Dub it', {
    timeout: 15_000,
  });

  // One mashup for everyone, then the end: no votes, no podium.
  for (const page of pages) {
    await expect(page.getByTestId('playback')).toContainText('Everyone at once', {
      timeout: 45_000,
    });
  }
  for (const page of pages) {
    await expect(page.getByTestId('dub-end')).toBeVisible({ timeout: 45_000 });
  }

  // The clip played with sound first, then muted (recording, then the mashup), always from its
  // start.
  const plays = await alice.evaluate(
    () => (window as unknown as { ytPlays: { at: number; muted: boolean }[] }).ytPlays,
  );
  expect(plays.map((p) => p.muted)).toEqual([false, true, true]);
  for (const play of plays) expect(play.at).toBeCloseTo(10, 0);
});
