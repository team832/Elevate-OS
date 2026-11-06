import { defineConfig } from '@playwright/test';

/** Browser checks against apps that are already running; workspace addresses: e2e/support.ts (HOME). */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  workers: 1,
  retries: 0,
  // Dev mode compiles each page on its first visit (up to 46 s on the owner's PC).
  timeout: 120_000,
  reporter: 'list',
  // The installed Chrome: no browser download.
  use: { channel: 'chrome', trace: 'retain-on-failure' },
});
