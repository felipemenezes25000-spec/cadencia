import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenantTx, type Actor } from '@cadencia/db';
import { drillDownFactor } from './drill-down-factor';
import {
  semearVariacao, criarAtendimentoComLancamento,
  type SementeVariacao,
} from './test-support';

describe('drillDownFactor', () => {
  let s: SementeVariacao;
  let pool: Pool;

  beforeAll(async () => {
    s = await semearVariacao();
    pool = new Pool({
      connectionString: process.env['DATABASE_URL'],
      max: 2,
    });
    pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });

    // Periodo B (julho 2026): 3 faltas do profissional A, todas de manha em dias uteis
    for (let i = 0; i < 3; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[i]!,
        professionalId: s.professionalIdA,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(6 + i).padStart(2, '0')}`,
        status: 'faltou', operadoraNome: null, pago: false,
      });
    }

    // 2 atendimentos realizados do profissional B
    for (let i = 0; i < 2; i++) {
      await criarAtendimentoComLancamento({
        tenantId: s.tenantId, clinicId: s.clinicId,
        patientId: s.patientIds[3 + i]!,
        professionalId: s.professionalIdB,
        procedureId: s.procedureIdConsulta,
        userId: s.userId, paymentMethodId: s.paymentMethodId,
        categoryId: s.categoryId,
        amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
        status: 'atendido', operadoraNome: null, pago: true,
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('drill-down de faltas retorna agrupamentos nao vazios', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-1',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'faltas',
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factor).toBe('faltas');
    expect(result.byProfessional.length).toBeGreaterThan(0);
    expect(result.byDayOfWeek.length).toBeGreaterThan(0);
    expect(result.byTimeSlot.length).toBeGreaterThan(0);

    // Todas as 3 faltas sao do profissional A, de manha
    const totalFaltas = result.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalFaltas).toBe(3);

    const manha = result.byTimeSlot.find((g) => g.label === 'manha');
    expect(manha).toBeDefined();
    expect(manha!.count).toBe(3);

    // `label` e o que a tela IMPRIME. `byTimeSlot` ja entendia isso ('manha'),
    // mas `byProfessional` devolvia o UUID do profissional — e a tela de
    // Desempenho passou a exibi-lo assim que a rota de drill-down foi ligada.
    // Um identificador opaco nao e rotulo: quem le precisa saber de QUEM sao as
    // faltas para agir.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const g of result.byProfessional) {
      expect(g.label).not.toMatch(UUID);
      expect(g.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('drill-down de volume retorna lancamentos pagos agrupados', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-2',
    };
    const result = await withTenantTx(actor, async (tx) => {
      return drillDownFactor(tx, s.tenantId, s.clinicId, 'volume',
        { start: '2026-06-01', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
      );
    }, pool);

    expect(result.factor).toBe('volume');
    // Profissional B tem 2 lancamentos no periodo B
    const totalReceitas = result.byProfessional.reduce((acc, g) => acc + g.count, 0);
    expect(totalReceitas).toBe(2);
  });

  it('fator invalido lanca erro', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: 'test-dd-3',
    };
    await expect(
      withTenantTx(actor, async (tx) => {
        return drillDownFactor(tx, s.tenantId, s.clinicId, 'invalido',
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, pool),
    ).rejects.toThrow('fator invalido: invalido');
  });
});
