import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['browser.spec.ts','tower-runtime.browser.spec.ts'], fullyParallel: true, workers: 2,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'npm run preview:demo', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
