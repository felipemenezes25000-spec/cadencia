// packages/payments/src/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { closeRepassePeriod, payRepasse } from './repasse';

interface SementeRepasse {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRepasseDomain(): Promise<SementeRepasse> {
  const s: SementeRepasse = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Fechamento', '44ABC34501DE35')`,
      [s.tenantId, `f-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Fech', '4567890', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Fech')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'BA', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Fech', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.receipt_counter (tenant_id, next_value) VALUES ($1, 1)`,
      [s.tenantId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

let s: SementeRepasse;
let actor: Actor;

beforeAll(async () => {
  s = await semearRepasseDomain();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Criar regra de repasse e entries com splits
  await withTenantTx(actor, async (tx) => {
    const ruleId = uuidv7();
    await tx.query(
      `INSERT INTO fin.split_rule
         (tenant_id, id, professional_id, percentage, priority)
       VALUES (app.require_tenant_id(), $1, $2, 50.00, 1)`,
      [ruleId, s.professionalId]);

    // Criar 3 entries pagos com splits
    for (let i = 0; i < 3; i++) {
      const entryId = uuidv7();
      const splitId = uuidv7();
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta fech', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `fech-${entryId}`]);
      await tx.query(
        `INSERT INTO fin.split
           (tenant_id, id, entry_id, split_rule_id, professional_id,
            clinic_share_cents, professional_share_cents, status)
         VALUES (app.require_tenant_id(), $1, $2, $3, $4,
                 10000, 10000, 'pendente')`,
        [splitId, entryId, ruleId, s.professionalId]);
    }
  });
});

afterAll(async () => { await closePools(); });

describe('closeRepassePeriod — fecha periodo de repasse', () => {
  let statementId = '';

  it('fecha periodo e agrupa splits pendentes', async () => {
    const r = await withTenantTx(actor, (tx) =>
      closeRepassePeriod(tx, {
        tenantId: s.tenantId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.statementId).toBeDefined();
    expect(r.value.totalEntries).toBe(3);
    expect(r.value.totalProfessionalShare).toBe(30000);
    expect(r.value.totalClinicShare).toBe(30000);
    statementId = r.value.statementId;

    // Verificar que os splits foram atualizados para 'creditado'
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; statement_id: string }>(
        `SELECT status::text, statement_id::text
           FROM fin.split
          WHERE professional_id = $1 AND statement_id = $2`,
        [s.professionalId, statementId]));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.status).toBe('creditado');
  });

  it('rejeita fechar periodo sem splits pendentes', async () => {
    const r = await withTenantTx(actor, (tx) =>
      closeRepassePeriod(tx, {
        tenantId: s.tenantId,
        professionalId: s.professionalId,
        clinicId: s.clinicId,
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('sem_splits_pendentes');
  });
});

describe('payRepasse — marca extrato como pago', () => {
  it('marca extrato fechado como pago', async () => {
    // Buscar o statement criado no teste anterior
    const { rows: stmtRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.repasse_statement
          WHERE professional_id = $1 AND status = 'fechado'
          ORDER BY created_at DESC LIMIT 1`,
        [s.professionalId]));

    expect(stmtRows).toHaveLength(1);
    const stmtId = stmtRows[0]!.id;

    const r = await withTenantTx(actor, (tx) =>
      payRepasse(tx, { statementId: stmtId }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('pago');

    // Verificar que os splits foram atualizados para 'pago'
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status::text FROM fin.split WHERE statement_id = $1`,
        [stmtId]));
    expect(rows.every((r) => r.status === 'pago')).toBe(true);
  });

  it('rejeita pagar extrato ja pago', async () => {
    const { rows: stmtRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id::text FROM fin.repasse_statement
          WHERE professional_id = $1 AND status = 'pago'
          ORDER BY created_at DESC LIMIT 1`,
        [s.professionalId]));

    const r = await withTenantTx(actor, (tx) =>
      payRepasse(tx, { statementId: stmtRows[0]!.id }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_pago');
  });
});
