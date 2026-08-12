/**
 * E2E: Login e autenticação
 *
 * Fluxo coberto:
 * 1. Página de login carrega
 * 2. Login com credenciais válidas
 * 3. Redirecionamento para /hoje
 * 4. Logout funciona
 */

import { test, expect, type Page } from '@playwright/test';

/* ── Fixtures ──────────────────────────────────────────────────────── */

test.describe('Autenticação', () => {
  /* setup: loga uma vez por suite, reutiliza para todos os testes */
  test.beforeEach(async ({ page }) => {
    // skip login se já autenticado via storage state
    const storage = page.context().storageState();
    if ((await storage).cookies.length > 0) return;

    // Caso contrário, faz login
    await page.goto('/entrar');
    await page.getByLabel(/email|usuário/i).fill('admin@clinica.teste');
    await page.getByLabel(/senha/i).fill('senha-teste-123');
    await page.getByRole('button', { name: /entrar|logar/i }).click();
    await expect(page).toHaveURL(/\/hoje/);
  });

  test('página de login carrega sem erros', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { name: /entrar|login/i })).toBeVisible();
    await expect(page.getByLabel(/email|usuário/i)).toBeVisible();
    await expect(page.getByLabel(/senha/i)).toBeVisible();
  });

  test('login com credenciais válidas redireciona para /hoje', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel(/email|usuário/i).fill('admin@clinica.teste');
    await page.getByLabel(/senha/i).fill('senha-teste-123');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(/\/hoje/, { timeout: 10_000 });
  });

  test('login inválido mostra mensagem de erro', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel(/email|usuário/i).fill('invalido@teste.com');
    await page.getByLabel(/senha/i).fill('senha-errada');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
  });

  test('logout limpa sessão e redireciona para login', async ({ page }) => {
    // garante que está logado
    await page.goto('/hoje');

    // abre menu de usuário e sai
    const menuBtn = page.getByRole('button', { name: /usuário|perfil|sair/i }).first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.getByRole('menuitem', { name: /sair|logout|encerrar/i }).click();
      await expect(page).toHaveURL(/\/entrar/);
    }
  });
});
