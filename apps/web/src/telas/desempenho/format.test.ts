// apps/web/src/telas/desempenho/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  formatDelta,
  formatDeltaPct,
  buildVariationPhrase,
  formatPeriodLabel,
} from './format';

describe('formatDelta', () => {
  it('valor positivo recebe sinal de mais', () => {
    expect(formatDelta(1420000)).toBe('+R$ 14.200,00');
  });

  it('valor negativo recebe sinal de menos', () => {
    expect(formatDelta(-1420000)).toBe('-R$ 14.200,00');
  });

  it('valor zero sem sinal', () => {
    expect(formatDelta(0)).toBe('R$ 0,00');
  });
});

describe('formatDeltaPct', () => {
  it('percentual positivo com sinal', () => {
    expect(formatDeltaPct(4)).toBe('+4%');
  });

  it('percentual negativo com sinal', () => {
    expect(formatDeltaPct(-18)).toBe('-18%');
  });

  it('zero sem sinal', () => {
    expect(formatDeltaPct(0)).toBe('0%');
  });

  it('decimal arredondado para uma casa', () => {
    expect(formatDeltaPct(4.56)).toBe('+4,6%');
  });
});

describe('buildVariationPhrase', () => {
  it('receita que caiu gera frase com "caiu"', () => {
    const frase = buildVariationPhrase('receita', -1420000, -18);
    expect(frase).toBe('Receita caiu R$ 14.200 (-18%)');
  });

  it('ticket medio que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('ticket_medio', 1200, 4);
    expect(frase).toBe('Ticket medio subiu R$ 12 (+4%)');
  });

  it('ocupacao que caiu gera frase com "caiu N pontos"', () => {
    const frase = buildVariationPhrase('ocupacao', -9, -9);
    expect(frase).toBe('Ocupacao caiu 9 pontos');
  });

  it('receita que subiu gera frase com "subiu"', () => {
    const frase = buildVariationPhrase('receita', 500000, 12);
    expect(frase).toBe('Receita subiu R$ 5.000 (+12%)');
  });

  it('variacao zero gera frase com "estavel"', () => {
    const frase = buildVariationPhrase('receita', 0, 0);
    expect(frase).toBe('Receita estavel');
  });
});

describe('formatPeriodLabel', () => {
  it('formata dois meses como "Julho 2026 vs Junho 2026"', () => {
    expect(formatPeriodLabel('2026-07', '2026-06')).toBe('Julho 2026 vs Junho 2026');
  });

  it('formata meses de anos diferentes', () => {
    expect(formatPeriodLabel('2027-01', '2026-12')).toBe('Janeiro 2027 vs Dezembro 2026');
  });
});
