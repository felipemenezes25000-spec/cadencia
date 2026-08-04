export type DomainErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'tenant_context_missing'
  | 'cross_tenant_reference'
  | 'immutable'
  | 'unavailable';

/**
 * Detalhe de erro NUNCA carrega conteudo clinico nem o valor de um documento:
 * o erro viaja para log, Sentry e trilha de auditoria, e a NGS1.07.06 proibe
 * conteudo la. So primitivo, e so o NOME do campo — nunca o que foi digitado.
 */
export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

export interface SerializedDomainError {
  readonly code: string;
  readonly kind: DomainErrorKind;
  readonly httpStatus: number;
  readonly message: string;
  readonly details: ErrorDetails;
}

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  abstract readonly httpStatus: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON(): SerializedDomainError {
    return {
      code: this.code,
      kind: this.kind,
      httpStatus: this.httpStatus,
      message: this.message,
      details: this.details,
    };
  }
}

/** 422 — entrada malformada. Culpa do dado que chegou. */
export class ValidationError extends DomainError {
  readonly kind = 'validation' as const;
  readonly httpStatus = 422;
}

/** 404 — nao existe, ou a RLS devolveu zero linha (leitura falha fechada em silencio). */
export class NotFoundError extends DomainError {
  readonly kind = 'not_found' as const;
  readonly httpStatus = 404;
}

/** 409 — inclui a revisao otimista do rascunho (clin.encounter_draft.rev). */
export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const;
  readonly httpStatus = 409;
}

/** 403 — negado pelo catalogo de acoes ou por policy. */
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden' as const;
  readonly httpStatus = 403;
}

/** 500 — preambulo de transacao esquecido. Escrita falha ALTO, de proposito. */
export class TenantContextMissingError extends DomainError {
  readonly kind = 'tenant_context_missing' as const;
  readonly httpStatus = 500;
}

/** 500 — 23503: tentou apontar para linha de outro tenant. */
export class CrossTenantReferenceError extends DomainError {
  readonly kind = 'cross_tenant_reference' as const;
  readonly httpStatus = 500;
}

/** 409 — tentativa de UPDATE ou DELETE em registro append-only. */
export class ImmutableRecordError extends DomainError {
  readonly kind = 'immutable' as const;
  readonly httpStatus = 409;
}

/** 503 — dependencia fora do ar. */
export class UnavailableError extends DomainError {
  readonly kind = 'unavailable' as const;
  readonly httpStatus = 503;
}

/**
 * SQLSTATE -> erro de dominio. Devolve null quando o codigo nao e conhecido:
 * traduzir SQLSTATE desconhecido para um erro generico esconde falha de infra.
 *
 * ONDE ESTA FUNCAO E USADA: na borda HTTP (L3), que captura o erro cru relancado
 * por withTenantTx. `packages/db` NAO a importa — db e kernel sao irmaos em L0 e
 * a §2.2 proibe import entre irmaos, sem excecao.
 */
export function domainErrorFromSqlState(sqlstate: string, details: ErrorDetails = {}): DomainError | null {
  switch (sqlstate) {
    case '42501':
      return new TenantContextMissingError('db.tenant_context_missing', 'contexto de tenant ausente na transacao', details);
    case '23503':
      return new CrossTenantReferenceError('db.cross_tenant_reference', 'referencia a linha de outro tenant', details);
    case '23505':
      return new ConflictError('db.unique_violation', 'registro ja existe', details);
    case '23514':
      return new ValidationError('db.check_violation', 'valor viola regra declarada no banco', details);
    case '23502':
      return new ValidationError('db.not_null_violation', 'campo obrigatorio ausente', details);
    case '40001':
      return new ConflictError('db.serialization_failure', 'conflito de serializacao: repetir a transacao', details);
    default:
      return null;
  }
}
