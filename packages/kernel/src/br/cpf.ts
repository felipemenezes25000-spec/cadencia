import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/** CPF normalizado: 11 dígitos, sem pontuação. */
export type Cpf = string & { readonly __brand: 'Cpf' };

const ALL_EQUAL = /^(\d)\1{10}$/;

/**
 * Dígitos verificadores do CPF (módulo 11).
 * 1o DV: dígitos 1..9 com pesos 10..2; resto = (soma * 10) % 11; 10 vira 0.
 * 2o DV: dígitos 1..9 + 1o DV com pesos 11..2; mesma regra.
 */
function checkDigits(digits: readonly number[]): [number, number] {
  let sum1 = 0;
  for (let i = 0; i < 9; i += 1) sum1 += (digits[i] ?? 0) * (10 - i);
  let first = (sum1 * 10) % 11;
  if (first === 10) first = 0;

  const withFirst = [...digits.slice(0, 9), first];
  let sum2 = 0;
  for (let i = 0; i < 10; i += 1) sum2 += (withFirst[i] ?? 0) * (11 - i);
  let second = (sum2 * 10) % 11;
  if (second === 10) second = 0;

  return [first, second];
}

export function parseCpf(input: string): Result<Cpf, ValidationError> {
  const digits = input.replace(/\D/g, '');

  if (digits.length !== 11) {
    return err(new ValidationError('cpf.tamanho_invalido', 'CPF precisa ter 11 digitos', { length: digits.length }));
  }
  if (ALL_EQUAL.test(digits)) {
    // 000.000.000-00 e 111.111.111-11 passam no módulo 11. Só esta regra os pega.
    return err(new ValidationError('cpf.digitos_repetidos', 'CPF com todos os digitos iguais nao existe'));
  }

  const numbers = [...digits].map(Number);
  const [first, second] = checkDigits(numbers);
  if (numbers[9] !== first || numbers[10] !== second) {
    return err(new ValidationError('cpf.digito_verificador_invalido', 'digito verificador do CPF nao confere'));
  }

  return ok(digits as Cpf);
}

export function isCpf(input: string): boolean {
  return parseCpf(input).ok;
}

export function formatCpf(cpf: Cpf): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
