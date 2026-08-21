import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://zeronine-production.up.railway.app',
    headless: true,
  },
});
