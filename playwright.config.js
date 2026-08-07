import { defineConfig } from '@playwright/test'

// Extension tests need a persistent context they launch themselves, so there's
// no `use.browserName` here — each spec calls launchPersistentContext with
// --load-extension. Workers are serialised because they share one profile
// directory and one loaded extension.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? 'list' : [['list']],
})
