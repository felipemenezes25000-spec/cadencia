/**
 * Playwright E2E Configuration
 *
 * Uso:
 *   pnpm test:e2e          # rodar todos os testes
 *   pnpm test:e2e:ui      # abrir UI do Playwright
 *   pnpm playwright test    # via CLI direto
 *
 * Ambientes:
 *   - development: http://localhost:3000
 *   - CI: via variável PLAYWRIGHT_BASE_URL
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  /* ── Output ────────────────────────────────────────────────────── */
  outputDir: '.playwright-results',
  reportDir: '.playwright-report',

  /* ── Ambientes ────────────────────────────────────────────────── */
  baseURL: BASE_URL,
  timeout: 30_000,

  /* ── Retries ─────────────────────────────────────────────────── */
  retries: 2,

  /* ── Repórteres ──────────────────────────────────────────────── */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  /* ── Browsers ────────────────────────────────────────────────── */
  projects: [
    /* ── Chromium (principal) ─── */
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },

    /* ── Firefox ─── */
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
    },

    /* ── Mobile ─── */
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 12'],
      },
    },
  ],

  /* ── WebServer (opcional) ────────────────────────────────────── */
  // Descomente se quiser que o Playwright inicie o dev server:
  // webServer: {
  //   command: 'pnpm dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 60_000,
  // },

  /* ── Acessibilidade ───────────────────────────────────────────── */
  use: {
    /* O Playwright só lê `baseURL` DENTRO de `use`. Estava declarado no nível
       raiz do defineConfig, onde é ignorado — então todo `page.goto('/rota')`
       falhava com "Cannot navigate to invalid URL" e a suíte e2e inteira
       nunca rodou com caminho relativo. A constante no topo do arquivo
       continua sendo a fonte; só o lugar estava errado. */
    baseURL: BASE_URL,

    /* Cabeçalhos customizados para testes */
    extraHTTPHeaders: {
      'X-Test-Environment': 'true',
    },
  },
});
