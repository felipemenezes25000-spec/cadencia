/**
 * Result<T, E> local do pacote `authn`.
 *
 * A forma e IDENTICA a de `packages/kernel/src/result.ts` de proposito, e a
 * duplicacao tambem: `authn` e `kernel` sao irmaos em L0 e import entre irmaos e
 * proibido sem excecao (§2.2 regra 2). Como as duas formas sao estruturalmente
 * iguais, L3 recebe o resultado de `authn` e o trata com as funcoes do kernel
 * sem conversao nenhuma. Se alguem mudar o formato aqui, essa ponte quebra.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
