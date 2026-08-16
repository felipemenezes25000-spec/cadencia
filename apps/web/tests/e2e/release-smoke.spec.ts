import { expect, test } from '@playwright/test';

function obrigatoria(nome: 'E2E_EMAIL' | 'E2E_PASSWORD'): string {
  const valor = process.env[nome];
  if (valor === undefined || valor.trim() === '') {
    throw new Error(`${nome} obrigatoria para o smoke de release`);
  }
  return valor;
}

test.describe('release smoke', () => {
  test('autentica e abre os fluxos clinicos essenciais sem 5xx', async ({ page }) => {
    const email = obrigatoria('E2E_EMAIL');
    const senha = obrigatoria('E2E_PASSWORD');

    const login = await page.goto('/entrar');
    expect(login?.status() ?? 599).toBeLessThan(500);
    await page.getByLabel(/email|usuário/i).fill(email);
    await page.getByLabel(/senha/i).fill(senha);
    await page.getByRole('button', { name: /entrar|logar/i }).click();
    await expect(page).toHaveURL(/\/hoje/, { timeout: 15_000 });

    for (const rota of ['/hoje', '/agenda', '/pacientes']) {
      const resposta = await page.goto(rota);
      expect(resposta, `sem resposta HTTP em ${rota}`).not.toBeNull();
      expect(resposta!.status(), `${rota} devolveu ${resposta!.status()}`).toBeLessThan(500);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error|Application error/i);
    }
  });
});
