// packages/payments/src/installment.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeInstallment {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  motherEntryId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearInstallment(): Promise<SementeInstallment> {
  const s: SementeInstallment = {
    tenantId: uuidv7(), clinicId: uuidv7(),
    userId: uuidv7(), professionalId: uuidv7(),
    paymentMethodId: uuidv7(), motherEntryId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Parcela', '11ABC22301DE44')`,
      [s.tenantId, `inst-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Inst', '5555555', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Inst')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'cartao_credito', 'Cartao Credito Inst')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key, created_by)
       VALUES ($1, $2, 'despesa', $3, $4,
               'Equipamento odontologico', 120000, $5, 'pendente',
               $6, $7)`,
      [s.tenantId, s.motherEntryId, s.professionalId, s.clinicId,
       s.paymentMethodId, `mother-${s.motherEntryId}`, s.userId]);
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

let s: SementeInstallment;
let actor: Actor;

beforeAll(async () => {
  s = await semearInstallment();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('fin.installment_plan — parcelamento', () => {
  it('cria plano de parcelamento com parcela-mae e filhas', async () => {
    const planId = uuidv7();
    const child1Id = uuidv7();
    const child2Id = uuidv7();
    const child3Id = uuidv7();

    await withTenantTx(actor, async (tx) => {
      // Cria 3 entries filhas (parcelas)
      for (const [id, desc, due] of [
        [child1Id, 'Parcela 1/3', '2026-09-15'],
        [child2Id, 'Parcela 2/3', '2026-10-15'],
        [child3Id, 'Parcela 3/3', '2026-11-15'],
      ] as const) {
        await tx.query(
          `INSERT INTO fin.entry
             (tenant_id, id, kind, professional_id, clinic_id, description,
              amount_cents, payment_method_id, status, due_date, idempotency_key)
           VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                   $4, 40000, $5, 'pendente', $6::date, $7)`,
          [id, s.professionalId, s.clinicId, desc, s.paymentMethodId, due,
           `inst-${id}`]);
      }

      // Cria o plano de parcelamento
      await tx.query(
        `INSERT INTO fin.installment_plan
           (tenant_id, id, mother_entry_id, total_installments, generated_installments)
         VALUES (app.require_tenant_id(), $1, $2, 3, 3)`,
        [planId, s.motherEntryId]);

      // Vincula parcelas ao plano
      await tx.query(
        `UPDATE fin.entry SET installment_plan_id = $1
          WHERE id IN ($2, $3, $4)`,
        [planId, child1Id, child2Id, child3Id]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        total_installments: number;
        generated_installments: number;
        linked_entries: string;
      }>(
        `SELECT ip.total_installments, ip.generated_installments,
                count(e.id)::text AS linked_entries
           FROM fin.installment_plan ip
           LEFT JOIN fin.entry e ON e.installment_plan_id = ip.id
          WHERE ip.id = $1
          GROUP BY ip.id`,
        [planId]));

    expect(rows[0]).toEqual({
      total_installments: 3,
      generated_installments: 3,
      linked_entries: '3',
    });
  });

  it('rejeita mother_entry_id inexistente (FK composta)', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.installment_plan
             (tenant_id, id, mother_entry_id, total_installments, generated_installments)
           VALUES (app.require_tenant_id(), $1, $2, 3, 0)`,
          [uuidv7(), uuidv7()]);
      }),
    ).rejects.toThrow();
  });

  it('rejeita total_installments menor que 2', async () => {
    await expect(
      withTenantTx(actor, async (tx) => {
        await tx.query(
          `INSERT INTO fin.installment_plan
             (tenant_id, id, mother_entry_id, total_installments, generated_installments)
           VALUES (app.require_tenant_id(), $1, $2, 1, 0)`,
          [uuidv7(), s.motherEntryId]);
      }),
    ).rejects.toThrow();
  });
});
