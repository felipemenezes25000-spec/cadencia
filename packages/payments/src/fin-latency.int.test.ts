import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeLatencia {
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

async function semearLatencia(): Promise<SementeLatencia> {
  const s: SementeLatencia = {
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
       VALUES ($1, $2, 'Clinica Latencia', '77ABC88901DE00')`,
      [s.tenantId, `lat-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lat', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Lat')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111000', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Lat')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, is_default)
       VALUES ($1, $2, 'Caixa Lat', false)`,
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

let s: SementeLatencia;
let actor: Actor;

beforeAll(async () => {
  s = await semearLatencia();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear ~240 lancamentos para simular um mes de clinica
  await withTenantTx(actor, async (tx) => {
    const values: string[] = [];
    const params: unknown[] = [s.professionalId, s.clinicId, s.paymentMethodId, s.bankAccountId];
    let idx = 5;

    for (let day = 1; day <= 30; day++) {
      for (let i = 0; i < 8; i++) {
        const entryId = uuidv7();
        const kind = i % 4 === 0 ? 'despesa' : 'receita';
        const amount = kind === 'receita' ? 25000 : 5000;
        values.push(
          `(app.require_tenant_id(), $${idx}, '${kind}'::fin.entry_kind, $1, $2,
           'Lancamento ${day}-${i}', ${amount}, $3, 'pago',
           $${idx + 1}, $4, clock_timestamp() - interval '${30 - day} days')`);
        params.push(entryId, `lat-${entryId}`);
        idx += 2;
      }
    }

    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES ${values.join(',\n')}`,
      params);
  });
});

afterAll(async () => { await closePools(); });

describe('latencia — painel financeiro e extrato', () => {
  it('extrato de 240 lancamentos executa em menos de 50ms', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.lines.length).toBe(240);
    // A transacao inteira (preambulo + query + commit) deve ficar abaixo de 50ms.
    // O alvo real e < 1ms para o rollup; o extrato com window function e mais pesado
    // mas 50ms e conservador.
    expect(duracao).toBeLessThan(50);
  });

  it('fluxo de caixa projetado de 30 dias executa em menos de 50ms', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.weeks.length).toBeGreaterThan(0);
    expect(duracao).toBeLessThan(50);
  });

  it('acoes de authz bank_account.read, bank_account.write e payment.transfer existem', async () => {
    const { ACTION_BY_KEY } = await import('@cadencia/authz');
    expect(ACTION_BY_KEY.get('bank_account.read')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')).toBeDefined();
    expect(ACTION_BY_KEY.get('payment.transfer')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')!.roles).toContain('financeiro');
    expect(ACTION_BY_KEY.get('payment.transfer')!.roles).toContain('financeiro');
  });
});
