/**
 * E2E: Acessibilidade básica
 *
 * Verifica que elementos críticos são acessíveis.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Acessibilidade', () => {
  test('skip link existe na página', async ({ page }) => {
    await page.goto('/hoje');

    // Skip link deve existir (mesmo que invisível)
    const skipLink = page.getByRole('link', { name: /pular|skip/i });
    await expect(skipLink).toHaveCount(1);
  });

  test('landmarks principais existem', async ({ page }) => {
    await page.goto('/hoje');

    // Header/navigation principal
    await expect(page.getByRole('banner')).toBeVisible();

    // Main content
    await expect(page.getByRole('main')).toBeVisible();

    // Footer (pode não existir em todas as páginas)
    // await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test('navegação principal é acessível', async ({ page }) => {
    await page.goto('/hoje');

    // Nav deve ter aria-label
    const nav = page.getByRole('navigation').first();
    await expect(nav).toHaveAttribute('aria-label');
  });

  test('botões têm texto acessível', async ({ page }) => {
    await page.goto('/hoje');

    // Todos os botões devem ter conteúdo visível ou aria-label
    const buttons = page.getByRole('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toHaveAccessibleName(/.+/);
    }
  });

  test('campos de formulário têm labels', async ({ page }) => {
    await page.goto('/entrar');

    // Inputs devem ter labels associados
    const inputs = page.locator('input:not([type="hidden"])');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      await expect(inputs.nth(i)).toHaveAccessibleName(/.+/);
    }
  });

  test('não tem violações críticas ou sérias', async ({ page }) => {
    await page.goto('/hoje');
    const resultado = await new AxeBuilder({ page }).analyze();
    const relevantes = resultado.violations.filter((item) =>
      item.impact === 'critical' || item.impact === 'serious',
    );
    expect(relevantes).toEqual([]);
  });
});
