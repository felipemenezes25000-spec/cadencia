import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { andThen, collect, err, isErr, isOk, map, mapErr, ok, unwrapOr, unwrapOrThrow } from './result';

describe('Result', () => {
  it('carrega o valor no sucesso e o erro na falha, sem lancar excecao', () => {
    const sucesso = ok(42);
    const falha = err('sem contexto de tenant');
    expect(isOk(sucesso)).toBe(true);
    expect(sucesso.value).toBe(42);
    expect(isErr(falha)).toBe(true);
    expect(falha.error).toBe('sem contexto de tenant');
  });

  it('map transforma so o sucesso; a falha atravessa intacta', () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    expect(map(err('x'), (n: number) => n * 10)).toEqual(err('x'));
  });

  it('mapErr traduz so o erro', () => {
    expect(mapErr(err('cru'), (e) => `traduzido: ${e}`)).toEqual(err('traduzido: cru'));
    expect(mapErr(ok(1), (e: string) => e)).toEqual(ok(1));
  });

  it('andThen encadeia validacoes e para na primeira falha', () => {
    const dobrarSePositivo = (n: number) => (n > 0 ? ok(n * 2) : err('negativo'));
    expect(andThen(ok(3), dobrarSePositivo)).toEqual(ok(6));
    expect(andThen(ok(-1), dobrarSePositivo)).toEqual(err('negativo'));
    expect(andThen(err<string>('antes'), dobrarSePositivo)).toEqual(err('antes'));
  });

  it('collect junta TODOS os erros: o cadastro de paciente mostra os campos errados de uma vez, nao um por vez', () => {
    const resultado = collect([ok('nome'), err('cpf invalido'), err('data de nascimento no futuro')]);
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error).toEqual(['cpf invalido', 'data de nascimento no futuro']);
    expect(collect([ok(1), ok(2)])).toEqual(ok([1, 2]));
  });

  it('unwrapOr devolve o alternativo na falha', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err('x'), 99)).toBe(99);
  });

  it('unwrapOrThrow relanca a MESMA instancia quando o erro ja e uma excecao: um ValidationError precisa chegar no handler com o httpStatus 422 intacto', () => {
    const original = new ValidationError('patient.cpf.invalido', 'CPF invalido', { field: 'cpf' });
    let capturado: unknown = null;
    try {
      unwrapOrThrow(err(original));
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBe(original);                                  // identidade, não a mensagem
    expect((capturado as ValidationError).httpStatus).toBe(422);
    expect(unwrapOrThrow(ok('ok'))).toBe('ok');
  });

  it('unwrapOrThrow embrulha em Error o erro que NAO e excecao, preservando o texto', () => {
    let capturado: unknown = null;
    try {
      unwrapOrThrow(err('cpf invalido'));
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(Error);
    expect((capturado as Error).message).toBe('cpf invalido');
  });
});
