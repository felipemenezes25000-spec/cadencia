// packages/payments/src/split-rule.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createSplitRule, calculateSplits } from './split-rule';

interface SementeDomain {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  paymentMethodId: string;
  procedureId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDomain(): Promise<SementeDomain> {
  const s: SementeDomain = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    paymentMethodId: uuidv7(), procedureId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Domain', '33ABC34501DE35')`,
      [s.tenantId, `d-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Domain', '3456789', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Domain')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Domain', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min, valor_centavos)
       VALUES ($1, $2, 'CONS', 'Consulta', '#2f5fd0', 30, 25000)`,
      [s.tenantId, s.procedureId]);
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

let s: SementeDomain;
let actor: Actor;

beforeAll(async () => {
  s = await semearDomain();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createSplitRule — cria regra de repasse', () => {
  it('cria regra percentual default', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        percentage: 50,
        priority: 1,
      }));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ruleId).toBeDefined();
  });

  it('cria regra com valor fixo para procedimento', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        procedureId: s.procedureId,
        fixedAmountCents: 12000,
        priority: 10,
      }));

    expect(r.ok).toBe(true);
  });

  it('rejeita percentage fora de 0-100', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        conventionName: 'Teste_Invalido',
        percentage: 150,
        priority: 1,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('percentual_invalido');
  });

  it('rejeita regra sem percentage nem fixedAmountCents', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createSplitRule(tx, {
        professionalId: s.professionalId,
        conventionName: 'Teste_Vazio',
        priority: 1,
      }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('valor_ausente');
  });
});

describe('calculateSplits — calcula divisao para entry pago', () => {
  it('cria split automaticamente para entry pago', async () => {
    const entryId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta domain', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `domain-calc-${entryId}`]);
    });

    const r = await withTenantTx(actor, (tx) =>
      calculateSplits(tx, s.tenantId, entryId));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.calculated).toBe(true);
  });

  it('retorna calculated=false quando entry nao e receita paga', async () => {
    const entryId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id,
            description, amount_cents, payment_method_id, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Material', 5000, $4, 'pago',
                 $5, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId,
         s.paymentMethodId, `domain-despesa-${entryId}`]);
    });

    const r = await withTenantTx(actor, (tx) =>
      calculateSplits(tx, s.tenantId, entryId));

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.calculated).toBe(false);
  });
});
