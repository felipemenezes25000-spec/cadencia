// apps/worker/src/jobs/daily-rollup.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobsPool, closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { materializeDailyRollup } from './daily-rollup';

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let tenantId: string;
let clinicId: string;

beforeAll(async () => {
  tenantId = uuidv7();
  clinicId = uuidv7();
  const userId = uuidv7();
  const patientId = uuidv7();
  const paymentMethodId = uuidv7();
  const professionalId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Rollup Test', '99999999000199')`,
      [tenantId, `rl-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rl', '2077510', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'User Rl')`,
      [userId, `${userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'profissional')`,
      [tenantId, userId, clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
      [tenantId, professionalId, userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente Rl', 'completo', '1990-01-01')`,
      [tenantId, patientId]);
    // Criar metodo de pagamento para FK (colunas reais: kind, name)
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'PIX')`,
      [tenantId, paymentMethodId]);

    // Inserir lancamento de ontem usando fin.entry (nao fin.payment)
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, patient_id, professional_id, clinic_id,
          description, amount_cents, payment_method_id,
          status, idempotency_key, created_by, paid_at, created_at)
       VALUES ($1, $2, 'receita', $3, $4, $5,
               'Consulta teste rollup', 15000, $6,
               'pago', $7, $8,
               clock_timestamp() - interval '1 day',
               clock_timestamp() - interval '1 day')`,
      [tenantId, uuidv7(), patientId, professionalId, clinicId,
       paymentMethodId, `rollup-${uuidv7()}`, userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await admin.end();
});

afterAll(async () => { await closePools(); });

describe('materializacao do daily_rollup', () => {
  it('agrega lancamentos do dia anterior no rollup', async () => {
    const r = await materializeDailyRollup();
    expect(r.rowsUpserted).toBeGreaterThanOrEqual(1);

    // Verificar que o rollup foi gravado
    const { rows } = await jobsPool().query<{ entries: string; amount_cents: string }>(
      `SELECT entries::text, amount_cents::text FROM fin.daily_rollup
        WHERE tenant_id = $1 AND clinic_id = $2`,
      [tenantId, clinicId]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
