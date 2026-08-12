import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/**
 * CNS — Cartão Nacional de Saúde, 15 dígitos.
 * Definitivo começa com 1 ou 2 (derivado do PIS/PASEP); provisório com 7, 8 ou 9.
 * Em ambos os casos a soma dos dígitos ponderada por (15 - posição) é
 * divisível por 11 — o DV foi construído para isso.
 */
export type Cns = string & { readonly __brand: 'Cns' };

const VALID_PREFIXES = ['1', '2', '7', '8', '9'];

export function parseCns(input: string): Result<Cns, ValidationError> {
  const digits = input.replace(/\D/g, '');

  if (digits.length !== 15) {
    return err(new ValidationError('cns.tamanho_invalido', 'CNS precisa ter 15 digitos', { length: digits.length }));
  }
  if (!VALID_PREFIXES.includes(digits[0] ?? '')) {
    return err(new ValidationError(
      'cns.faixa_invalida',
      'CNS comeca com 1 ou 2 (definitivo) ou com 7, 8 e 9 (provisorio)',
    ));
  }

  let sum = 0;
  for (let i = 0; i < 15; i += 1) sum += Number(digits[i] ?? '0') * (15 - i);
  if (sum % 11 !== 0) {
    return err(new ValidationError('cns.digito_verificador_invalido', 'digito verificador do CNS nao confere'));
  }

  return ok(digits as Cns);
}

export function isCns(input: string): boolean {
  return parseCns(input).ok;
}

export function formatCns(cns: Cns): string {
  return `${cns.slice(0, 3)} ${cns.slice(3, 7)} ${cns.slice(7, 11)} ${cns.slice(11)}`;
}
