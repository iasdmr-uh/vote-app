import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4174'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Use npm run test:e2e:integration to provide an isolated DATABASE_URL')

export default defineConfig({
  testDir: './tests/e2e/integration',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'test-results/e2e-real-results.json' }],
  ],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results/e2e-real',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run start:dev --workspace @asdmr/api',
      url: 'http://127.0.0.1:3300/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        MODERATOR_ACCESS_TOKEN: process.env.MODERATOR_ACCESS_TOKEN!,
        WEB_ORIGIN: baseURL,
        PUBLIC_APP_URL: baseURL,
        API_PORT: '3300',
      },
    },
    {
      command: 'npm run dev --workspace @asdmr/web -- --host 127.0.0.1 --port 4174 --strictPort',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_URL: 'http://127.0.0.1:3300/api/v1',
        VITE_SOCKET_URL: 'http://127.0.0.1:3300/events',
      },
    },
  ],
})
