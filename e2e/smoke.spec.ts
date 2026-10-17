import { expect, test } from '@playwright/test';

test('home page loads and reaches the game server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Can You Repeat Please?' })).toBeVisible();
  await expect(page.getByTestId('server-status')).toContainText('Server connected');
});
