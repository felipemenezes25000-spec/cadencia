/**
 * E2E: Acessibilidade básica
 *
 * Verifica que elementos críticos são acessíveis.
 */

import { test, expect, type Page } from '@playwright/test';

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

    for (let i = 0; i < Math.min(count, 10); i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute('aria-label');
      const text = await btn.textContent();
      const title = await btn.getAttribute('title');

      // Pelo menos um deve existir
      expect(ariaLabel ?? text?.trim() ?? title).toBeTruthy();
    }
  });

  test('campos de formulário têm labels', async ({ page }) => {
    await page.goto('/entrar');

    // Inputs devem ter labels associados
    const inputs = page.getByRole('textbox');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      // label associada ou aria-label
      const label = page.getByText(/email|senha|usuário/i).first();
      const hasAccessibleName =
        (await input.getAttribute('aria-label')) ||
        (await input.getAttribute('aria-labelledby')) ||
        (await label.isVisible());
      expect(hasAccessibleName).toBeTruthy();
    }
  });
});
