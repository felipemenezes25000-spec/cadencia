// packages/payments/src/bank-account-seed.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

let admin: Pool;

beforeAll(() => {
  admin = new Pool({ connectionString: adminUrl(), max: 1 });
});

afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('fin.bank_account — provisionamento automatico de Caixa Geral', () => {
  it('trigger cria Caixa Geral ao inserir tenant novo', async () => {
    const tenantId = uuidv7();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Tenant Trigger', '33ABC44501DE67')`,
        [tenantId, `trig-${tenantId}`]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    const { rows } = await admin.query<{
      name: string; is_default: boolean;
    }>(
      `SELECT name, is_default FROM fin.bank_account
        WHERE tenant_id = $1 AND is_default = true`, [tenantId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Caixa Geral');
    expect(rows[0]?.is_default).toBe(true);
  });

  it('backfill provisionou Caixa Geral para todos os tenants existentes', async () => {
    const { rows } = await admin.query<{ sem_default: string }>(
      `SELECT count(*)::text AS sem_default
         FROM app.tenant t
        WHERE NOT EXISTS (
          SELECT 1 FROM fin.bank_account ba
           WHERE ba.tenant_id = t.id AND ba.is_default
        )`);
    expect(rows[0]?.sem_default).toBe('0');
  });
});
