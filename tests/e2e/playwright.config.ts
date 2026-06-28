import { defineConfig, devices } from '@playwright/test';

/**
 * E2E test config. We boot docker-compose ahead of time (CI workflow does
 * this; locally you run `pnpm dev` in another tab and skip the webServer).
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false, // shared DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
});
