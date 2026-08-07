import { describe, it, expect } from 'vitest';
import { factorsAddUp, type VariationFactors } from './variation-types';

describe('factorsAddUp', () => {
  it('retorna true quando soma dos fatores iguala delta', () => {
    const f: VariationFactors = {
      volume_cents: -500_00,
      mix_procedimento_cents: 100_00,
      mix_convenio_cents: -200_00,
      ticket_cents: 50_00,
      faltas_cents: -300_00,
      glosas_cents: 0,
      total_a_cents: 10_000_00,
      total_b_cents: 9_150_00,
      delta_total_cents: -850_00,
    };
    expect(factorsAddUp(f)).toBe(true);
  });

  it('retorna false quando soma dos fatores nao iguala delta', () => {
    const f: VariationFactors = {
      volume_cents: -500_00,
      mix_procedimento_cents: 100_00,
      mix_convenio_cents: -200_00,
      ticket_cents: 50_00,
      faltas_cents: -300_00,
      glosas_cents: 0,
      total_a_cents: 10_000_00,
      total_b_cents: 9_150_00,
      delta_total_cents: -900_00, // errado de proposito
    };
    expect(factorsAddUp(f)).toBe(false);
  });

  it('funciona com todos os fatores zero', () => {
    const f: VariationFactors = {
      volume_cents: 0,
      mix_procedimento_cents: 0,
      mix_convenio_cents: 0,
      ticket_cents: 0,
      faltas_cents: 0,
      glosas_cents: 0,
      total_a_cents: 5_000_00,
      total_b_cents: 5_000_00,
      delta_total_cents: 0,
    };
    expect(factorsAddUp(f)).toBe(true);
  });

  it('funciona com fatores positivos (receita cresceu)', () => {
    const f: VariationFactors = {
      volume_cents: 300_00,
      mix_procedimento_cents: 200_00,
      mix_convenio_cents: 150_00,
      ticket_cents: 100_00,
      faltas_cents: -50_00,
      glosas_cents: 0,
      total_a_cents: 8_000_00,
      total_b_cents: 8_700_00,
      delta_total_cents: 700_00,
    };
    expect(factorsAddUp(f)).toBe(true);
  });
});
