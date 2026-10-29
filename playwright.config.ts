import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', fullyParallel: true, workers: 2,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', ...(process.env.MUSE_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.MUSE_BROWSER_EXECUTABLE } } : { channel: 'chrome' }), trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
