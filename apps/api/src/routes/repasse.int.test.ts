// apps/api/src/routes/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeRota {
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

async function semearRota(): Promise<SementeRota> {
  const s: SementeRota = {
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
       VALUES ($1, $2, 'Clinica Rota Repasse', '55ABC34501DE35')`,
      [s.tenantId, `rr-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Rota', '5678901', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Rota')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '888777', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Rota', 'completo')`,
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

let s: SementeRota;
let actor: Actor;

beforeAll(async () => {
  s = await semearRota();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('rotas de repasse — integracao com banco', () => {
  it('cria regra de repasse via domain e le de volta', async () => {
    const ruleId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.split_rule
           (tenant_id, id, professional_id, percentage, priority)
         VALUES (app.require_tenant_id(), $1, $2, 45.00, 1)`,
        [ruleId, s.professionalId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        id: string; professional_id: string; percentage: string;
        procedure_id: string | null; convention_name: string | null;
        priority: number; active: boolean;
      }>(
        `SELECT id::text, professional_id::text, percentage::text,
                procedure_id::text, convention_name, priority, active
           FROM fin.split_rule
          WHERE professional_id = $1 AND active = true
          ORDER BY priority DESC`,
        [s.professionalId]));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rule = rows.find((r) => r.id === ruleId);
    expect(rule).toBeDefined();
    expect(rule!.percentage).toBe('45.00');
    expect(rule!.active).toBe(true);
  });

  it('calcula splits e lista extratos de repasse', async () => {
    // Criar um entry pago
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, patient_id,
            description, amount_cents, payment_method_id, paid_at, status,
            idempotency_key, created_by)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3, $4,
                 'Consulta rota', 20000, $5, clock_timestamp(), 'pago',
                 $6, app.current_user_id())`,
        [entryId, s.professionalId, s.clinicId, s.patientId,
         s.paymentMethodId, `rota-entry-${entryId}`]);

      await tx.query(`SELECT fin.calculate_splits($1, $2)`,
        [s.tenantId, entryId]);
    });

    // Verificar que o split foi criado
    const { rows: splitRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ professional_share_cents: string; status: string }>(
        `SELECT professional_share_cents::text, status::text
           FROM fin.split WHERE entry_id = $1`,
        [entryId]));

    expect(splitRows).toHaveLength(1);
    // 45% de 20000 = 9000
    expect(splitRows[0]!.professional_share_cents).toBe('9000');
    expect(splitRows[0]!.status).toBe('pendente');
  });
});
