// apps/api/src/routes/reports.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  buildQuery,
  exportReport,
  validateCustomViewInput,
  type ReportQuery,
  type ExportFormat,
} from '@cadencia/reports';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

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
  }, async () => {
    return {
      views: BUILT_IN_VIEWS.map((v) => ({
        id: v.id,
        name: v.name,
        builtIn: v.builtIn,
        view: v.view,
        chartKind: v.chartKind,
      })),
    };
  });

  // -- GET /v1/reports/views/:id — obter visao por id ---------------------
  r.get('/v1/reports/views/:id', {
    schema: {
      params: z.object({ id: z.string() }),
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = getSavedView(id);
    if (view === undefined) {
      void reply.code(404);
      return { erro: 'visao_nao_encontrada', id };
    }
    return view;
  });

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
}
