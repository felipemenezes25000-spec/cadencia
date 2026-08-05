// apps/worker/src/jobs/payment-reconciliation.int.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { createFakePaymentProvider } from '@cadencia/integrations';
import { reconcilePayments } from './payment-reconciliation';

afterAll(async () => { await closePools(); });

describe('reconciliacao de pagamentos', () => {
  it('roda sem erro mesmo sem pagamentos PSP', async () => {
    const payment = createFakePaymentProvider();
    const r = await reconcilePayments(payment);
    expect(r.tenantsProcessed).toBeGreaterThanOrEqual(0);
    expect(typeof r.settlementsFound).toBe('number');
    expect(typeof r.divergences).toBe('number');
  });
});
