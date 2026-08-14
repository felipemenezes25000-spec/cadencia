import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrasteHex, lerToken } from './contrast';

/*
 * O tema efetivo é o de light-blue.css: ele é carregado por último e redefine
 * TODA a paleta de globals.css e premium.css. Este teste lia globals.css e
 * conferia valores OKLCH que o produto não usa mais — validava números dentro
 * do próprio arquivo de teste, não a cor que chega na tela. Agora lê a camada
 * que realmente vence a cascata.
 */
const TEMA = readFileSync(resolve(__dirname, '../../app/light-blue.css'), 'utf8');
const BASE = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function token(nome: string): string {
  const v = lerToken(TEMA, `--${nome}`);
  if (v === null) throw new Error(`token --${nome} nao encontrado em light-blue.css`);
  return v;
}

/** WCAG 2.1: 4.5:1 para texto normal, 3:1 para texto grande e componentes. */
const AA_TEXTO = 4.5;
const AA_COMPONENTE = 3;

const FUNDOS = ['surface', 'canvas', 'surface-sunken', 'surface-hover', 'surface-subtle'] as const;

describe('paleta clinica — contraste medido sobre o tema que realmente carrega', () => {
  it('os tokens do tema azul clinico existem', () => {
    for (const t of [
      'canvas', 'surface', 'surface-sunken', 'surface-hover', 'surface-subtle',
      'border', 'border-strong', 'border-field',
      'text-primary', 'text-secondary', 'text-tertiary',
      'brand', 'brand-hover', 'brand-strong',
      'nav', 'nav-active', 'nav-muted', 'nav-text',
    ]) {
      expect(token(t), `--${t}`).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    }
  });

  it('os tres niveis de texto passam em AA sobre TODA superficie clara', () => {
    const falhas: string[] = [];
    for (const fundo of FUNDOS) {
      for (const texto of ['text-primary', 'text-secondary', 'text-tertiary'] as const) {
        const r = contrasteHex(token(texto), token(fundo));
        if (r < AA_TEXTO) falhas.push(`--${texto} sobre --${fundo} = ${r}:1`);
      }
    }
    expect(falhas, falhas.join(' · ')).toEqual([]);
  });

  it('o texto da navegacao passa sobre o proprio fundo dela', () => {
    for (const fundo of ['nav', 'nav-active'] as const) {
      for (const texto of ['nav-text', 'nav-muted'] as const) {
        const r = contrasteHex(token(texto), token(fundo));
        expect(r, `--${texto} sobre --${fundo} = ${r}:1`).toBeGreaterThanOrEqual(AA_TEXTO);
      }
    }
  });

  it('o botao primario passa: branco sobre a marca e sobre o hover', () => {
    /* Este era o furo mais caro da paleta anterior. O azul de marca dava
       4.1:1 com branco, ou seja, o rotulo do botao principal do produto
       reprovava em AA — e nada no CI pegava. */
    for (const marca of ['brand', 'brand-hover', 'brand-strong'] as const) {
      const r = contrasteHex('#ffffff', token(marca));
      expect(r, `branco sobre --${marca} = ${r}:1`).toBeGreaterThanOrEqual(AA_TEXTO);
    }
  });

  it('a marca serve como anel de foco: 3:1 sobre superficie e canvas', () => {
    for (const fundo of ['surface', 'canvas'] as const) {
      const r = contrasteHex(token('brand'), token(fundo));
      expect(r, `--brand sobre --${fundo} = ${r}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });

  it('--border-field cumpre 1.4.11: contorno de campo em 3:1', () => {
    /* --border continua leve de proposito: separador decorativo em 3:1 deixa
       a interface com cara de wireframe. Quem carrega affordance e o campo. */
    for (const fundo of ['surface', 'canvas'] as const) {
      const r = contrasteHex(token('border-field'), token(fundo));
      expect(r, `--border-field sobre --${fundo} = ${r}:1`).toBeGreaterThanOrEqual(AA_COMPONENTE);
    }
  });

  it('o produto tem um unico tema claro e nao reintroduz dark mode', () => {
    expect(BASE).toContain('color-scheme: light');
    expect(BASE).not.toContain('@media (prefers-color-scheme: dark)');
    expect(BASE).not.toContain(':root[data-theme="dark"]');
    expect(TEMA).not.toContain('@media (prefers-color-scheme: dark)');
  });

  it('prefers-reduced-motion reduz animacoes e transicoes', () => {
    expect(BASE).toContain('@media (prefers-reduced-motion: reduce)');
    expect(BASE).toContain('transition-duration: 1ms !important');
  });
});
