import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from '@cadencia/reports/test-support';
import { factorsAddUp } from '@cadencia/reports';

/**
 * Testa as funcoes de dominio diretamente (nao o servidor HTTP), porque
 * a montagem do Fastify com plugins de sessao/CSRF e responsabilidade
 * de outro bloco (API shell). Aqui validamos que computeVariation e
 * drillDownFactor funcionam end-to-end com dados sinteticos.
 */
import { withTenantTx, type Actor } from '@cadencia/db';
import { computeVariation, drillDownFactor } from '@cadencia/reports';

describe('rota variation — teste de dominio end-to-end', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
      options: '-c role=app_rw',
    });

    // Cenario: receita caiu de R$1.250 (jun) para R$950 (jul)
    // Junho: 5 consultas R$250 particular
    for (let i = 0; i < 5; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-06-${String(2 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // Julho: 3 consultas R$250 + 2 retornos R$100
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(2 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[5 + i]!,
        professionalId: s.professionalIdB,
        procedureId: s.procedureIdRetorno,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 10000, date: `2026-07-${String(7 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 2 faltas em julho
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[7 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(14 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('fluxo completo: computa variacao e faz drill-down de faltas', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-e2e-1',
    };
    const periodA = { start: '2026-06-01', end: '2026-06-30' };
    const periodB = { start: '2026-07-01', end: '2026-07-31' };

    // Passo 1: computar variacao
    const variation = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId, periodA, periodB);
    }, pool);

    expect(variation.factors.total_a_cents).toBe(125000);
    expect(variation.factors.total_b_cents).toBe(95000);
    expect(variation.factors.delta_total_cents).toBe(-30000);
    expect(factorsAddUp(variation.factors)).toBe(true);

    // Passo 2: drill-down de faltas
    const drillDown = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'faltas', periodA, periodB);
    }, pool);

    expect(drillDown.factor).toBe('faltas');
    const totalFaltas = drillDown.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalFaltas).toBe(2);
  });

  it('computeVariation com periodos identicos retorna delta zero', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-e2e-2',
    };
    const period = { start: '2026-06-01', end: '2026-06-30' };

    const variation = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId, period, period);
    }, pool);

    expect(variation.factors.delta_total_cents).toBe(0);
    expect(factorsAddUp(variation.factors)).toBe(true);
  });
});
