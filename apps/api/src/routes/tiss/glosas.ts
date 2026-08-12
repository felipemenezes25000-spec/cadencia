// apps/api/src/routes/tiss/glosas.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const GlosaResumoSchema = z.object({
  glosaId: z.string().uuid(),
  demonstrativoItemId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  numeroGuiaPrestador: z.string(),
  codigoGlosa: z.string(),
  // Sem estes três a lista não serve para abrir recurso, que é o único motivo
  // de olhar glosa: `descricaoGlosa` para quem redige a justificativa,
  // `pacienteNome` para o faturista conferir o caso, e `encounterVersionId`
  // porque `POST /v1/tiss/recursos` exige a versão do atendimento.
  descricaoGlosa: z.string().nullable(),
  pacienteNome: z.string(),
  encounterVersionId: z.string().uuid().nullable(),
  valorGlosadoCents: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});

const GlosaDetalheSchema = GlosaResumoSchema.extend({
  // `descricaoGlosa` volta a ser nulável aqui também: a operadora manda o código
  // e nem sempre o texto. Forçar string obrigaria a inventar descrição — e
  // descrição inventada é o que o faturista leria como se fosse da operadora.
  dataProcessamento: z.string(),
});

export async function glosaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/tiss/glosas — listar glosas com filtros ───────────────────
  r.get('/v1/tiss/glosas', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        status: z.enum(['pendente', 'aceita', 'contestada', 'revertida']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(GlosaResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; status?: string;
      limit?: number; cursor?: string;
    };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.operadoraId !== undefined) {
      condicoes.push(`d.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.status !== undefined) {
      condicoes.push(`g.status = $${idx}`);
      params.push(q.status); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`g.created_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; demonstrativo_item_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_glosa: string;
      descricao_glosa: string | null; encounter_version_id: string | null;
      paciente_nome: string;
      valor_glosado_cents: string; status: string; created_at: string;
    }>(
      `SELECT g.id, g.demonstrativo_item_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo_operadora AS protocolo,
              di.numero_guia_prestador, g.codigo_glosa,
              g.descricao_glosa, g.encounter_version_id,
              coalesce(pat.display_name, '') AS paciente_nome,
              g.valor_glosado_cents::text, g.status::text,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.glosa g
         JOIN tiss.demonstrativo_item di
           ON di.tenant_id = g.tenant_id AND di.id = g.demonstrativo_item_id
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
         -- LEFT: glosa de guia que ainda não amarrou o atendimento continua
         -- aparecendo na lista. Sumir a linha esconderia dinheiro a recuperar.
         LEFT JOIN clin.encounter_version ev
           ON (ev.tenant_id, ev.id) = (g.tenant_id, g.encounter_version_id)
         LEFT JOIN clin.encounter enc
           ON (enc.tenant_id, enc.id) = (ev.tenant_id, ev.encounter_id)
         LEFT JOIN clin.patient pat
           ON (pat.tenant_id, pat.id) = (enc.tenant_id, enc.patient_id)
         ${where}
        ORDER BY g.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      glosaId: row.id,
      demonstrativoItemId: row.demonstrativo_item_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoGlosa: row.codigo_glosa,
      descricaoGlosa: row.descricao_glosa,
      pacienteNome: row.paciente_nome,
      encounterVersionId: row.encounter_version_id,
      valorGlosadoCents: Number(row.valor_glosado_cents),
      status: row.status,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/glosas/:id — detalhe da glosa ───────────────────────
  r.get('/v1/tiss/glosas/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: GlosaDetalheSchema },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; demonstrativo_item_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_glosa: string;
      descricao_glosa: string | null; encounter_version_id: string | null;
      paciente_nome: string; valor_glosado_cents: string;
      status: string; data_processamento: string; created_at: string;
    }>(
      `SELECT g.id, g.demonstrativo_item_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo_operadora AS protocolo,
              di.numero_guia_prestador, g.codigo_glosa,
              g.descricao_glosa, g.encounter_version_id,
              coalesce(pat.display_name, '') AS paciente_nome,
              g.valor_glosado_cents::text,
              g.status::text,
              d.data_processamento::text,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.glosa g
         JOIN tiss.demonstrativo_item di
           ON di.tenant_id = g.tenant_id AND di.id = g.demonstrativo_item_id
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
         LEFT JOIN clin.encounter_version ev
           ON (ev.tenant_id, ev.id) = (g.tenant_id, g.encounter_version_id)
         LEFT JOIN clin.encounter enc
           ON (enc.tenant_id, enc.id) = (ev.tenant_id, ev.encounter_id)
         LEFT JOIN clin.patient pat
           ON (pat.tenant_id, pat.id) = (enc.tenant_id, enc.patient_id)
        WHERE g.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const row = rows[0]!;

    return {
      glosaId: row.id,
      demonstrativoItemId: row.demonstrativo_item_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoGlosa: row.codigo_glosa,
      descricaoGlosa: row.descricao_glosa,
      pacienteNome: row.paciente_nome,
      encounterVersionId: row.encounter_version_id,
      valorGlosadoCents: Number(row.valor_glosado_cents),
      status: row.status,
      dataProcessamento: row.data_processamento,
      createdAt: row.created_at,
    };
  }));

  // ── POST /v1/tiss/glosas/:id/aceitar — aceitar glosa individual ───────
  r.post('/v1/tiss/glosas/:id/aceitar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          glosaId: z.string().uuid(),
          status: z.literal('aceita'),
        }),
      },
    },
  }, rota('tiss.glosa.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{ status: string }>(
      `SELECT status::text FROM tiss.glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const glosa = rows[0]!;

    if (glosa.status !== 'pendente') {
      erroDominio('glosa_ja_processada', 422,
        { statusAtual: glosa.status });
    }

    await tx.query(
      `UPDATE tiss.glosa
          SET status = 'aceita',
              resolved_at = clock_timestamp(),
              resolved_by = app.current_user_id()
        WHERE id = $1`,
      [p.id]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_GLOSA_ACEITA', 'tiss', 'glosa',
              $1, 'sucesso',
              jsonb_build_object('status', 'aceita'::text), $2)`,
      [p.id, ctx.actor.clinicId]);

    return { glosaId: p.id, status: 'aceita' as const };
  }));
}
