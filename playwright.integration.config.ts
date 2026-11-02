import { defineConfig, devices } from '@playwright/test'

// Fixed defaults keep runs reproducible; override them when another stack already holds a port.
const apiPort = process.env.E2E_API_PORT ?? '3300'
const webPort = process.env.E2E_WEB_PORT ?? '4174'
const baseURL = `http://127.0.0.1:${webPort}`
const apiURL = `http://127.0.0.1:${apiPort}`
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Use npm run test:e2e:integration to provide an isolated DATABASE_URL')

export default defineConfig({
  testDir: './tests/e2e/integration',
  fullyParallel: false,
  // Specs share one database and the API allows a single active Asamblea, so they run one after another.
  workers: 1,
  forbidOnly: true,
  // Realtime updates usually land in well under a second; the margin covers a busy laptop, never a sleep.
  expect: { timeout: 10_000 },
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
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        MODERATOR_ACCESS_TOKEN: process.env.MODERATOR_ACCESS_TOKEN!,
        WEB_ORIGIN: baseURL,
        PUBLIC_APP_URL: baseURL,
        API_PORT: apiPort,
        E2E_API_PORT: apiPort,
      },
    },
    {
      command: `npm run dev --workspace @asdmr/web -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_URL: `${apiURL}/api/v1`,
        VITE_SOCKET_URL: `${apiURL}/events`,
      },
    },
  ],
})
