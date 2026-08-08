// apps/api/src/routes/tiss/recursos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const RecursoResumoSchema = z.object({
  recursoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  encounterVersionId: z.string().uuid(),
  numeroRecurso: z.string(),
  status: z.string(),
  justificativaGeral: z.string().nullable(),
  itemCount: z.number().int(),
  totalRecursadoCents: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});

const RecursoItemSchema = z.object({
  itemId: z.string().uuid(),
  glosaId: z.string().uuid(),
  justificativaItem: z.string(),
  valorRecursadoCents: z.number().int(),
  resultado: z.string().nullable(),
});

export async function recursoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/recursos — criar recurso vazio ──────────────────────
  r.post('/v1/tiss/recursos', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        encounterVersionId: z.string().uuid(),
        justificativaGeral: z.string().min(1).max(2000).optional(),
      }),
      response: { 201: z.object({ recursoId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      operadoraId: string; encounterVersionId: string;
      justificativaGeral?: string;
    };
    const id = uuidv7();

    // Verificar que a operadora existe
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    // Verificar que a encounter_version existe
    const { rowCount: verExiste } = await tx.query(
      `SELECT 1 FROM clin.encounter_version WHERE id = $1`,
      [b.encounterVersionId]);
    if (verExiste === 0) erroDominio('versao_nao_encontrada', 404);

    // Auto-provisionar numero_recurso
    const { rows: numRows } = await tx.query<{ next_recurso_number: string }>(
      `SELECT tiss.next_recurso_number(app.current_tenant_id(), $1)::text`,
      [b.operadoraId]);
    const numeroRecurso = numRows[0]!.next_recurso_number;

    await tx.query(
      `INSERT INTO tiss.recurso_glosa
         (id, operadora_id, numero_recurso, status,
          justificativa_geral, encounter_version_id,
          item_count, total_recursado_cents, created_by)
       VALUES ($1, $2, $3, 'rascunho', $4, $5,
               0, 0, app.current_user_id())`,
      [id, b.operadoraId, numeroRecurso,
       b.justificativaGeral ?? null, b.encounterVersionId]);

    void reply.code(201);
    return { recursoId: id };
  }));

  // ── POST /v1/tiss/recursos/:id/itens — adicionar glosa ao recurso ────
  r.post('/v1/tiss/recursos/:id/itens', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        glosaId: z.string().uuid(),
        justificativaItem: z.string().min(1).max(2000),
        valorRecursadoCents: z.number().int().min(1),
      }),
      response: { 201: z.object({ itemId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      glosaId: string; justificativaItem: string;
      valorRecursadoCents: number;
    };

    // Verificar que o recurso existe e esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status::text, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Verificar que a glosa existe e esta pendente
    const { rows: glosaRows } = await tx.query<{ status: string }>(
      `SELECT status::text FROM tiss.glosa WHERE id = $1`,
      [b.glosaId]);
    if (glosaRows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    if (glosaRows[0]!.status !== 'pendente') {
      erroDominio('glosa_nao_pendente', 422);
    }

    // Verificar se a glosa ja esta em outro recurso ativo
    const { rowCount: jaEmRecurso } = await tx.query(
      `SELECT 1 FROM tiss.recurso_glosa_item ri
         JOIN tiss.recurso_glosa rg
           ON rg.tenant_id = ri.tenant_id AND rg.id = ri.recurso_id
        WHERE ri.glosa_id = $1
          AND rg.status IN ('rascunho', 'pronto', 'enviado')`,
      [b.glosaId]);
    if (jaEmRecurso !== null && jaEmRecurso > 0) {
      erroDominio('glosa_ja_em_recurso', 422);
    }

    const itemId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, p.id, b.glosaId, b.justificativaItem, b.valorRecursadoCents]);

    // Atualizar contadores no recurso
    const newCount = recRows[0]!.item_count + 1;
    const newTotal = Number(recRows[0]!.total_recursado_cents) + b.valorRecursadoCents;
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET item_count = $2, total_recursado_cents = $3
        WHERE id = $1`,
      [p.id, newCount, newTotal]);

    // Marcar a glosa como contestada
    await tx.query(
      `UPDATE tiss.glosa SET status = 'contestada'
        WHERE id = $1 AND status = 'pendente'`,
      [b.glosaId]);

    void reply.code(201);
    return { itemId };
  }));

  // ── DELETE /v1/tiss/recursos/:id/itens/:itemId — remover glosa ────────
  r.delete('/v1/tiss/recursos/:id/itens/:itemId', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        itemId: z.string().uuid(),
      }),
      response: { 200: z.object({ removido: z.boolean() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string; itemId: string };

    // Verificar que o recurso esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status::text, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Remover o item e pegar dados para atualizar contadores
    const { rows: removidos } = await tx.query<{
      glosa_id: string; valor_recursado_cents: string;
    }>(
      `DELETE FROM tiss.recurso_glosa_item
        WHERE id = $1 AND recurso_id = $2
        RETURNING glosa_id, valor_recursado_cents::text`,
      [p.itemId, p.id]);

    if (removidos.length > 0) {
      const valorRemovido = Number(removidos[0]!.valor_recursado_cents);
      const newCount = Math.max(recRows[0]!.item_count - 1, 0);
      const newTotal = Math.max(
        Number(recRows[0]!.total_recursado_cents) - valorRemovido, 0);
      await tx.query(
        `UPDATE tiss.recurso_glosa
            SET item_count = $2, total_recursado_cents = $3
          WHERE id = $1`,
        [p.id, newCount, newTotal]);

      // Reverter glosa para pendente
      await tx.query(
        `UPDATE tiss.glosa SET status = 'pendente'
          WHERE id = $1 AND status = 'contestada'`,
        [removidos[0]!.glosa_id]);
    }

    return { removido: removidos.length > 0 };
  }));

  // ── POST /v1/tiss/recursos/:id/pronto — marcar recurso como pronto ────
  r.post('/v1/tiss/recursos/:id/pronto', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('pronto'),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; item_count: number;
    }>(
      `SELECT status::text, item_count FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    await tx.query(
      `UPDATE tiss.recurso_glosa SET status = 'pronto'
        WHERE id = $1`,
      [p.id]);

    return { recursoId: p.id, status: 'pronto' as const };
  }));

  // ── GET /v1/tiss/recursos — listar recursos ──────────────────────────
  r.get('/v1/tiss/recursos', {
    schema: {
      querystring: z.object({
        status: z.enum(['rascunho', 'pronto', 'enviado',
          'indeterminado', 'deferido', 'indeferido', 'parcial']).optional(),
        operadoraId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(RecursoResumoSchema) }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const q = req.query as { status?: string; operadoraId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`rg.status = $${idx}::tiss.recurso_glosa_status`);
      params.push(q.status); idx += 1;
    }
    if (q.operadoraId !== undefined) {
      condicoes.push(`rg.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }

    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      encounter_version_id: string; numero_recurso: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.encounter_version_id, rg.numero_recurso,
              rg.status::text, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
         ${where}
        ORDER BY rg.created_at DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        recursoId: row.id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        encounterVersionId: row.encounter_version_id,
        numeroRecurso: row.numero_recurso,
        status: row.status,
        justificativaGeral: row.justificativa_geral,
        itemCount: row.item_count,
        totalRecursadoCents: Number(row.total_recursado_cents),
        createdAt: row.created_at,
        sentAt: row.sent_at,
      })),
    };
  }));

  // ── GET /v1/tiss/recursos/:id — detalhe do recurso com itens ──────────
  r.get('/v1/tiss/recursos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: RecursoResumoSchema.extend({
          itens: z.array(RecursoItemSchema),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      encounter_version_id: string; numero_recurso: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.encounter_version_id, rg.numero_recurso,
              rg.status::text, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
        WHERE rg.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    const rec = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; glosa_id: string;
      justificativa_item: string; valor_recursado_cents: string;
      resultado: string | null;
    }>(
      `SELECT id, glosa_id, justificativa_item,
              valor_recursado_cents::text, resultado
         FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1
        ORDER BY id`,
      [p.id]);

    return {
      recursoId: rec.id,
      operadoraId: rec.operadora_id,
      operadoraNome: rec.operadora_nome,
      encounterVersionId: rec.encounter_version_id,
      numeroRecurso: rec.numero_recurso,
      status: rec.status,
      justificativaGeral: rec.justificativa_geral,
      itemCount: rec.item_count,
      totalRecursadoCents: Number(rec.total_recursado_cents),
      createdAt: rec.created_at,
      sentAt: rec.sent_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        glosaId: i.glosa_id,
        justificativaItem: i.justificativa_item,
        valorRecursadoCents: Number(i.valor_recursado_cents),
        resultado: i.resultado,
      })),
    };
  }));

  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  r.post('/v1/tiss/recursos/:id/enviar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('enviado'),
        }),
      },
    },
  }, rota('tiss.recurso.send', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; operadora_id: string; item_count: number;
      total_recursado_cents: string;
    }>(
      `SELECT status, operadora_id, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'pronto') {
      erroDominio('recurso_nao_pronto', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    // Transicionar para enviado
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado', sent_at = clock_timestamp()
        WHERE id = $1`,
      [p.id]);

    // Enfileirar no outbox para serializacao XML + transport
    await tx.query(
      `SELECT app.enqueue_outbox('tiss_recurso_send', $1::uuid,
               jsonb_build_object(
                 'recursoId', $2::text,
                 'operadoraId', $3::text,
                 'itemCount', $4::int,
                 'clinicId', $5::text))`,
      [p.id, p.id, rows[0]!.operadora_id,
       rows[0]!.item_count, ctx.actor.clinicId]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_SEND', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('item_count', $2::int,
                                 'total_recursado_cents', $3::text), $4)`,
      [p.id, rows[0]!.item_count,
       rows[0]!.total_recursado_cents, ctx.actor.clinicId]);

    return { recursoId: p.id, status: 'enviado' as const };
  }));

  // ── POST /v1/tiss/recursos/:id/resolver — resolver com resultado ──────
  r.post('/v1/tiss/recursos/:id/resolver', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        resultados: z.array(z.object({
          itemId: z.string().uuid(),
          resultado: z.enum(['deferido', 'indeferido', 'deferido_parcial']),
        })).min(1),
      }),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.enum(['deferido', 'indeferido', 'parcial']),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as {
      resultados: Array<{
        itemId: string;
        resultado: 'deferido' | 'indeferido' | 'deferido_parcial';
      }>;
    };

    // Verificar que o recurso existe e esta enviado
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'enviado') {
      erroDominio('recurso_nao_enviado', 422);
    }

    // Atualizar cada item com o resultado
    for (const res of b.resultados) {
      const { rowCount } = await tx.query(
        `UPDATE tiss.recurso_glosa_item
            SET resultado = $2
          WHERE id = $1 AND recurso_id = $3`,
        [res.itemId, res.resultado, p.id]);
      if (rowCount === 0) {
        erroDominio('item_recurso_nao_encontrado', 404,
          { itemId: res.itemId });
      }

      // Se deferido (total ou parcial), marcar a glosa como revertida
      if (res.resultado === 'deferido' || res.resultado === 'deferido_parcial') {
        await tx.query(
          `UPDATE tiss.glosa
              SET status = 'revertida',
                  resolved_at = clock_timestamp(),
                  resolved_by = app.current_user_id()
            WHERE id = (
              SELECT glosa_id
                FROM tiss.recurso_glosa_item
               WHERE id = $1)
              AND status = 'contestada'`,
          [res.itemId]);
      }
    }

    // Computar status final do recurso
    const hasDeferido = b.resultados.some(
      (r) => r.resultado === 'deferido' || r.resultado === 'deferido_parcial');
    const hasIndeferido = b.resultados.some(
      (r) => r.resultado === 'indeferido');
    let finalStatus: 'deferido' | 'indeferido' | 'parcial';
    if (hasDeferido && hasIndeferido) {
      finalStatus = 'parcial';
    } else if (hasDeferido) {
      finalStatus = 'deferido';
    } else {
      finalStatus = 'indeferido';
    }

    // Marcar recurso com status final
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = $2::tiss.recurso_glosa_status,
              resolved_at = clock_timestamp()
        WHERE id = $1`,
      [p.id, finalStatus]);

    // Auditoria
    const deferidos = b.resultados.filter(
      (r) => r.resultado === 'deferido' || r.resultado === 'deferido_parcial');
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_RESOLVE', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('total_resultados', $2::int,
                                 'deferidos', $3::int), $4)`,
      [p.id, b.resultados.length, deferidos.length, ctx.actor.clinicId]);

    return { recursoId: p.id, status: finalStatus };
  }));
}
