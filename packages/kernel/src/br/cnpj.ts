import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/**
 * CNPJ ALFANUMERICO — IN RFB 2.229/2024, em vigor desde 01/07/2026.
 * 12 posicoes de base em [A-Z0-9] + 2 digitos verificadores NUMERICOS.
 *
 * O valor de cada caractere no calculo do DV e `codigo ASCII - 48`:
 *   '0' (48) -> 0, '9' (57) -> 9, 'A' (65) -> 17, ..., 'Z' (90) -> 42.
 *
 * E por isso que CNPJ e varchar(14) e nunca coluna numerica — invariante de CI
 * (§3.13 item 8) e decisao irreversivel n. 12.
 */
export type Cnpj = string & { readonly __brand: 'Cnpj' };

const CNPJ_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;
const ALL_EQUAL = /^(.)\1{13}$/;
const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/** Modulo 11: resto < 2 => DV 0; senao DV = 11 - resto. */
function checkDigits(base: string): string {
  let sum1 = 0;
  for (let i = 0; i < 12; i += 1) sum1 += charValue(base[i] ?? '0') * (WEIGHTS_FIRST[i] ?? 0);
  const rest1 = sum1 % 11;
  const first = rest1 < 2 ? 0 : 11 - rest1;

  const base13 = `${base}${first}`;
  let sum2 = 0;
  for (let i = 0; i < 13; i += 1) sum2 += charValue(base13[i] ?? '0') * (WEIGHTS_SECOND[i] ?? 0);
  const rest2 = sum2 % 11;
  const second = rest2 < 2 ? 0 : 11 - rest2;

  return `${first}${second}`;
}

export function parseCnpj(input: string): Result<Cnpj, ValidationError> {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!CNPJ_PATTERN.test(normalized)) {
    return err(new ValidationError(
      'cnpj.formato_invalido',
      'CNPJ precisa ter 12 posicoes alfanumericas seguidas de 2 digitos',
      { length: normalized.length },
    ));
  }
  if (ALL_EQUAL.test(normalized)) {
    // 00000000000000 passa no modulo 11: so esta regra o elimina.
    return err(new ValidationError('cnpj.caracteres_repetidos', 'CNPJ com todos os caracteres iguais nao existe'));
  }
  if (checkDigits(normalized.slice(0, 12)) !== normalized.slice(12)) {
    return err(new ValidationError('cnpj.digito_verificador_invalido', 'digito verificador do CNPJ nao confere'));
  }

  return ok(normalized as Cnpj);
}

export function isCnpj(input: string): boolean {
  return parseCnpj(input).ok;
}

export function formatCnpj(cnpj: Cnpj): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
