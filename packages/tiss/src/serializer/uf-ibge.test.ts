import { describe, expect, it } from 'vitest';
import { ufParaCodigoIbge } from './uf-ibge';

describe('UF para codigo IBGE', () => {
  it('traduz a sigla que o cadastro guarda para o codigo que o TISS exige', () => {
    // `dm_UF` no XSD não aceita 'SP': o domínio é o conjunto de códigos do
    // IBGE. Mandar a sigla derruba a guia inteira no validador da operadora.
    expect(ufParaCodigoIbge('SP')).toBe('35');
    expect(ufParaCodigoIbge('RJ')).toBe('33');
    expect(ufParaCodigoIbge('AC')).toBe('12');
    expect(ufParaCodigoIbge('DF')).toBe('53');
  });

  it('aceita minuscula e espaco — o cadastro nem sempre normaliza', () => {
    expect(ufParaCodigoIbge(' sp ')).toBe('35');
  });

  it('devolve 98 para exterior, que e o que o dominio prevê', () => {
    expect(ufParaCodigoIbge('EX')).toBe('98');
  });

  it('recusa sigla desconhecida em vez de inventar codigo', () => {
    // Devolver '' ou '98' calado poria a guia no ar com UF errada, e a glosa
    // voltaria semanas depois sem ninguém saber de onde veio.
    expect(() => ufParaCodigoIbge('XX')).toThrow(/uf_desconhecida/);
  });

  it('cobre as 27 unidades da federacao', () => {
    const siglas = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO',
      'RR', 'SC', 'SP', 'SE', 'TO'];
    expect(siglas).toHaveLength(27);
    const codigos = siglas.map(ufParaCodigoIbge);
    expect(new Set(codigos).size).toBe(27);
  });
});
