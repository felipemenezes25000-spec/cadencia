/**
 * E2E: Convênios / TISS
 *
 * Fluxo coberto:
 * 1. Navegar para /convenios
 * 2. Listar operadoras
 * 3. Listar guias
 * 4. Gerenciar lotes
 */

import { test, expect } from '@playwright/test';

test.describe('Convênios', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hoje');
    await page.waitForURL(/\/hoje/, { timeout: 10_000 }).catch(() => {});
  });

  test('navega para convenios', async ({ page }) => {
    await page.goto('/convenios');
    await expect(page).toHaveURL(/\/convenios/);
  });

  test('operadoras carregam', async ({ page }) => {
    await page.goto('/convenios/operadoras');
    // Título ou lista deve aparecer
    await expect(
      page.getByRole('heading', { name: /operadora/i }).or(page.getByText(/cadastrar/i))
    ).toBeVisible({ timeout: 5_000 });
  });

  test('guías a faturar carrega', async ({ page }) => {
    await page.goto('/convenios/guias');
    await expect(page).toHaveURL(/\/convenios\/guias/);
  });

  test('lotes carrega', async ({ page }) => {
    await page.goto('/convenios/lotes');
    await expect(page).toHaveURL(/\/convenios\/lotes/);
  });

  test('glosas carrega', async ({ page }) => {
    await page.goto('/convenios/glosas');
    await expect(page).toHaveURL(/\/convenios\/glosas/);
  });
});
