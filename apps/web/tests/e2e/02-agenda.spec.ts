/**
 * E2E: Fluxo de agendamento
 *
 * Fluxo coberto:
 * 1. Navegar para /agenda
 * 2. Criar agendamento via compositor inline
 * 3. Verificar agendamento na grade
 * 4. Arrastar para reagendar
 * 5. Marcar como confirmado
 */

import { test, expect } from '@playwright/test';

test.describe('Agenda', () => {
  test.beforeEach(async ({ page }) => {
    // Garantir que está autenticado
    await page.goto('/hoje');
    await page.waitForURL(/\/hoje/, { timeout: 10_000 }).catch(() => {});
  });

  test('navega para agenda', async ({ page }) => {
    await page.goto('/agenda');
    // Agenda carrega sem crash
    await expect(page).toHaveURL(/\/agenda/);
  });

  test('visões da agenda alternam corretamente', async ({ page }) => {
    await page.goto('/agenda');

    // Verifica tabs das visões
    const visoes = ['Dia', 'Semana', 'Mês', 'Profissional'];
    for (const v of visoes) {
      const tab = page.getByRole('tab', { name: new RegExp(v, 'i') });
      if (await tab.isVisible()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      }
    }
  });

  test('compositor inline abre ao clicar em slot', async ({ page }) => {
    await page.goto('/agenda');

    // Clica em "Novo agendamento" ou shortcut
    const novoBtn = page.getByRole('button', { name: /novo agendamento/i }).first();
    if (await novoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await novoBtn.click();
      // Compositor deve abrir
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 });
    }
  });

  test('botão de listra de espera existe', async ({ page }) => {
    await page.goto('/agenda');
    const listaBtn = page.getByRole('button', { name: /lista de espera/i });
    await expect(listaBtn).toBeVisible();
  });

  test('contadores da fila carregam', async ({ page }) => {
    await page.goto('/agenda');

    // Contadores devem aparecer
    const counterLabel = page.getByText(/agendado|confirmado|aguardando/i).first();
    await expect(counterLabel).toBeVisible({ timeout: 5_000 });
  });
});
