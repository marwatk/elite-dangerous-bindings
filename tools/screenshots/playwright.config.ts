import { defineConfig, devices } from '@playwright/test';

// Screenshot tooling for visual checks: NOT tests, never run in CI.
// Run from the repo root inside the dev container, e.g.
//   npm run shots                   # all
//   npm run shots -- cards          # files matching "cards"
// Output: test-results/shots/<area>/*.png
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.shots.ts',
  outputDir: '../../test-results/shots-run',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:4200' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    cwd: '../..',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
