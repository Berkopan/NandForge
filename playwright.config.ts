import { defineConfig, devices } from '@playwright/test';

const externalServer = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalServer ?? 'http://127.0.0.1:4174/NandForge/';
const allBrowsers = process.env.PLAYWRIGHT_ALL_BROWSERS === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  globalTimeout: 10 * 60_000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    ...(allBrowsers ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } },
      { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
    ] : []),
  ],
  webServer: externalServer ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4174',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
