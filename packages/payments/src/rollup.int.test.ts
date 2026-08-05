import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { recordPayment } from './record-payment';
import { materializeRollup, detectDivergence } from './rollup';
import { semearPagamento, type SementePagamento } from './test-support';

let s: SementePagamento;
let actor: Actor;
let adminPool: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

beforeAll(async () => {
  s = await semearPagamento();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
  adminPool = new Pool({ connectionString: adminUrl(), max: 1 });

  // Registra dois pagamentos para o dia 2026-10-15 (data do appointment semeado)
  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      patientId: s.patientId,
      appointmentId: s.appointmentId,
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 1',
      amountCents: 25000,
      paymentMethodId: s.paymentMethodDinheiroId,
      paidNow: true,
      idempotencyKey: `rollup-1-${uuidv7()}`,
    }));

  await withTenantTx(actor, (tx) =>
    recordPayment(tx, {
      professionalId: s.professionalId,
      clinicId: s.clinicId,
      categoryId: s.categoryId,
      description: 'Consulta rollup 2',
      amountCents: 15000,
      paymentMethodId: s.paymentMethodPixId,
      paidNow: true,
      idempotencyKey: `rollup-2-${uuidv7()}`,
    }));
});

afterAll(async () => {
  await adminPool.end();
  await closePools();
});

describe('materializeRollup — job noturno', () => {
  it('materializa rollup com as duas bases para o dia', async () => {
    // O job noturno roda com o papel `jobs` (BYPASSRLS).
    // Simulamos com a conexao administrativa.
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      // Descobre o dia dos lancamentos
      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      const result = await materializeRollup(tx as never, s.tenantId, day);
      expect(result.competencia).toBeGreaterThan(0);
      expect(result.caixa).toBeGreaterThan(0);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia retorna vazio apos materializacao correta', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa primeiro
      await materializeRollup(tx as never, s.tenantId, day);

      // Detecta divergencia — deve estar vazio
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs).toEqual([]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('detector de divergencia pega rollup desatualizado', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: client.query.bind(client) };

      const { rows: entryRows } = await client.query<{ d: string }>(
        `SELECT DISTINCT created_at::date::text AS d FROM fin.entry WHERE tenant_id = $1`,
        [s.tenantId]);
      const day = entryRows[0]?.d;
      expect(day).toBeDefined();
      if (!day) return;

      // Materializa
      await materializeRollup(tx as never, s.tenantId, day);

      // Insere um lancamento extra sem rematerializar
      await client.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_at)
         VALUES ($1, $2, 'receita', $3, $4, $5,
                 'Extra nao materializado', 9900, $6, clock_timestamp(), 'pago',
                 $7, $8::date::timestamptz)`,
        [s.tenantId, uuidv7(), s.categoryId, s.professionalId, s.clinicId,
         s.paymentMethodDinheiroId, `extra-${uuidv7()}`, day]);

      // Detecta divergencia — deve encontrar
      const divs = await detectDivergence(tx as never, s.tenantId, day);
      expect(divs.length).toBeGreaterThan(0);

      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
