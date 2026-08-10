import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITENS_NAV } from './nav';
import { ABAS_FINANCEIRO } from '../telas/FinanceiroLayout';

/**
 * Todo destino declarado tem que ser uma pagina que existe.
 *
 * O Next publica a rota assim que o arquivo aparece, e NADA obriga alguem a
 * linkar para ela — nem obriga um link a apontar para arquivo existente. O
 * TypeScript valida o link que existe e nunca reclama do link que falta ou do
 * que aponta para o vazio. Duas consequencias reais, as duas em producao:
 *
 *   - a aba "Convenios" do Financeiro apontava para `/financeiro/convenios`,
 *     pagina que nunca existiu: clique visivel, 404 na cara do usuario. O teste
 *     de unidade da aba afirmava `toHaveBeenCalledWith('/financeiro/convenios')`
 *     — verificava o MECANISMO (o clique navega) sem verificar o EFEITO (o
 *     destino existe), entao a suite ficava verde com a tela quebrada;
 *   - `/convenios`, `/explorar` e `/configuracoes` existiam, respondiam 200 e
 *     nao tinham item de navegacao nenhum: modulos inteiros invisiveis.
 *
 * Este teste le o disco em vez de uma lista escrita a mao, de proposito: uma
 * lista precisaria ser atualizada junto, e e exatamente esse tipo de atualizacao
 * que ninguem lembra de fazer.
 */

const RAIZ_APP = resolve(import.meta.dirname, '..', '..', 'app');

/** Caminhos publicados pelo App Router: todo diretorio com `page.tsx`. */
function rotasNoDisco(dir: string, prefixo = ''): string[] {
  const achadas: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isFile() && item.name === 'page.tsx') {
      achadas.push(prefixo === '' ? '/' : prefixo);
      continue;
    }
    if (item.isDirectory()) {
      achadas.push(...rotasNoDisco(join(dir, item.name), `${prefixo}/${item.name}`));
    }
  }
  return achadas;
}

const ROTAS = new Set(rotasNoDisco(RAIZ_APP));

/** `/pacientes/[id]` casa `/pacientes/qualquer-coisa`. */
function existe(href: string): boolean {
  const alvo = href.split('?')[0] ?? href;
  if (ROTAS.has(alvo)) return true;
  const partes = alvo.split('/');
  return [...ROTAS].some((rota) => {
    const r = rota.split('/');
    if (r.length !== partes.length) return false;
    return r.every((seg, i) => seg.startsWith('[') || seg === partes[i]);
  });
}

describe('todo destino declarado leva a uma pagina que existe', () => {
  it('o disco realmente tem paginas (o teste nao pode passar por ler vazio)', () => {
    expect(ROTAS.size).toBeGreaterThan(20);
    expect(ROTAS.has('/convenios')).toBe(true);
  });

  it.each(ITENS_NAV.map((i) => [i.rotulo, i.href] as const))(
    'item de navegacao %s -> %s', (_rotulo, href) => {
      expect(existe(href)).toBe(true);
    });

  it.each(ABAS_FINANCEIRO.map((a) => [a.rotulo, a.href] as const))(
    'aba do Financeiro %s -> %s', (_rotulo, href) => {
      expect(existe(href)).toBe(true);
    });
});
