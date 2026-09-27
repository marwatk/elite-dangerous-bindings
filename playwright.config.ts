import { defineConfig, devices } from '@playwright/test';

// Runs inside the dev container: `container exec edb-dev sh -c 'cd /workspace && npm run e2e'`.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  use: { baseURL: 'http://localhost:4200', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
