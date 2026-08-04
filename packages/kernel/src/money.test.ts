import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { ZERO_BRL, add, allocate, brl, compare, formatBRL, parseBRL, subtract, sum } from './money';
import { isErr, isOk } from './result';

describe('Money', () => {
  it('soma em centavos e exata onde o float erra: 0,10 + 0,20 = 0,30', () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(add(brl(10), brl(20))).toEqual(brl(30));
    expect(subtract(brl(30), brl(20))).toEqual(brl(10));
  });

  it('recusa centavo fracionado: nao existe meio centavo em recibo', () => {
    expect(() => brl(10.5)).toThrow(ValidationError);
    expect(() => brl(Number.NaN)).toThrow(ValidationError);
  });

  it('rateia R$ 100,00 em 3 partes iguais sem perder nem inventar centavo', () => {
    const partes = allocate(brl(10000), [1, 1, 1]);
    expect(partes.map((p) => p.cents)).toEqual([3334, 3333, 3333]);
    expect(sum(partes)).toEqual(brl(10000));
  });

  it('repasse de 70/30 sobre R$ 333,33 fecha exatamente com o valor recebido', () => {
    const [profissional, clinica] = allocate(brl(33333), [70, 30]);
    expect(profissional?.cents).toBe(23333);
    expect(clinica?.cents).toBe(10000);
    expect((profissional?.cents ?? 0) + (clinica?.cents ?? 0)).toBe(33333);
  });

  it('rateia estorno (valor negativo) preservando o sinal e o total', () => {
    const partes = allocate(brl(-10000), [1, 1, 1]);
    expect(partes.map((p) => p.cents)).toEqual([-3334, -3333, -3333]);
    expect(sum(partes)).toEqual(brl(-10000));
  });

  it('rateia 1 centavo entre 3: alguem recebe e ninguem recebe centavo fantasma', () => {
    expect(allocate(brl(1), [1, 1, 1]).map((p) => p.cents)).toEqual([1, 0, 0]);
  });

  it('recusa rateio sem partes ou com soma zero', () => {
    expect(() => allocate(brl(100), [])).toThrow(ValidationError);
    expect(() => allocate(brl(100), [0, 0])).toThrow(ValidationError);
    expect(() => allocate(brl(100), [-1, 2])).toThrow(ValidationError);
  });

  it('formata no padrao brasileiro, com ponto de milhar e virgula decimal', () => {
    expect(formatBRL(brl(123456))).toBe('R$ 1.234,56');
    expect(formatBRL(brl(100000000))).toBe('R$ 1.000.000,00');
    expect(formatBRL(brl(-5))).toBe('-R$ 0,05');
    expect(formatBRL(ZERO_BRL)).toBe('R$ 0,00');
  });

  it('le "R$ 1.234,56" entendendo o ponto como separador de milhar, nunca como decimal', () => {
    const comCentavos = parseBRL('R$ 1.234,56');
    expect(isOk(comCentavos) && comCentavos.value.cents).toBe(123456);
    const semCentavos = parseBRL('1.234');
    expect(isOk(semCentavos) && semCentavos.value.cents).toBe(123400);
  });

  it('recusa "1234.56": ponto decimal e formato de outro pais e viraria R$ 12,34 em silencio', () => {
    const resultado = parseBRL('1234.56');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('money.formato_invalido');
  });

  it('compara valores', () => {
    expect(compare(brl(100), brl(200))).toBe(-1);
    expect(compare(brl(200), brl(100))).toBe(1);
    expect(compare(brl(100), brl(100))).toBe(0);
  });
});
