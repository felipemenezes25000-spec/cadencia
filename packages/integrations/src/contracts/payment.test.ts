import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES, isPaymentStatus } from './payment';

describe('status de pagamento', () => {
  it('enumera os sete estados do ciclo de vida de um pagamento', () => {
    expect(PAYMENT_STATUSES).toEqual([
      'pending', 'approved', 'declined', 'refunded',
      'partially_refunded', 'cancelled', 'indeterminate',
    ]);
  });

  it('aceita status valido e recusa invalido em runtime', () => {
    expect(isPaymentStatus('approved')).toBe(true);
    expect(isPaymentStatus('refunded')).toBe(true);
    expect(isPaymentStatus('aprovado')).toBe(false);
  });
});
