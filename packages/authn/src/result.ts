/**
 * Result<T, E> local do pacote `authn`.
 *
 * A forma é IDÊNTICA a de `packages/kernel/src/result.ts` de propósito, e a
 * duplicação também: `authn` e `kernel` são irmãos em L0 e import entre irmãos é
 * proibido sem exceção (§2.2 regra 2). Como as duas formas são estruturalmente
 * iguais, L3 recebe o resultado de `authn` e o trata com as funções do kernel
 * sem conversão nenhuma. Se alguem mudar o formato aqui, essa ponte quebra.
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
