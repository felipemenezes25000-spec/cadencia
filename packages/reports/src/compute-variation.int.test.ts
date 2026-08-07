import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { computeVariation } from './compute-variation';
import { factorsAddUp } from './variation-types';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from './test-support';

describe('computeVariation', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    // Conecta e seta o papel para simular runtime
    pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });

    // Periodo A (junho 2026): 5 consultas a R$250 do profissional A, particular
    for (let i = 0; i < 5; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 1 falta no periodo A
    await criarAtendimentoComLancamento({
      tenantId: s.tenantId, clinicId: s.clinicId,
      patientId: s.patientIds[5]!,
      professionalId: s.professionalIdA,
      procedureId: s.procedureIdConsulta,
      userId: s.userId, paymentMethodId: s.paymentMethodId,
      categoryId: s.categoryId,
      amountCents: 25000, date: '2026-06-20',
      status: 'faltou', operadoraNome: null, pago: false,
    });

    // Periodo B (julho 2026): 3 consultas a R$250 + 2 retornos a R$100
    // do profissional A, particular
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[3 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdRetorno,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 10000, date: `2026-07-${String(15 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
    // 3 faltas no periodo B
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[5 + i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(20 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('soma dos fatores iguala delta total (propriedade matematica)', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    // Periodo A: 5 x R$250 = R$125.000 centavos = 125000
    expect(result.factors.total_a_cents).toBe(125000);
    // Periodo B: 3 x R$250 + 2 x R$100 = R$950 = 95000
    expect(result.factors.total_b_cents).toBe(95000);
    // Delta: 95000 - 125000 = -30000
    expect(result.factors.delta_total_cents).toBe(-30000);
    // PROPRIEDADE MATEMATICA: soma dos fatores = delta
    expect(factorsAddUp(result.factors)).toBe(true);
  });

  it('fator de faltas reflete aumento de faltas no periodo B', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    // Faltas: A teve 1 falta (R$250), B teve 3 faltas (3 x R$250 = R$750)
    // Diferenca = -(75000 - 25000) = -50000 centavos
    expect(result.factors.faltas_cents).toBe(-50000);
  });

  it('glosas sao zero (TISS nao implementado)', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-3',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factors.glosas_cents).toBe(0);
  });

  it('periodos sem dados retornam delta zero e todos os fatores zero', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-var-4',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return computeVariation(tx, s.tenantId, s.clinicId,
        { start: '2025-01-01', end: '2025-01-31' },
        { start: '2025-02-01', end: '2025-02-28' },
      );
    }, pool);

    expect(result.factors.delta_total_cents).toBe(0);
    expect(result.factors.total_a_cents).toBe(0);
    expect(result.factors.total_b_cents).toBe(0);
    expect(factorsAddUp(result.factors)).toBe(true);
  });
});
