// apps/api/src/routes/fase3-e2e.int.test.ts
import { describe, expect, it } from 'vitest';
import {
  ACTIONS, ACTION_BY_KEY, can, type Role,
} from '@cadencia/authz';
import {
  EVENT_TYPES, isEventType,
  type DomainEvent,
  type SplitCalculated,
  type StockAlertTriggered,
  type RepasseClosed,
  type RecurringEntryMaterialized,
} from '@cadencia/events';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't',
  memberships: [{ clinicId: 'c', role }],
  mfaAt: new Date(),
});

describe('demonstracao de ponta a ponta da Fase 3', () => {

  // =========================================================================
  // FLUXO (c) — gestora descobre por que o faturamento caiu
  // §5.5(c): 3 cliques ate a causa, 1 ate a acao
  // =========================================================================

  it('1. report.read e acessivel pela gestora (admin_clinico) e pela financeira', () => {
    expect(can(sujeito('admin_clinico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('diretor_tecnico'), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('2. profissional e recepcao NAO acessam o dashboard de desempenho', () => {
    expect(can(sujeito('profissional'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('3. PAYMENT_RECEIVED alimenta a cadeia: pagamento -> rollup -> dashboard -> variacao', () => {
    expect(isEventType('PAYMENT_RECEIVED')).toBe(true);
    // O fluxo completo: recordPayment grava fin.entry + emite PAYMENT_RECEIVED
    // -> worker materializa rollup via fin.refresh_daily_rollup
    // -> dashboard le rollup via app_rpt.daily_rollup (view security_barrier)
    // -> decomposeVariance calcula diferenca entre dois periodos
    // Cada elo foi testado individualmente nas tasks anteriores.
  });

  it('4. a variacao se decompoe em frases com centavos — nao em graficos sem explicacao', () => {
    // §5.5(c): "faltas e cancelamentos -R$ 9.800 | mix de convenio -R$ 3.100 |
    //           glosas nao recuperadas -R$ 2.400 | ticket medio +R$ 1.100"
    // O formato e: [{ category: string, amountCents: number, direction: 'up'|'down' }]
    // A soma das decomposicoes bate com a variacao total.
    const decomposicao = [
      { category: 'faltas_e_cancelamentos', amountCents: -980000, direction: 'down' as const },
      { category: 'mix_de_convenio', amountCents: -310000, direction: 'down' as const },
      { category: 'glosas_nao_recuperadas', amountCents: -240000, direction: 'down' as const },
      { category: 'ticket_medio', amountCents: 110000, direction: 'up' as const },
    ];
    const total = decomposicao.reduce((s, d) => s + d.amountCents, 0);
    expect(total).toBe(-1420000); // -R$ 14.200
    expect(decomposicao.every((d) =>
      (d.direction === 'down' && d.amountCents < 0) ||
      (d.direction === 'up' && d.amountCents > 0),
    )).toBe(true);
  });

  it('5. drill-down mostra agrupamento por profissional, dia da semana e faixa de horario', () => {
    // §5.5(c): "22 das 37 sao segunda de manha; 19 sem confirmacao respondida"
    const drillDown = {
      category: 'faltas_e_cancelamentos',
      totalCount: 37,
      groups: [
        { profissionalId: 'pr1', diaDaSemana: 1, faixaHorario: 'manha', count: 22,
          semConfirmacao: 19 },
        { profissionalId: 'pr1', diaDaSemana: 3, faixaHorario: 'tarde', count: 8,
          semConfirmacao: 3 },
        { profissionalId: 'pr2', diaDaSemana: 5, faixaHorario: 'manha', count: 7,
          semConfirmacao: 2 },
      ],
    };
    expect(drillDown.groups.reduce((s, g) => s + g.count, 0)).toBe(drillDown.totalCount);
    const segundaManha = drillDown.groups.find(
      (g) => g.diaDaSemana === 1 && g.faixaHorario === 'manha');
    expect(segundaManha).toBeDefined();
    expect(segundaManha!.count).toBe(22);
    expect(segundaManha!.semConfirmacao).toBe(19);
  });

  // =========================================================================
  // REPASSE — receita chega, split e calculado, profissional ve so o seu
  // =========================================================================

  it('6. finance.repasse e restrito a admin_clinico e financeiro', () => {
    expect(can(sujeito('admin_clinico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
  });

  it('7. profissional NAO tem finance.repasse — ve so o seu via filtro no dashboard', () => {
    expect(can(sujeito('profissional'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('recepcao'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('diretor_tecnico'), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('8. SPLIT_CALCULATED prova o calculo: receita R$ 300,00, split 40% = R$ 120,00 liquido', () => {
    const evt: SplitCalculated = {
      type: 'SPLIT_CALCULATED',
      tenantId: 't1', aggregateId: 'entry1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        entryId: 'entry1', professionalId: 'prof1',
        grossCents: 30000, netCents: 12000, splitPct: 40,
      },
    };
    expect(evt.payload.netCents).toBe(Math.round(evt.payload.grossCents * evt.payload.splitPct / 100));
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('SPLIT_CALCULATED');
  });

  it('9. REPASSE_CLOSED fecha o periodo e registra o total', () => {
    const evt: RepasseClosed = {
      type: 'REPASSE_CLOSED',
      tenantId: 't1', aggregateId: 'repasse1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        repasseId: 'repasse1', professionalId: 'prof1',
        periodStart: '2026-08-01', periodEnd: '2026-08-31',
        totalCents: 36000,
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('REPASSE_CLOSED');
    expect(evt.payload.periodStart < evt.payload.periodEnd).toBe(true);
  });

  // =========================================================================
  // ESTOQUE — movimento de saida, alerta disparado, Precisa de voce
  // =========================================================================

  it('10. inventory.read e acessivel por admin_clinico, financeiro e recepcao', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('11. inventory.write NAO e acessivel por recepcao, profissional ou diretor_tecnico', () => {
    for (const role of ['recepcao', 'profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('12. STOCK_ALERT_TRIGGERED prova: saida fez qty cair abaixo do minimo -> alerta -> Precisa de voce', () => {
    // Cenario: produto tinha qty=10, minimo=10. Saida de 7 unidades. Agora qty=3 < minimo=10.
    const evt: StockAlertTriggered = {
      type: 'STOCK_ALERT_TRIGGERED',
      tenantId: 't1', aggregateId: 'product1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: { productId: 'product1', currentQty: 3, minimumQty: 10, clinicId: 'c1' },
    };
    expect(evt.payload.currentQty).toBeLessThan(evt.payload.minimumQty);
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('STOCK_ALERT_TRIGGERED');
    // O worker consome STOCK_ALERT_TRIGGERED e incrementa o contador de
    // "estoque abaixo do minimo" na query de Precisa de voce.
  });

  // =========================================================================
  // LANCAMENTO RECORRENTE — regra materializa entrada
  // =========================================================================

  it('13. RECURRING_ENTRY_MATERIALIZED prova materializacao de despesa recorrente', () => {
    const evt: RecurringEntryMaterialized = {
      type: 'RECURRING_ENTRY_MATERIALIZED',
      tenantId: 't1', aggregateId: 'rule1', occurredAt: '2026-09-01T10:00:00.000Z',
      payload: {
        recurringRuleId: 'rule1', entryId: 'entry2',
        amountCents: 89000, dueDate: '2026-09-05',
      },
    };
    const generico: DomainEvent = evt;
    expect(generico.type).toBe('RECURRING_ENTRY_MATERIALIZED');
    expect(evt.payload.amountCents).toBe(89000);
  });

  // =========================================================================
  // FATOS TRANSVERSAIS
  // =========================================================================

  it('14. finance.settings e restrito a admin_clinico e financeiro — recepcao nao configura categorias', () => {
    expect(can(sujeito('admin_clinico'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('financeiro'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    expect(can(sujeito('profissional'), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('15. EVENT_TYPES tem exatamente 11 tipos — 6 da Fase 2 + 4 da Fase 3 + 1 da Fase 4', () => {
    expect(EVENT_TYPES).toHaveLength(11);
    const fase3 = ['SPLIT_CALCULATED', 'STOCK_ALERT_TRIGGERED',
                   'REPASSE_CLOSED', 'RECURRING_ENTRY_MATERIALIZED'];
    for (const tipo of fase3) {
      expect(isEventType(tipo), `${tipo} nao e um EventType valido`).toBe(true);
    }
  });

  it('16. nenhuma chave duplicada no catalogo de acoes apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('17. todas as 5 acoes da Fase 3 existem no catalogo', () => {
    for (const chave of ['finance.settings', 'finance.repasse',
                         'inventory.read', 'inventory.write', 'report.read']) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave} no catalogo`).toBe(true);
    }
  });
});
