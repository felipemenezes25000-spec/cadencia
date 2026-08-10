// apps/api/src/routes/tiss/lotes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { gerarXmlDoLote } from '@cadencia/tiss';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const LoteResumoSchema = z.object({
  loteId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  numeroLote: z.string(),
  status: z.string(),
  totalGuias: z.number().int(),
  valorTotalCentavos: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});

export async function loteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/lotes — criar lote vazio ────────────────────────────
  r.post('/v1/tiss/lotes', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
      }),
      response: { 201: z.object({ loteId: z.string().uuid() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as { operadoraId: string };
    const id = uuidv7();

    // Verificar que a operadora existe e esta ativa; pegar tiss_version
    const { rows: opRows } = await tx.query<{ tiss_version: string }>(
      `SELECT tiss_version FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opRows.length === 0) erroDominio('operadora_nao_encontrada', 404);

    // Alocar numero sequencial do lote (auto-provisionante por operadora)
    const { rows: numRows } = await tx.query<{ n: string }>(
      `SELECT tiss.next_lote_number(app.require_tenant_id(), $1) AS n`,
      [b.operadoraId]);
    const numeroLote = String(numRows[0]!.n);

    await tx.query(
      `INSERT INTO tiss.lote
         (id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, created_by)
       VALUES ($1, $2, $3, 'rascunho', $4, 0, 0, app.current_user_id())`,
      [id, b.operadoraId, numeroLote, opRows[0]!.tiss_version]);

    void reply.code(201);
    return { loteId: id };
  }));

  // ── POST /v1/tiss/lotes/:id/guias — adicionar guias ao lote ──────────
  r.post('/v1/tiss/lotes/:id/guias', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        guiaIds: z.array(z.string().uuid()).min(1).max(100),
      }),
      response: { 200: z.object({ adicionadas: z.number().int() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { guiaIds: string[] };

    // Verificar que o lote existe e esta em rascunho
    const { rows: loteRows } = await tx.query<{
      status: string; operadora_id: string; guia_count: number; total_value_cents: string;
    }>(
      `SELECT status::text, operadora_id, guia_count, total_value_cents
         FROM tiss.lote WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'rascunho') erroDominio('lote_nao_rascunho', 422);

    // Guarda simetrica a de `/guias-sadt`: `guiasTISS` e um `choice` na norma,
    // e a operadora recusa o lote inteiro se vier consulta junto com SADT.
    const { rowCount: temSadt } = await tx.query(
      `SELECT 1 FROM tiss.lote_guia_sadt WHERE lote_id = $1 LIMIT 1`, [p.id]);
    if (temSadt !== null && temSadt > 0) {
      erroDominio('lote_ja_tem_guia_sadt', 422);
    }

    const lote = loteRows[0]!;
    let adicionadas = 0;
    let guiaCount = lote.guia_count;
    let totalCents = Number(lote.total_value_cents);

    for (const guiaId of b.guiaIds) {
      // Verificar que a guia existe, esta ativa e e da mesma operadora
      const { rows: guiaRows } = await tx.query<{
        operadora_id: string; valor_procedimento: string;
      }>(
        `SELECT operadora_id, valor_procedimento
           FROM tiss.encounter_guia_consulta
          WHERE id = $1 AND live = true`,
        [guiaId]);
      if (guiaRows.length === 0) continue;
      if (guiaRows[0]!.operadora_id !== lote.operadora_id) continue;

      // Verificar se guia ja esta em algum lote
      const { rowCount: jaVinculada } = await tx.query(
        `SELECT 1 FROM tiss.lote_guia WHERE guia_id = $1`, [guiaId]);
      if (jaVinculada !== null && jaVinculada > 0) continue;

      // Calcular proximo sequencial_item
      const { rows: seqRows } = await tx.query<{ max_seq: number | null }>(
        `SELECT MAX(sequencial_item) AS max_seq
           FROM tiss.lote_guia WHERE lote_id = $1`, [p.id]);
      const nextSeq = (seqRows[0]?.max_seq ?? 0) + 1;

      // Inserir vinculo na tabela de juncao
      await tx.query(
        `INSERT INTO tiss.lote_guia (lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3)`,
        [p.id, guiaId, nextSeq]);

      const valorCents = Math.round(Number(guiaRows[0]!.valor_procedimento) * 100);
      guiaCount += 1;
      totalCents += valorCents;
      adicionadas += 1;
    }

    // Atualizar contadores no lote
    if (adicionadas > 0) {
      await tx.query(
        `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
        [p.id, guiaCount, totalCents]);
    }

    return { adicionadas };
  }));

  /**
   * Anexa guias SP/SADT ao lote.
   *
   * Rota separada, e nao um campo `tipo` na de cima, porque as tabelas de
   * vinculo sao duas: `tiss.lote_guia` tem FK para a guia de consulta e
   * `tiss.lote_guia_sadt` para a de SADT. Isso torna o lote MISTO impossivel de
   * montar — que e o que a norma exige, ja que `guiasTISS` e um `choice` e a
   * operadora recusa o lote inteiro se vier consulta junto com SADT.
   */
  r.post('/v1/tiss/lotes/:id/guias-sadt', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ guiaIds: z.array(z.string().uuid()).min(1).max(100) }),
      response: { 200: z.object({ adicionadas: z.number().int() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { guiaIds: string[] };

    const { rows: loteRows } = await tx.query<{
      status: string; operadora_id: string; guia_count: number;
      total_value_cents: string;
    }>(
      `SELECT status::text, operadora_id, guia_count, total_value_cents
         FROM tiss.lote WHERE id = $1 FOR UPDATE`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    const lote = loteRows[0]!;
    if (lote.status !== 'rascunho') erroDominio('lote_nao_rascunho', 422);

    // Um lote que ja tem guia de consulta nao pode receber SADT. As FKs
    // impedem a linha errada, mas nao a MISTURA — que so as duas tabelas
    // juntas revelam.
    const { rowCount: temConsulta } = await tx.query(
      `SELECT 1 FROM tiss.lote_guia WHERE lote_id = $1 LIMIT 1`, [p.id]);
    if (temConsulta !== null && temConsulta > 0) {
      erroDominio('lote_ja_tem_guia_de_consulta', 422);
    }

    let adicionadas = 0;
    let guiaCount = lote.guia_count;
    let totalCents = Number(lote.total_value_cents);

    for (const guiaId of b.guiaIds) {
      const { rows: guiaRows } = await tx.query<{ operadora_id: string }>(
        `SELECT operadora_id FROM tiss.encounter_guia_sadt
          WHERE id = $1 AND live = true`, [guiaId]);
      if (guiaRows.length === 0) continue;
      if (guiaRows[0]!.operadora_id !== lote.operadora_id) continue;

      const { rowCount: jaVinculada } = await tx.query(
        `SELECT 1 FROM tiss.lote_guia_sadt WHERE guia_id = $1`, [guiaId]);
      if (jaVinculada !== null && jaVinculada > 0) continue;

      const { rows: seqRows } = await tx.query<{ max_seq: number | null }>(
        `SELECT MAX(sequencial_item) AS max_seq
           FROM tiss.lote_guia_sadt WHERE lote_id = $1`, [p.id]);
      await tx.query(
        `INSERT INTO tiss.lote_guia_sadt (lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3)`,
        [p.id, guiaId, (seqRows[0]?.max_seq ?? 0) + 1]);

      // O valor da guia SADT e a SOMA dos itens, calculada no banco. Nao ha
      // coluna de total na guia justamente para nao poder divergir dos itens.
      const { rows: valorRows } = await tx.query<{ total: string }>(
        `SELECT coalesce(sum(
                  round(valor_unitario * quantidade_executada * reducao_acrescimo, 2)
                ), 0)::text AS total
           FROM tiss.encounter_guia_sadt_item WHERE guia_id = $1`, [guiaId]);

      guiaCount += 1;
      totalCents += Math.round(Number(valorRows[0]?.total ?? '0') * 100);
      adicionadas += 1;
    }

    if (adicionadas > 0) {
      await tx.query(
        `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
        [p.id, guiaCount, totalCents]);
    }
    return { adicionadas };
  }));

  // ── DELETE /v1/tiss/lotes/:id/guias/:guiaId — remover guia do lote ────
  r.delete('/v1/tiss/lotes/:id/guias/:guiaId', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        guiaId: z.string().uuid(),
      }),
      response: { 200: z.object({ removida: z.boolean() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string; guiaId: string };

    // Verificar que o lote esta em rascunho
    const { rows: loteRows } = await tx.query<{
      status: string; guia_count: number; total_value_cents: string;
    }>(
      `SELECT status::text, guia_count, total_value_cents
         FROM tiss.lote WHERE id = $1 FOR UPDATE`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'rascunho') erroDominio('lote_nao_rascunho', 422);

    // Remover vinculo e recuperar valor da guia para atualizar contadores
    const { rows: removidas } = await tx.query<{ valor_procedimento: string }>(
      `DELETE FROM tiss.lote_guia lg
        USING tiss.encounter_guia_consulta g
        WHERE lg.lote_id = $1 AND lg.guia_id = $2
          AND g.id = lg.guia_id AND g.tenant_id = lg.tenant_id
        RETURNING g.valor_procedimento`,
      [p.id, p.guiaId]);

    if (removidas.length > 0) {
      const valorCents = Math.round(Number(removidas[0]!.valor_procedimento) * 100);
      const newCount = Math.max(loteRows[0]!.guia_count - 1, 0);
      const newTotal = Math.max(Number(loteRows[0]!.total_value_cents) - valorCents, 0);
      await tx.query(
        `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
        [p.id, newCount, newTotal]);
    }

    return { removida: removidas.length > 0 };
  }));

  // ── GET /v1/tiss/lotes — listar lotes ─────────────────────────────────
  r.get('/v1/tiss/lotes', {
    schema: {
      querystring: z.object({
        status: z.enum(['rascunho', 'pronto', 'enviado', 'retornado', 'cancelado']).optional(),
        operadoraId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(LoteResumoSchema) }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const q = req.query as { status?: string; operadoraId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`l.status = $${idx}::tiss.lote_status`);
      params.push(q.status); idx += 1;
    }
    if (q.operadoraId !== undefined) {
      condicoes.push(`l.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      numero_lote: string; status: string;
      guia_count: string; total_value_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT l.id, l.operadora_id, o.razao_social AS operadora_nome,
              l.numero_lote, l.status::text,
              l.guia_count::text, l.total_value_cents::text,
              to_char(l.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(l.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.lote l
         JOIN tiss.operadora o
           ON o.tenant_id = l.tenant_id AND o.id = l.operadora_id
         ${where}
        ORDER BY l.created_at DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        loteId: row.id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        numeroLote: row.numero_lote,
        status: row.status,
        totalGuias: Number(row.guia_count),
        valorTotalCentavos: Number(row.total_value_cents),
        createdAt: row.created_at,
        sentAt: row.sent_at,
      })),
    };
  }));

  // ── GET /v1/tiss/lotes/:id — detalhe do lote ─────────────────────────
  r.get('/v1/tiss/lotes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: LoteResumoSchema.extend({
          guias: z.array(z.object({
            guiaId: z.string().uuid(),
            numeroGuiaPrestador: z.string(),
            dataAtendimento: z.string(),
            codigoProcedimento: z.string(),
            valorProcedimento: z.number(),
          })),
        }),
      },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      numero_lote: string; status: string;
      guia_count: string; total_value_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT l.id, l.operadora_id, o.razao_social AS operadora_nome,
              l.numero_lote, l.status::text,
              l.guia_count::text, l.total_value_cents::text,
              to_char(l.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(l.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.lote l
         JOIN tiss.operadora o
           ON o.tenant_id = l.tenant_id AND o.id = l.operadora_id
        WHERE l.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('lote_nao_encontrado', 404);
    const lote = rows[0]!;

    const { rows: guiaRows } = await tx.query<{
      id: string; numero_guia_prestador: string;
      data_atendimento: string; codigo_procedimento: string;
      valor_procedimento: string;
    }>(
      `SELECT g.id, g.numero_guia_prestador, g.data_atendimento::text,
              g.codigo_procedimento, g.valor_procedimento::text
         FROM tiss.lote_guia lg
         JOIN tiss.encounter_guia_consulta g
           ON g.tenant_id = lg.tenant_id AND g.id = lg.guia_id
        WHERE lg.lote_id = $1
        ORDER BY lg.sequencial_item`,
      [p.id]);

    return {
      loteId: lote.id,
      operadoraId: lote.operadora_id,
      operadoraNome: lote.operadora_nome,
      numeroLote: lote.numero_lote,
      status: lote.status,
      totalGuias: Number(lote.guia_count),
      valorTotalCentavos: Number(lote.total_value_cents),
      createdAt: lote.created_at,
      sentAt: lote.sent_at,
      guias: guiaRows.map((g) => ({
        guiaId: g.id,
        numeroGuiaPrestador: g.numero_guia_prestador,
        dataAtendimento: g.data_atendimento,
        codigoProcedimento: g.codigo_procedimento,
        valorProcedimento: Number(g.valor_procedimento),
      })),
    };
  }));

  // ── POST /v1/tiss/lotes/:id/enviar — disparar envio do lote ──────────
  r.post('/v1/tiss/lotes/:id/enviar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          loteId: z.string().uuid(),
          status: z.literal('pronto'),
        }),
      },
    },
  }, rota('tiss.lote.send', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    // Verificar que o lote esta em rascunho e tem guias
    const { rows: loteRows } = await tx.query<{
      status: string; operadora_id: string; numero_lote: string; guia_count: number;
    }>(
      `SELECT status::text, operadora_id, numero_lote, guia_count
         FROM tiss.lote WHERE id = $1 FOR UPDATE`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'rascunho') erroDominio('lote_nao_rascunho', 422);
    if (loteRows[0]!.guia_count === 0) erroDominio('lote_sem_guias', 422);

    // Transicionar para pronto (envio efetivo e assincrono via worker)
    await tx.query(
      `UPDATE tiss.lote SET status = 'pronto' WHERE id = $1`, [p.id]);

    // Enfileirar no outbox para serializacao XML + transport
    await tx.query(
      `SELECT app.enqueue_outbox('tiss_lote_send', $1::uuid,
               jsonb_build_object(
                 'loteId', $2::text,
                 'operadoraId', $3::text,
                 'numeroLote', $4::text,
                 'clinicId', $5::text))`,
      [p.id, p.id, loteRows[0]!.operadora_id,
       loteRows[0]!.numero_lote, ctx.actor.clinicId]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('TISS_LOTE_SEND', 'tiss', 'lote', $1, 'sucesso',
              jsonb_build_object('numero_lote', $2::text,
                                 'guia_count', $3::int), $4)`,
      [p.id, loteRows[0]!.numero_lote, loteRows[0]!.guia_count, ctx.actor.clinicId]);

    return { loteId: p.id, status: 'pronto' as const };
  }));

  // ── POST /v1/tiss/lotes/:id/cancelar — cancelar lote ─────────────────
  r.post('/v1/tiss/lotes/:id/cancelar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          loteId: z.string().uuid(),
          status: z.literal('cancelado'),
        }),
      },
    },
  }, rota('tiss.lote.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows: loteRows } = await tx.query<{ status: string }>(
      `SELECT status::text FROM tiss.lote WHERE id = $1 FOR UPDATE`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    const prevStatus = loteRows[0]!.status;
    if (prevStatus === 'enviado' || prevStatus === 'retornado') {
      erroDominio('lote_ja_enviado', 422);
    }
    if (prevStatus === 'cancelado') erroDominio('lote_ja_cancelado', 422);

    // Liberar guias do lote — as DUAS tabelas de juncao.
    //
    // `tiss.lote_guia_sadt` (migration 0152) nasceu depois desta rota e ficou de
    // fora do cancelamento. O efeito: a guia SP/SADT continuava vinculada a um
    // lote cancelado para sempre. Como a montagem de lote so aceita guia sem
    // vinculo, aquela guia nao entrava em nenhum lote novo — ficava invisivel
    // para o faturamento, sem erro em lugar nenhum, e o servico prestado nunca
    // era cobrado da operadora.
    await tx.query(
      `DELETE FROM tiss.lote_guia WHERE lote_id = $1`, [p.id]);
    await tx.query(
      `DELETE FROM tiss.lote_guia_sadt WHERE lote_id = $1`, [p.id]);

    // Marcar como cancelado e zerar contadores
    await tx.query(
      `UPDATE tiss.lote SET status = 'cancelado', guia_count = 0, total_value_cents = 0
        WHERE id = $1`, [p.id]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('TISS_LOTE_CANCEL', 'tiss', 'lote', $1, 'sucesso',
              jsonb_build_object('status', $2::text), $3)`,
      [p.id, prevStatus, ctx.actor.clinicId]);

    return { loteId: p.id, status: 'cancelado' as const };
  }));

  // ── GET /v1/tiss/lotes/:id/xml — baixar XML do lote ───────────────────
  r.get('/v1/tiss/lotes/:id/xml', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{ numero_lote: string }>(
      `SELECT numero_lote FROM tiss.lote WHERE id = $1`, [p.id]);
    if (rows.length === 0) erroDominio('lote_nao_encontrado', 404);

    // Serializado sob demanda a partir das guias, e nao lido de um arquivo
    // guardado: enquanto o lote nao foi enviado, as guias ainda podem mudar, e
    // um XML congelado antes disso descreveria um lote que nao existe mais.
    // Depois do envio, `xml_hash_md5` prova que o conteudo nao mudou.
    const { xml, warnings, quantidadeDeGuias } = await gerarXmlDoLote(tx, p.id)
      .catch((e: unknown) => {
        const dominio = (e as { dominio?: string }).dominio;
        if (dominio === 'lote_sem_guias') erroDominio('lote_sem_guias', 422);
        if (dominio === 'uf_desconhecida') erroDominio('uf_do_conselho_invalida', 422);
        throw e;
      });

    // Caractere fora do ISO-8859-1 vira '?' no arquivo. Avisar no cabecalho
    // deixa rastro sem barrar o download — quem confere o lote antes de enviar
    // precisa VER o arquivo para decidir se o nome truncado importa.
    if (warnings.length > 0) {
      void reply.header('x-cadencia-avisos', String(warnings.length));
      req.log.warn({ loteId: p.id, warnings }, 'lote_com_caractere_fora_do_iso8859');
    }

    void reply.header('content-type', 'application/xml; charset=ISO-8859-1');
    void reply.header('content-disposition',
      `attachment; filename="lote-${rows[0]!.numero_lote}.xml"`);
    void reply.header('cache-control', 'no-store');
    void reply.header('x-cadencia-guias', String(quantidadeDeGuias));
    return Buffer.from(xml);
  }));
}
