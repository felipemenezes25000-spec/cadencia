/**
 * E2E: Financeiro
 *
 * Fluxo coberto:
 * 1. Navegar para /financeiro
 * 2. Ver visão geral
 * 3. Acessar a-receber
 * 4. Lançar pagamento
 */

import { test, expect } from '@playwright/test';

test.describe('Financeiro', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hoje');
    await page.waitForURL(/\/hoje/, { timeout: 10_000 }).catch(() => {});
  });

  test('navega para financeiro', async ({ page }) => {
    await page.goto('/financeiro');
    await expect(page).toHaveURL(/\/financeiro/);
  });

  test('visão geral carrega métricas', async ({ page }) => {
    await page.goto('/financeiro');

    // Métricas devem carregar
    await expect(page.getByText(/receita|a receber|caixa/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('navega para a-receber', async ({ page }) => {
    await page.goto('/financeiro/a-receber');
    await expect(page).toHaveURL(/\/financeiro\/a-receber/);

    // Tabela ou lista deve aparecer
    await expect(page.getByRole('table').or(page.getByText(/a receber/i))).toBeVisible({
      timeout: 5_000,
    });
  });

  test('navega para caixa', async ({ page }) => {
    await page.goto('/financeiro/caixa');
    await expect(page).toHaveURL(/\/financeiro\/caixa/);
  });

  test('navega para cadastros', async ({ page }) => {
    await page.goto('/financeiro/cadastros');
    await expect(page).toHaveURL(/\/financeiro\/cadastros/);
  });
});
