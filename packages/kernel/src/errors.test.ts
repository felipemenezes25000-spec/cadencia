import { describe, expect, it } from 'vitest';
import {
  ConflictError, CrossTenantReferenceError, DomainError, ForbiddenError, ImmutableRecordError,
  NotFoundError, TenantContextMissingError, UnavailableError, ValidationError, domainErrorFromSqlState,
} from './errors';

describe('erros de dominio', () => {
  it('ValidationError e um Error de verdade, mantem o nome da classe e responde 422', () => {
    const error = new ValidationError('patient.cpf.invalido', 'CPF invalido', { field: 'cpf' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('ValidationError');
    expect(error.kind).toBe('validation');
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe('patient.cpf.invalido');
    expect(error.details['field']).toBe('cpf');
  });

  it('details e congelado: o erro viaja para log, Sentry e trilha e nao pode ser editado no caminho', () => {
    const error = new ValidationError('x', 'y', { field: 'cpf' });
    expect(() => { (error.details as Record<string, unknown>)['field'] = 'outro'; }).toThrow(TypeError);
    expect(error.details['field']).toBe('cpf');
  });

  it('cada classe tem um status HTTP proprio', () => {
    expect(new NotFoundError('a', 'b').httpStatus).toBe(404);
    expect(new ConflictError('a', 'b').httpStatus).toBe(409);
    expect(new ForbiddenError('a', 'b').httpStatus).toBe(403);
    expect(new ImmutableRecordError('a', 'b').httpStatus).toBe(409);
    expect(new UnavailableError('a', 'b').httpStatus).toBe(503);
  });

  it('42501 vira TenantContextMissingError com status 500: preambulo de transacao esquecido e bug nosso, nao erro do usuario', () => {
    const error = domainErrorFromSqlState('42501', { table: 'clin.patient' });
    expect(error).toBeInstanceOf(TenantContextMissingError);
    expect(error?.httpStatus).toBe(500);
    expect(error?.details['table']).toBe('clin.patient');
  });

  it('23503 vira CrossTenantReferenceError: a FK composta transforma referencia a outro tenant em erro de escrita, nao em vazamento silencioso', () => {
    const error = domainErrorFromSqlState('23503', { constraint: 'clin_encounter_tenant_patient_fkey' });
    expect(error).toBeInstanceOf(CrossTenantReferenceError);
    expect(error?.kind).toBe('cross_tenant_reference');
  });

  it('23505 vira ConflictError e 23514 vira ValidationError', () => {
    expect(domainErrorFromSqlState('23505')).toBeInstanceOf(ConflictError);
    expect(domainErrorFromSqlState('23514')).toBeInstanceOf(ValidationError);
    expect(domainErrorFromSqlState('23502')).toBeInstanceOf(ValidationError);
    expect(domainErrorFromSqlState('40001')).toBeInstanceOf(ConflictError);
  });

  it('SQLSTATE desconhecido devolve null para o chamador relancar o erro original em vez de mascarar falha de infraestrutura', () => {
    expect(domainErrorFromSqlState('08006')).toBeNull();
  });

  it('toJSON expoe o contrato do erro e nao expoe a stack', () => {
    const error = new ForbiddenError('authz.acao_negada', 'acao nao permitida', { action: 'encounter.read' });
    expect(error.toJSON()).toEqual({
      code: 'authz.acao_negada',
      kind: 'forbidden',
      httpStatus: 403,
      message: 'acao nao permitida',
      details: { action: 'encounter.read' },
    });
    expect(JSON.stringify(error.toJSON())).not.toContain('stack');
  });
});
