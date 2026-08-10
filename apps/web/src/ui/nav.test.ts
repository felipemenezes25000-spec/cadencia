import { describe, expect, it } from 'vitest';
import {
  ITENS_NAV, CONFIG_NAV, FASE_ATUAL, indiceDeNavegacao,
  type ItemNav,
} from './nav';

describe('nav', () => {
  it('ITENS_NAV tem workspace e gestao', () => {
    const grupos = new Set(ITENS_NAV.map((i) => i.grupo));
    expect(grupos).toEqual(new Set(['workspace', 'gestao']));
  });

  it('todos os itens tem disponivelNaFase <= FASE_ATUAL', () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });

  it('atalhos sao unicos e sequenciais a partir de 1', () => {
    const atalhos = ITENS_NAV
      .filter((i): i is ItemNav & { atalho: string } => i.atalho !== undefined)
      .map((i) => i.atalho);
    expect(atalhos).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('nenhum href duplicado entre itens de topo', () => {
    const hrefs = ITENS_NAV.map((i) => i.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it('CONFIG_NAV tem filhos e nao tem atalho numerico', () => {
    expect(CONFIG_NAV.filhos.length).toBeGreaterThan(0);
    expect(CONFIG_NAV).not.toHaveProperty('atalho');
  });

  it('indiceDeNavegacao inclui todos os itens e filhos', () => {
    const indice = indiceDeNavegacao();
    expect(indice.length).toBeGreaterThan(ITENS_NAV.length);
    for (const item of ITENS_NAV) {
      expect(indice.find((i) => i.id === item.id)).toBeDefined();
    }
    expect(indice.find((i) => i.id === CONFIG_NAV.id)).toBeDefined();
    for (const filho of CONFIG_NAV.filhos) {
      expect(indice.find((i) => i.id === filho.id)).toBeDefined();
    }
  });

  it('nenhum id duplicado no indice', () => {
    const indice = indiceDeNavegacao();
    const ids = indice.map((i) => i.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('convenios tem disponivelNaFase 4', () => {
    const conv = ITENS_NAV.find((i) => i.id === 'convenios');
    expect(conv).toBeDefined();
    expect(conv!.disponivelNaFase).toBe(4);
  });

  it('relatorios aponta para /explorar', () => {
    const rel = ITENS_NAV.find((i) => i.id === 'relatorios');
    expect(rel).toBeDefined();
    expect(rel!.href).toBe('/explorar');
  });
});
