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
