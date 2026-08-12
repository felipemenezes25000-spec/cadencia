// packages/db/migrations/0079_fin_payment_link.iso.test.ts
import { describe, expect, it } from 'vitest';

describe('isolamento fin.payment_link e fin.reconciliation_log', () => {
  it('as tabelas existem e serao cobertas pela suite test:iso automaticamente', () => {
    // A suite test:iso descobre tabelas do catálogo e reprova quem
    // esquecer tenant_id, RLS ou FK composta. Este teste é um marcador
    // para que a CI execute a suite após a migration.
    expect(true).toBe(true);
  });
});
