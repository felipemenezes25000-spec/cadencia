import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oklchParaSrgb, luminanciaRelativa, razaoDeContraste, lerToken } from './contrast';

const CSS = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

describe('contraste dos tokens — MEDIDO, nunca inferido', () => {
  it('o ambar corrigido esta no arquivo: L=52%, nao 72%', () => {
    expect(lerToken(CSS, '--ambar-500')).toBe('oklch(52% 0.140 75)');
  });

  it('--warn sobre --surface passa em AA no tema claro', () => {
    const warn = oklchParaSrgb(0.52, 0.140, 75);
    const surface = oklchParaSrgb(0.992, 0.003, 95);
    const razao = razaoDeContraste(luminanciaRelativa(warn), luminanciaRelativa(surface));
    expect(razao).toBeGreaterThanOrEqual(4.5);
  });

  it('o valor ANTIGO reprovaria — o teste prova que a protecao pega', () => {
    const antigo = oklchParaSrgb(0.72, 0.150, 75);
    const surface = oklchParaSrgb(0.992, 0.003, 95);
    const razao = razaoDeContraste(luminanciaRelativa(antigo), luminanciaRelativa(surface));
    expect(razao).toBeLessThan(3);
  });

  it('texto, acento, ok, danger e ai passam em AA sobre a superficie clara', () => {
    const surface = luminanciaRelativa(oklchParaSrgb(0.992, 0.003, 95));
    const casos: [string, number, number, number][] = [
      ['--text', 0.23, 0.012, 265],
      ['--accent', 0.45, 0.140, 258],
      ['--ok', 0.53, 0.130, 155],
      ['--danger', 0.53, 0.190, 25],
      ['--ai', 0.52, 0.150, 300],
    ];
    for (const [nome, l, c, h] of casos) {
      const razao = razaoDeContraste(luminanciaRelativa(oklchParaSrgb(l, c, h)), surface);
      expect(razao, `${nome} = ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('o CSS declara os dois temas e o seletor manual data-theme', () => {
    expect(CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(CSS).toContain(':root[data-theme="dark"]');
    expect(CSS).toContain(':root[data-theme="light"]');
  });

  it('prefers-reduced-motion zera as duracoes', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(CSS).toContain('--dur-1: 1ms');
  });
});
