import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Two modes, picked by E2E_BASE_URL:
 *   unset → "fixture" mode. Serves the static export in apps/web/out (built without
 *           NEXT_PUBLIC_API_URL, so every screen runs on fixtures) and bypasses auth gates
 *           with `?preview=1`. This is what CI runs.
 *   set   → "live" mode against a deployed site (dev by default via `pnpm e2e:dev`). Signs in
 *           once with the smoke account from the repo-root `.env.dev-smoke` and reuses the
 *           session. Specs tagged @live only run here; fixture-only specs are skipped.
 */
const live = !!process.env.E2E_BASE_URL;
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

// Load .env.dev-smoke (gitignored) without a dotenv dependency: KEY=VALUE lines only.
if (live) {
  try {
    const env = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../.env.dev-smoke'),
      'utf8',
    );
    for (const line of env.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2]?.replace(/^"|"$/g, '');
    }
  } catch {
    /* no smoke credentials: @live specs that need a session will fail with a clear message */
  }
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  grep: live ? undefined : /^(?!.*@live)/,
  testIgnore: live ? [] : [/auth\.setup\.ts/],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    ...(live ? [{ name: 'setup', testMatch: /auth\.setup\.ts/ }] : []),
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: live ? 'e2e/.auth/smoke.json' : undefined,
      },
      dependencies: live ? ['setup'] : [],
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        storageState: live ? 'e2e/.auth/smoke.json' : undefined,
      },
      dependencies: live ? ['setup'] : [],
    },
  ],
  webServer: live
    ? undefined
    : {
        command: 'node e2e/serve.mjs 4173',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
      },
});
