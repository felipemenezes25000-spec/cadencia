import { describe, expect, it } from 'vitest';
import { formatCns, isCns, parseCns, type Cns } from './cns';
import { isErr, isOk } from '../result';

describe('CNS — Cartao Nacional de Saude', () => {
  it('aceita CNS definitivo, que comeca com 1 ou 2', () => {
    expect(isCns('123456789010000')).toBe(true);
    expect(isCns('201234567890018')).toBe(true);
  });

  it('aceita CNS provisorio, que comeca com 7, 8 ou 9', () => {
    expect(isCns('898000000000002')).toBe(true);
  });

  it('aceita com espacos, como vem impresso no cartao', () => {
    const resultado = parseCns('123 4567 8901 0000');
    expect(isOk(resultado) && resultado.value).toBe('123456789010000');
  });

  it('recusa CNS que nao comeca com 1, 2, 7, 8 ou 9', () => {
    const resultado = parseCns('323456789010000');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.faixa_invalida');
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCns('123456789010001');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.digito_verificador_invalido');
  });

  it('recusa tamanho diferente de 15 digitos', () => {
    const resultado = parseCns('12345');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.tamanho_invalido');
  });

  it('o erro nao carrega o numero digitado', () => {
    const resultado = parseCns('123456789010001');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('12345');
  });

  it('formata para exibicao', () => {
    expect(formatCns('123456789010000' as Cns)).toBe('123 4567 8901 0000');
  });
});
