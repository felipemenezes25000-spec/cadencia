import { describe, expect, it } from 'vitest';
import { formatCpf, isCpf, parseCpf, type Cpf } from './cpf';
import { isErr, isOk } from '../result';

describe('CPF', () => {
  it('aceita CPF valido com ou sem pontuacao e devolve so os digitos', () => {
    const comPontuacao = parseCpf('529.982.247-25');
    expect(isOk(comPontuacao) && comPontuacao.value).toBe('52998224725');
    const semPontuacao = parseCpf('11144477735');
    expect(isOk(semPontuacao) && semPontuacao.value).toBe('11144477735');
    expect(isCpf('123.456.789-09')).toBe(true);
  });

  it('recusa 000.000.000-00, que a recepcao digita quando o paciente nao tem o documento em maos', () => {
    // Atenção: 000.000.000-00 PASSA no cálculo do dígito verificador.
    // Só a regra de dígitos repetidos o elimina — e sem ela esse CPF entra na
    // base, some da busca por duplicidade e contamina guia e relatório.
    const resultado = parseCpf('000.000.000-00');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.digitos_repetidos');
    expect(isCpf('111.111.111-11')).toBe(false);
    expect(isCpf('99999999999')).toBe(false);
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCpf('529.982.247-26');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.digito_verificador_invalido');
  });

  it('recusa tamanho diferente de 11 digitos', () => {
    const resultado = parseCpf('529.982.247');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.tamanho_invalido');
  });

  it('o erro nao carrega o CPF digitado: ele viaja para log, Sentry e trilha', () => {
    const resultado = parseCpf('529.982.247-26');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('529');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('982');
  });

  it('formata para exibicao', () => {
    expect(formatCpf('52998224725' as Cpf)).toBe('529.982.247-25');
  });
});
