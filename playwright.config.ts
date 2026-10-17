import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Each test runs several browsers doing WebRTC, recording and audio on this one machine; more
  // parallel workers starve them (voice detection, short game phases) and make tests flaky.
  workers: 2,
  use: {
    baseURL: 'http://localhost:5173',
  },
  // WebRTC differs a lot between engines (e.g. Firefox ignores loopback ICE candidates).
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Fake mic (a periodic beep) without hardware or a permission prompt.
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
  ],
  // Two entries so each port is checked: a leftover web server alone must not pass for a full stack.
  webServer: [
    {
      command: 'pnpm --filter @cyrp/server dev',
      url: 'http://localhost:3000/api/health',
      // Shorter game phases. Only applies when Playwright starts the server itself.
      env: { GAME_FAST: '1' },
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
