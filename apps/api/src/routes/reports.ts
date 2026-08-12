// apps/api/src/routes/reports.ts
//
// Rotas de relatorios: Explorar (query builder), visoes salvas,
// variation, explore financeiro, export CSV/XLSX.
// Acao: report.read. Nenhuma resposta e cacheavel (no-store ja no hook global).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BUILT_IN_VIEWS,
  buildQuery,
  exportReport,
  validateCustomViewInput,
  computeVariation,
  drillDownFactor,
  type ReportQuery,
  type ExportFormat,
} from '@cadencia/reports';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

/**
 * Os seis fatores aditivos, na ORDEM em que a tela empilha o waterfall.
 *
 * A lista espelha `VALID_FACTORS` de `packages/reports` — não por acaso: a
 * função de domínio recusa qualquer nome fora dela, e os campos de
 * `VariationFactors` são exatamente estes com sufixo `_cents`, o que deixa o
 * acesso por template (`f[`${nome}_cents`]`) verificável pelo TypeScript.
 */
const FATORES = [
  'volume', 'mix_procedimento', 'mix_convenio', 'ticket', 'faltas', 'glosas',
] as const;

const ROTULO_DO_FATOR: Record<(typeof FATORES)[number], string> = {
  volume: 'Volume de atendimentos',
  mix_procedimento: 'Mix de procedimentos',
  mix_convenio: 'Mix de convenios',
  ticket: 'Ticket medio',
  faltas: 'Faltas',
  glosas: 'Glosas',
};

/**
 * Dois periodos comparaveis. `clinic_id` e aceito porque o front o envia, e
 * deliberadamente NAO e lido: a clinica sai da sessao, nunca da query.
 */
const PeriodosSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  period_a_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_a_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_b_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type Periodos = z.infer<typeof PeriodosSchema>;

const FilterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'like']),
  value: z.unknown(),
});

const SortSchema = z.object({
  column: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
});

const ColumnsSchema = z.object({
  visible: z.array(z.string().min(1)).min(1),
  groupBy: z.string().optional(),
  aggregate: z.object({
    column: z.string(),
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  }).optional(),
});

const QuerySchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  limit: z.number().int().min(1).max(5000).default(50),
  offset: z.number().int().min(0).default(0),
});

const ExportSchema = z.object({
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  format: z.enum(['csv', 'xlsx']),
  headers: z.record(z.string(), z.string()).default({}),
});

const CustomViewSchema = z.object({
  name: z.string().min(1).max(120),
  view: z.enum(['atendimentos', 'financeiro', 'pacientes', 'mensagens']),
  filters: z.array(FilterSchema).default([]),
  columns: ColumnsSchema,
  sort: z.array(SortSchema).default([]),
  chartKind: z.enum(['bar', 'line', 'pie', 'table']).default('table'),
});

const VariationBlockSchema = z.object({
  currentCents: z.number().int(),
  previousCents: z.number().int(),
  variationPercent: z.number(),
});

const ExploreItemSchema = z.object({
  label: z.string(),
  amountCents: z.number().int(),
  entries: z.number().int(),
});

