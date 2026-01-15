import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for Stag Financial Planning App
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  // Console output only - no HTML report files
  reporter: 'list',

  // Don't store test results on disk
  outputDir: undefined,

  use: {
    // Base URL for all tests - includes /Stag/ base path
    baseURL: 'http://localhost:5173/Stag/',

    // Disable trace collection
    trace: 'off',

    // Disable screenshot storage
    screenshot: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Add Firefox/WebKit for CI if needed
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
  ],

  // Run local dev server before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/Stag/',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
