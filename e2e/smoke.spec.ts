import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Can You Repeat Please?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
});
