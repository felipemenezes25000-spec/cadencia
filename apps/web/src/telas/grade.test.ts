import { describe, expect, it } from 'vitest';
import { posicaoNaGrade, faixasDoDia, VISOES } from './grade';

describe('grade da agenda', () => {
  it('as cinco visoes sao Dia, Semana, Mes, Por profissional e Por sala', () => {
    expect(VISOES.map((v) => v.rotulo))
      .toEqual(['Dia', 'Semana', 'Mês', 'Por profissional', 'Por sala']);
  });

  it('cada visao tem atalho numerico de 1 a 5', () => {
    expect(VISOES.map((v) => v.atalho)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('converte instante em linha de grid de 15 minutos', () => {
    const p = posicaoNaGrade('2026-08-03T13:00:00.000Z', '2026-08-03T13:30:00.000Z',
      { inicioMin: 7 * 60, passoMin: 15, timezone: 'UTC' });
    expect(p).toEqual({ linhaInicio: 25, linhaFim: 27 });
  });

  it('slot de duracao menor que o passo ocupa ao menos uma linha', () => {
    const p = posicaoNaGrade('2026-08-03T13:00:00.000Z', '2026-08-03T13:05:00.000Z',
      { inicioMin: 7 * 60, passoMin: 15, timezone: 'UTC' });
    expect(p.linhaFim - p.linhaInicio).toBe(1);
  });

  it('gera as faixas de hora do dia no fuso da clinica', () => {
    const f = faixasDoDia({ inicioMin: 8 * 60, fimMin: 10 * 60, passoMin: 30 });
    expect(f).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });
});