const HEADER_MAP: Record<string, string> = {
  professional_name: 'Profissional',
  patient_name: 'Paciente',
  occurred_date: 'Data',
  status: 'Status',
  procedure_name: 'Procedimento',
  category_name: 'Categoria',
  kind: 'Tipo',
  amount_cents: 'Valor (centavos)',
  channel: 'Canal',
  template_name: 'Template',
  sent_at: 'Enviado em',
  birth_date: 'Data de nascimento',
  birth_month_day: 'Mes/Dia',
  phone: 'Telefone',
  age: 'Idade',
  cid_code: 'CID',
  cid_description: 'Descricao CID',
  referral_source: 'Indicacao',
  basis: 'Base',
  day_of_week: 'Dia da semana',
  time_slot: 'Faixa de horario',
  last_visit_date: 'Ultima visita',
  return_due_date: 'Retorno previsto',
};

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- GET /v1/reports/views — listar visoes salvas -----------------------
  r.get('/v1/reports/views', {
    schema: {
      response: {
        200: z.object({
          views: z.array(z.object({
            id: z.string(),
            name: z.string(),
            builtIn: z.boolean(),
            view: z.string(),
            chartKind: z.string(),
          })),
        }),
      },
    },
    // Era a UNICA rota de negocio do repositorio sem `rota()`: sem sessao e sem
    // checagem de acao. O conteudo e catalogo estatico, nao dado de tenant, mas
    // uma rota aberta continua sendo superficie de reconhecimento — e as sete
    // irmas deste mesmo arquivo exigem `report.read`.
  }, rota('report.read', async () => {
    return {
      views: BUILT_IN_VIEWS.map((v) => ({
        id: v.id,
        name: v.name,
        builtIn: v.builtIn,
        view: v.view,
        chartKind: v.chartKind,
      })),
    };
  }));

  // -- GET /v1/reports/views/:viewId — executar visao salva ----------------
  r.get('/v1/reports/views/:viewId', {
    schema: {
      params: z.object({ viewId: z.string().min(1).max(100) }),
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          viewId: z.string(),
          data: z.array(z.record(z.string(), z.unknown())),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const p = req.params as { viewId: string };
    const q = req.query as { from: string; to: string };

    // Visoes pre-definidas — cada uma mapeia para uma query especifica
    // A implementacao completa sera feita quando as matviews existirem;
    // por ora, todas as visoes consultam fin.entry diretamente.
    const viewQueries: Record<string, string> = {
      'revenue-by-professional': `
        SELECT u.full_name AS label, SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN id."user" u ON u.id = e.professional_id
         WHERE e.clinic_id = $1 AND e.kind = 'receita' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY u.full_name
         ORDER BY SUM(e.amount_cents) DESC`,
      'expenses-by-category': `
        SELECT COALESCE(c.name, 'Sem categoria') AS label,
               SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN fin.category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         WHERE e.clinic_id = $1 AND e.kind = 'despesa' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY c.name
         ORDER BY SUM(e.amount_cents) DESC`,
      'daily-cashflow': `
        SELECT e.paid_at::date::text AS day,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END)::text AS revenue_cents,
               SUM(CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END)::text AS expense_cents,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE -e.amount_cents END)::text AS net_cents
          FROM fin.entry e
         WHERE e.clinic_id = $1 AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY e.paid_at::date
         ORDER BY e.paid_at::date`,
    };

    const sql = viewQueries[p.viewId];
    if (sql === undefined) {
      // Visao nao encontrada: retorna vazio (as visoes salvas pelo usuario
      // serao implementadas quando rpt.saved_view existir)
      return { viewId: p.viewId, data: [] };
    }

    const { rows } = await tx.query(sql, [ctx.actor.clinicId, q.from, q.to]);
    return { viewId: p.viewId, data: rows as Record<string, unknown>[] };
  }));

  // -- POST /v1/reports/query — executar consulta do Explorar -------------
  r.post('/v1/reports/query', {
    schema: {
      body: QuerySchema,
    },
  }, rota('report.read', async (tx, _ctx, req) => {
    const body = req.body as ReportQuery;
    const built = buildQuery(body);
    const { rows } = await tx.query(built.sql, [...built.params]);
    return { rows, total: rows.length };
  }));

  // -- POST /v1/reports/export — exportar dados filtrados -----------------
  r.post('/v1/reports/export', {
    schema: {
      body: ExportSchema,
    },
  }, rota('report.read', async (tx, _ctx, req, reply) => {
    const body = req.body as {
      view: string; filters: any[]; columns: any; sort: any[];
      format: ExportFormat; headers: Record<string, string>;
    };

    const query: ReportQuery = {
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      limit: 50000,
      offset: 0,
    };
    const built = buildQuery(query);
    const { rows } = await tx.query(built.sql, [...built.params]);

    const columns = body.columns.visible as string[];
    const headers = { ...HEADER_MAP, ...body.headers };
    const buf = exportReport(rows, columns, headers, body.format);

    const mime = body.format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = body.format === 'csv' ? 'csv' : 'xlsx';

    void reply.header('content-type', mime);
    void reply.header('content-disposition',
      `attachment; filename="relatorio.${ext}"`);
    return buf;
  }));

  // -- POST /v1/reports/views/custom — salvar visao customizada -----------
  r.post('/v1/reports/views/custom', {
    schema: {
      body: CustomViewSchema,
      response: {
        201: z.object({ viewId: z.string().uuid() }),
        422: z.object({ erro: z.string(), mensagem: z.string() }),
      },
    },
  }, rota('report.view.write', async (tx, _ctx, req, reply) => {
    const body = req.body as {
      name: string; view: string; filters: any[];
      columns: any; sort: any[]; chartKind: string;
    };

    const result = validateCustomViewInput({
      name: body.name,
      view: body.view as any,
      filters: body.filters,
      columns: body.columns,
      sort: body.sort,
      chartKind: body.chartKind as any,
    });

    if (!result.ok) {
      void reply.code(422);
      return { erro: result.error.code, mensagem: result.error.message };
    }

    const viewId = uuidv7();

    await tx.query(
      `INSERT INTO app.saved_report_view
         (id, user_id, name, view_name, filters, columns, sort, chart_kind)
       VALUES ($1, app.current_user_id(), $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
      [viewId, body.name, body.view,
       JSON.stringify(body.filters), JSON.stringify(body.columns),
       JSON.stringify(body.sort), body.chartKind]);

    void reply.code(201);
    return { viewId };
  }));

  // ── GET /v1/reports/variation — variacoes do periodo ───────────────────
  r.get('/v1/reports/variation', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          revenue: VariationBlockSchema,
          expenses: VariationBlockSchema,
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as { from: string; to: string; compareTo: string };

    // Calcular duracao do periodo atual para derivar periodo anterior
    const currentFrom = q.from;
    const currentTo = q.to;
    const previousFrom = q.compareTo;

    // Consulta agregando entries no periodo atual
    const { rows: currentRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $2::date
          AND paid_at < ($3::date + 1)
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo]);

    // Consulta no periodo anterior (mesma duracao, comecando em compareTo)
    const { rows: previousRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $4::date
          AND paid_at < ($4::date + ($3::date - $2::date + 1))
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo, previousFrom]);

    function findTotal(rows: Array<{ kind: string; total: string }>, kind: string): number {
      const row = rows.find((r) => r.kind === kind);
      return row !== undefined ? Number(row.total) : 0;
    }

    function variacao(current: number, previous: number): number {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 10000) / 100;
    }

    const currentRevenue = findTotal(currentRows, 'receita');
    const previousRevenue = findTotal(previousRows, 'receita');
    const currentExpenses = findTotal(currentRows, 'despesa');
    const previousExpenses = findTotal(previousRows, 'despesa');

    return {
      revenue: {
        currentCents: currentRevenue,
        previousCents: previousRevenue,
        variationPercent: variacao(currentRevenue, previousRevenue),
      },
      expenses: {
        currentCents: currentExpenses,
        previousCents: previousExpenses,
        variationPercent: variacao(currentExpenses, previousExpenses),
      },
    };
  }));

  // ── GET /v1/reports/variation/factors — decomposicao aditiva do delta ──
  //
  // NAO e a rota `/v1/reports/variation` logo acima: aquela devolve os blocos de
  // receita e despesa do periodo. Esta responde outra pergunta — POR QUE a
  // receita mudou — decompondo o delta em fatores que somam exatamente o total.
  //
  // A função de domínio (`computeVariation`) existia e era testada desde a Fase
  // 3, mas nunca chegou a ter rota: o teste `variation.int.test.ts` chama o
  // domínio dentro de uma transação e diz, no próprio comentário, que montar o
  // HTTP era "responsabilidade de outro bloco". Esse bloco não veio, e a tela de
  // Desempenho chamava um caminho que não existia.
  //
  // `clinic_id` chega na query porque o front o envia, e é IGNORADO de
  // propósito: a clínica vem de `ctx.actor`, que saiu da sessão. Aceitar o id do
  // cliente aqui seria deixar o navegador escolher de qual clínica ler.
  r.get('/v1/reports/variation/factors', {
    schema: {
      querystring: PeriodosSchema,
      response: {
        200: z.object({
          factors: z.array(z.object({
            factor: z.enum(FATORES),
            label: z.string(),
            delta_cents: z.number().int(),
          })),
          totalACents: z.number().int(),
          totalBCents: z.number().int(),
          deltaTotalCents: z.number().int(),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as Periodos;
    const snap = await computeVariation(
      tx, ctx.actor.tenantId, ctx.actor.clinicId,
      { start: q.period_a_start, end: q.period_a_end },
      { start: q.period_b_start, end: q.period_b_end },
    );
    const f = snap.factors;
    return {
      // Os totais ficam FORA da lista: somar `total_a_cents` ao waterfall
      // dobraria a receita do periodo na tela. Sao contexto, nao fator.
      factors: FATORES.map((nome) => ({
        factor: nome,
        label: ROTULO_DO_FATOR[nome],
        delta_cents: f[`${nome}_cents`],
      })),
      totalACents: f.total_a_cents,
      totalBCents: f.total_b_cents,
      deltaTotalCents: f.delta_total_cents,
    };
  }));

  // ── GET /v1/reports/variation/drill-down — abre um fator ───────────────
  //
  // O dominio calcula as TRES dimensoes de uma vez (profissional, dia da semana
  // e faixa de horario) porque as tres saem das mesmas linhas. A tela mostra uma
  // por vez, entao a rota escolhe: `dimension` decide, e o padrao e
  // `profissional` — a mesma dimensao que o front assume quando falha.
  r.get('/v1/reports/variation/drill-down', {
    schema: {
      querystring: PeriodosSchema.extend({
        factor: z.enum(FATORES),
        dimension: z.enum(['profissional', 'dia_semana', 'faixa_horario'])
          .default('profissional'),
      }),
      response: {
        200: z.object({
          dimension: z.enum(['profissional', 'dia_semana', 'faixa_horario']),
          groups: z.array(z.object({
            key: z.string(),
            label: z.string(),
            count: z.number().int(),
            valueCents: z.number().int(),
          })),
          totalCount: z.number().int(),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as Periodos & {
      factor: (typeof FATORES)[number];
      dimension: 'profissional' | 'dia_semana' | 'faixa_horario';
    };
    const r2 = await drillDownFactor(
      tx, ctx.actor.tenantId, ctx.actor.clinicId, q.factor,
      { start: q.period_a_start, end: q.period_a_end },
      { start: q.period_b_start, end: q.period_b_end },
    );
    const grupos = q.dimension === 'dia_semana' ? r2.byDayOfWeek
      : q.dimension === 'faixa_horario' ? r2.byTimeSlot
      : r2.byProfessional;

    return {
      dimension: q.dimension,
      // O dominio nao emite `key` separada do rotulo; dentro de uma dimensao o
      // rotulo ja e unico (um profissional, um dia, uma faixa), entao serve de
      // chave estavel para o React sem inventar identificador.
      groups: grupos.map((g) => ({
        key: g.label, label: g.label, count: g.count, valueCents: g.amount_cents,
      })),
      totalCount: grupos.reduce((soma, g) => soma + g.count, 0),
    };
  }));

  // ── GET /v1/reports/explore — exploracao livre ────────────────────────
  r.get('/v1/reports/explore', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        groupBy: z.enum(['category', 'professional', 'method', 'day']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(ExploreItemSchema),
          period: z.object({ from: z.string(), to: z.string() }),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as {
      from: string; to: string; groupBy: string; kind?: string };

    const groupColumn: Record<string, string> = {
      category: `COALESCE(c.name, 'Sem categoria')`,
      professional: `COALESCE(u.full_name, 'Sem profissional')`,
      method: `pm.kind::text`,
      day: `e.paid_at::date::text`,
    };
    const groupExpr = groupColumn[q.groupBy] ?? `e.paid_at::date::text`;

    const kindFilter = q.kind !== undefined
      ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      label: string; amount_cents: string; entries: string;
    }>(
      `SELECT ${groupExpr} AS label,
              COALESCE(SUM(e.amount_cents), 0)::text AS amount_cents,
              COUNT(*)::text AS entries
         FROM fin.entry e
         LEFT JOIN fin.category c
           ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         LEFT JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
         LEFT JOIN id."user" u
           ON u.id = e.professional_id
        WHERE e.clinic_id = $1
          AND e.status = 'pago'
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        GROUP BY ${groupExpr}
        ORDER BY SUM(e.amount_cents) DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        label: row.label,
        amountCents: Number(row.amount_cents),
        entries: Number(row.entries),
      })),
      period: { from: q.from, to: q.to },
    };
  }));

  // ── GET /v1/reports/export — exportar CSV ─────────────────────────────
  r.get('/v1/reports/export', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(['csv']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
    },
  }, rota('report.read', async (tx, ctx, req, reply) => {
    const q = req.query as { from: string; to: string; format: string; kind?: string };

    const kindFilter = q.kind !== undefined ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      data: string; descricao: string; valor: string;
      tipo: string; metodo: string; status: string;
    }>(
      `SELECT to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data,
              e.description AS descricao,
              (e.amount_cents / 100.0)::text AS valor,
              e.kind::text AS tipo,
              pm.kind::text AS metodo,
              e.status::text AS status
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
        WHERE e.clinic_id = $1
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        ORDER BY e.paid_at DESC`,
      params);

    const header = 'Data,Descricao,Valor,Tipo,Metodo,Status\n';
    const csvRows = rows.map((row) =>
      `${row.data},"${row.descricao.replace(/"/g, '""')}",${row.valor},${row.tipo},${row.metodo},${row.status}`
    ).join('\n');
    const csv = header + csvRows;

    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header('content-disposition',
      `attachment; filename="relatorio-${q.from}-${q.to}.csv"`);
    return csv;
  }));
}
