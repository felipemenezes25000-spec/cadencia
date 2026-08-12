import { ValidationError } from './errors';
import { err, ok, type Result } from './result';

/** Dinheiro em CENTAVOS inteiros. Float nunca: 0.1 + 0.2 !== 0.3. */
export interface Money {
  readonly cents: number;
  readonly currency: 'BRL';
}

export const ZERO_BRL: Money = Object.freeze({ cents: 0, currency: 'BRL' as const });

export function brl(cents: number): Money {
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(
      'money.centavos_nao_inteiros',
      'valor monetario precisa ser um inteiro de centavos',
      { received: String(cents) },
    );
  }
  return Object.freeze({ cents, currency: 'BRL' as const });
}

export function add(a: Money, b: Money): Money {
  return brl(a.cents + b.cents);
}

export function subtract(a: Money, b: Money): Money {
  return brl(a.cents - b.cents);
}

export function negate(a: Money): Money {
  return brl(-a.cents);
}

export function isZero(a: Money): boolean {
  return a.cents === 0;
}

export function compare(a: Money, b: Money): number {
  if (a.cents === b.cents) return 0;
  return a.cents < b.cents ? -1 : 1;
}

export function sum(values: readonly Money[]): Money {
  return brl(values.reduce((total, money) => total + money.cents, 0));
}

/**
 * Rateio que NÃO cria nem perde centavo: a soma das partes é sempre o valor
 * original. Repasse médico, parcelamento e split de recebimento passam por aqui.
 * A sobra vai para o maior resto; empate resolve pelo índice.
 * Não existe multiply() de propósito: 70% é allocate(m, [70, 30])[0].
 */
export function allocate(money: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) {
    throw new ValidationError('money.rateio.sem_partes', 'rateio precisa de ao menos uma parte');
  }
  if (ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0)) {
    throw new ValidationError('money.rateio.parte_invalida', 'parte de rateio precisa ser finita e não negativa');
  }
  const totalRatio = ratios.reduce((total, ratio) => total + ratio, 0);
  if (totalRatio <= 0) {
    throw new ValidationError('money.rateio.soma_zero', 'a soma das partes precisa ser maior que zero');
  }

  const sign = money.cents < 0 ? -1 : 1;
  const absolute = Math.abs(money.cents);
  const shares = ratios.map((ratio, index) => {
    const exact = (absolute * ratio) / totalRatio;
    const floorValue = Math.floor(exact);
    return { index, cents: floorValue, remainder: exact - floorValue };
  });

  let rest = absolute - shares.reduce((total, share) => total + share.cents, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const share of byRemainder) {
    if (rest <= 0) break;
    share.cents += 1;
    rest -= 1;
  }

  return shares.map((share) => brl(sign * share.cents));
}

export function formatBRL(money: Money): string {
  const negative = money.cents < 0;
  const absolute = Math.abs(money.cents);
  const reais = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${String(cents).padStart(2, '0')}`;
}

const BRL_PATTERN = /^(-?)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?$/;

export function parseBRL(input: string): Result<Money, ValidationError> {
  const match = BRL_PATTERN.exec(input.trim());
  if (match === null) {
    return err(new ValidationError(
      'money.formato_invalido',
      'valor monetario fora do formato brasileiro',
      { length: input.length },
    ));
  }
  const sign = match[1] === '-' ? -1 : 1;
  const reais = Number((match[2] ?? '0').replace(/\./g, ''));
  const cents = Number(match[3] ?? '0');
  return ok(brl(sign * (reais * 100 + cents)));
}
