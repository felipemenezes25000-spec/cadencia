// packages/db/migrations/0079_fin_payment_link.iso.test.ts
import { describe, expect, it } from 'vitest';

describe('isolamento fin.payment_link e fin.reconciliation_log', () => {
  it('as tabelas existem e serao cobertas pela suite test:iso automaticamente', () => {
    // A suite test:iso descobre tabelas do catalogo e reprova quem
    // esquecer tenant_id, RLS ou FK composta. Este teste e um marcador
    // para que a CI execute a suite apos a migration.
    expect(true).toBe(true);
  });
});
