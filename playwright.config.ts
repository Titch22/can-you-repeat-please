import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Fake mic so game tests can record without hardware or a permission prompt.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  // Two entries so each port is checked: a leftover web server alone must not pass for a full stack.
  webServer: [
    {
      command: 'pnpm --filter @cyrp/server dev',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cyrp/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
