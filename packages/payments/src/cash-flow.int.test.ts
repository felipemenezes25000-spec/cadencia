import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeCashFlow {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCashFlow(): Promise<SementeCashFlow> {
  const s: SementeCashFlow = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica CF', '55ABC66701DE88')`,
      [s.tenantId, `cf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade CF', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario CF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix CF')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name)
       VALUES ($1, $2, 'Caixa CF')`,
      [s.tenantId, s.bankAccountId]);
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

let s: SementeCashFlow;
let actor: Actor;

beforeAll(async () => {
  s = await semearCashFlow();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lancamentos: um pago (realizado) e um pendente (projetado)
  await withTenantTx(actor, async (tx) => {
    // Receita paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta paga', 25000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-paid-${uuidv7()}`, s.bankAccountId]);

    // Despesa paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material', 5000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-exp-${uuidv7()}`, s.bankAccountId]);

    // Receita pendente com vencimento em 10 dias (projetada)
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, due_date)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Retorno futuro', 18000, $4, 'pendente', $5, $6,
               current_date + 10)`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-fut-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getCashFlowProjection — fluxo de caixa projetado', () => {
  it('retorna semanas com realizado e projetado', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 14 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 28 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));

    expect(r.weeks.length).toBeGreaterThan(0);

    // Pelo menos uma semana deve ter receita realizada
    const temRealizado = r.weeks.some((w) => w.realizedInCents > 0 || w.realizedOutCents > 0);
    expect(temRealizado).toBe(true);

    // Pelo menos uma semana deve ter receita projetada
    const temProjetado = r.weeks.some((w) => w.projectedInCents > 0);
    expect(temProjetado).toBe(true);

    // Toda semana tem saldo acumulado
    for (const w of r.weeks) {
      expect(typeof w.cumulativeBalanceCents).toBe('number');
    }
  });

  it('retorna array vazio se nao ha lancamentos no periodo', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: '2020-01-01',
      toDate: '2020-01-31',
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    expect(r.weeks).toHaveLength(0);
  });
});
