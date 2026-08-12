import { describe, expect, it } from 'vitest';
import { formatCnpj, isCnpj, parseCnpj, type Cnpj } from './cnpj';
import { isErr, isOk } from '../result';

describe('CNPJ alfanumerico (IN RFB 2.229/2024)', () => {
  it('aceita o CNPJ alfanumerico do exemplo da Receita: 12.ABC.345/01DE-35', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-35');
    expect(isOk(resultado) && resultado.value).toBe('12ABC34501DE35');
  });

  it('continua aceitando CNPJ inteiramente numerico, que nao deixou de existir', () => {
    expect(isCnpj('11.222.333/0001-81')).toBe(true);
    expect(isCnpj('00.000.000/0001-91')).toBe(true);
  });

  it('normaliza para maiuscula: a recepcao digita minusculo', () => {
    const resultado = parseCnpj('12.abc.345/01de-35');
    expect(isOk(resultado) && resultado.value).toBe('12ABC34501DE35');
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-34');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.digito_verificador_invalido');
  });

  it('recusa 00000000000000, que passa no calculo do digito verificador', () => {
    const resultado = parseCnpj('00000000000000');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.caracteres_repetidos');
  });

  it('recusa formato fora de 12 alfanumericos + 2 digitos', () => {
    expect(isErr(parseCnpj('12ABC34501DE3'))).toBe(true);         // curto
    expect(isErr(parseCnpj('12ABC34501DEAB'))).toBe(true);        // DV não numérico
    expect(isErr(parseCnpj('12.ÇBC.345/01DE-35'))).toBe(true);    // caractere fora de [A-Z0-9]
    const resultado = parseCnpj('12ABC34501DE3');
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.formato_invalido');
  });

  it('o erro nao carrega o CNPJ digitado', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-34');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('ABC');
  });

  it('formata para exibicao', () => {
    expect(formatCnpj('12ABC34501DE35' as Cnpj)).toBe('12.ABC.345/01DE-35');
    expect(formatCnpj('11222333000181' as Cnpj)).toBe('11.222.333/0001-81');
  });
});
