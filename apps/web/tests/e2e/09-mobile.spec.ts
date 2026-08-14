/**
 * E2E: mobile.
 *
 * playwright.config.ts já declarava os projetos `mobile-chrome` (Pixel 5) e
 * `mobile-safari` (iPhone 12) — e nenhuma spec fazia uma única asserção mobile.
 * Toda a auditoria de 375px era manual, o que significa que regredia em
 * silêncio.
 *
 * As três coisas verificadas aqui são as que quebram de verdade num telefone e
 * que ninguém vê rodando no desktop:
 *
 *   1. rolagem horizontal — o defeito que estraga a página inteira
 *   2. fonte de campo abaixo de 16px — o iOS Safari dá zoom ao focar
 *   3. alvo de toque abaixo de 44px
 *
 * Roda só nos projetos mobile: no desktop as asserções não descrevem nada.
 */

import { test, expect, type Page } from '@playwright/test';

const ROTAS = [
  '/entrar', '/hoje', '/agenda', '/pacientes', '/conversas',
  '/financeiro', '/convenios', '/configuracoes', '/notificacoes', '/explorar',
] as const;

/** Só executa nos projetos de telefone. */
function apenasMobile(nomeDoProjeto: string): boolean {
  return nomeDoProjeto.startsWith('mobile');
}

/**
 * Rota autenticada sem sessão cai em /entrar pelo CLIENTE — o HTML do SSR vem
 * certo e só depois o redirect roda. Sem esta checagem o teste mede a tela de
 * login dez vezes e passa dez vezes, o que é pior do que não existir: dá o
 * sinal de coberto sem cobrir nada.
 *
 * Pula alto, com o motivo escrito, em vez de passar em falso.
 */
async function estaNaRota(page: Page, rota: string): Promise<boolean> {
  await page.waitForLoadState('networkidle').catch(() => { /* segue */ });
  return new URL(page.url()).pathname === rota;
}

async function larguraDeRolagem(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    janela: window.innerWidth,
    // Quem estoura, para o relatório não virar caça ao tesouro.
    culpados: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((el) => {
        const c = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
        return `${el.tagName.toLowerCase()}.${c}`;
      }),
  }));
}

test.describe('mobile', () => {
  for (const rota of ROTAS) {
    test(`${rota} não rola horizontalmente`, async ({ page }, info) => {
      test.skip(!apenasMobile(info.project.name), 'só nos projetos de telefone');
      await page.goto(rota);
      test.skip(
        !(await estaNaRota(page, rota)),
        `${rota} exige sessão — sobe a API e semeia o banco para esta rota valer`,
      );
      const r = await larguraDeRolagem(page);
      expect(
        r.scroll,
        `${rota} estoura ${r.scroll - r.janela}px. Suspeitos: ${r.culpados.join(', ')}`,
      ).toBeLessThanOrEqual(r.janela + 1);
    });
  }

  test('nenhum campo tem fonte abaixo de 16px', async ({ page }, info) => {
    test.skip(!apenasMobile(info.project.name), 'só nos projetos de telefone');
    /* Abaixo de 16px o iOS Safari amplia a página inteira ao focar o campo:
       o usuário toca para digitar e a tela salta. Suprimir com
       `maximum-scale=1` mataria o pinch-zoom, então a saída é a fonte. */
    await page.goto('/entrar');
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          nome: el.getAttribute('name') ?? el.getAttribute('aria-label') ?? '',
          px: parseFloat(getComputedStyle(el).fontSize),
        }))
        .filter((x) => x.px < 16));
    expect(pequenos, JSON.stringify(pequenos)).toEqual([]);
  });

  test('os alvos de toque visíveis têm ao menos 44px', async ({ page }, info) => {
    test.skip(!apenasMobile(info.project.name), 'só nos projetos de telefone');
    await page.goto('/entrar');
    const curtos = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], [role="button"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (r.top >= window.innerHeight) return false;
          /* Skip link é 1x1 até receber foco — é assim que ele fica fora do
             caminho de quem usa mouse sem sumir para o teclado. Medir o
             tamanho dele no estado oculto não diz nada. */
          const cs = getComputedStyle(el);
          const escondidoAteFoco = cs.clipPath !== 'none'
            || cs.clip !== 'auto'
            || el.className.toString().includes('sr-only');
          return !escondidoAteFoco;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            rotulo: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
            w: Math.round(r.width), h: Math.round(r.height),
          };
        })
        .filter((x) => x.h < 44 || x.w < 44));
    expect(curtos, JSON.stringify(curtos)).toEqual([]);
  });

  test('a dock inferior não cobre o fim do conteúdo', async ({ page }, info) => {
    test.skip(!apenasMobile(info.project.name), 'só nos projetos de telefone');
    await page.goto('/hoje');
    test.skip(
      !(await estaNaRota(page, '/hoje')),
      '/hoje exige sessão — sem ela cai em /entrar, que não tem dock',
    );

    const folga = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label*="óvel"]');
      const pagina = document.querySelector('.cadencia-page');
      if (!nav || !pagina) return null;
      const pb = parseFloat(getComputedStyle(pagina).paddingBottom);
      return pb - nav.getBoundingClientRect().height;
    });
    expect(folga, 'conteúdo termina embaixo da dock').not.toBeNull();
    expect(folga as number).toBeGreaterThanOrEqual(0);
  });
});
