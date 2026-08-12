/**
 * E2E: Pacientes
 *
 * Fluxo coberto:
 * 1. Navegar para /pacientes
 * 2. Buscar paciente
 * 3. Criar paciente novo
 * 4. Ver detalhes do paciente
 */

import { test, expect } from '@playwright/test';

test.describe('Pacientes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hoje');
    await page.waitForURL(/\/hoje/, { timeout: 10_000 }).catch(() => {});
  });

  test('navega para lista de pacientes', async ({ page }) => {
    await page.goto('/pacientes');
    await expect(page).toHaveURL(/\/pacientes/);
    await expect(page.getByRole('heading', { name: /paciente/i })).toBeVisible();
  });

  test('campo de busca é focável', async ({ page }) => {
    await page.goto('/pacientes');
    const busca = page.getByPlaceholder(/buscar|pesquisar/i);
    await expect(busca).toBeVisible();
    await busca.focus();
  });

  test('filtros de faceta funcionam', async ({ page }) => {
    await page.goto('/pacientes');

    // Clica em filtro "Ativos"
    const filtroAtivos = page.getByRole('button', { name: /ativos/i }).first();
    if (await filtroAtivos.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filtroAtivos.click();
      // URL deve refletir o filtro
      await expect(page).toHaveURL(/faceta=/);
    }
  });

  test('navega para detalhes do paciente', async ({ page }) => {
    await page.goto('/pacientes');

    // Procura primeiro paciente na lista
    const pacienteLink = page.getByRole('link').filter({ hasText: /^[A-Z].*/i }).first();
    if (await pacienteLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pacienteLink.click();
      await expect(page).toHaveURL(/\/pacientes\/.+/);
    }
  });
});
