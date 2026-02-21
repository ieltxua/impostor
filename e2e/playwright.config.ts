import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: 'cd .. && PORT=3100 npm run dev --workspace server',
      url: 'http://127.0.0.1:3100/health',
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'cd .. && VITE_SERVER_URL=http://127.0.0.1:3100 npm run dev --workspace client -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
