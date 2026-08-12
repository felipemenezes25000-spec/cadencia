// apps/api/src/routes/tiss/guias.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const GuiaResumoSchema = z.object({
  guiaId: z.string().uuid(),
  encounterId: z.string().uuid(),
  // O ID, e não só o nome: quem monta lote precisa dele. Sem isto a tela "A
  // faturar" tinha o nome da operadora para exibir e nada para ENVIAR, e
  // acabava mandando `operadoraId: null` na criação do lote.
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  registroAns: z.string(),
  numeroGuiaPrestador: z.string(),
  numeroCarteira: z.string(),
  pacienteNome: z.string(),
  dataAtendimento: z.string(),
  codigoProcedimento: z.string(),
  // O nome do procedimento vem da TUSS VIGENTE NA DATA DO ATENDIMENTO, nunca da
  // vigente hoje (§3.9 e decisão irreversível 11). A ANS altera descrição entre
  // competências, e uma guia de março reapresentada em julho com o texto de
  // julho é exatamente o lote que volta glosado meses depois.
  nomeProcedimento: z.string(),
  valorProcedimento: z.number(),
  loteId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const GuiaDetalheSchema = GuiaResumoSchema.extend({
  encounterVersionId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  atendimentoRn: z.boolean(),
  cnes: z.string(),
  conselhoProfissional: z.string(),
  numeroConselho: z.string(),
  ufConselho: z.string(),
  cbos: z.string(),
  indicacaoAcidente: z.string(),
  regimeAtendimento: z.string(),
  tipoConsulta: z.string(),
  codigoTabela: z.string(),
  observacao: z.string().nullable(),
  ajustes: z.array(z.object({
    ajusteId: z.string().uuid(),
    campoAlterado: z.string(),
    valorAnterior: z.string(),
    valorNovo: z.string(),
    motivo: z.string(),
    createdBy: z.string().uuid(),
    createdAt: z.string(),
  })),
});

export async function guiaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/tiss/guias — listar guias ─────────────────────────────────
  r.get('/v1/tiss/guias', {
    schema: {
      querystring: z.object({
        status: z.enum(['pendente', 'em_lote', 'enviada', 'todas']).optional(),
        operadoraId: z.string().uuid().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(GuiaResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const q = req.query as {
      status?: string; operadoraId?: string;
      from?: string; to?: string;
      limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = ['g.live = true'];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status === 'pendente') {
      condicoes.push('lg.lote_id IS NULL');
    } else if (q.status === 'em_lote') {
      condicoes.push('lg.lote_id IS NOT NULL');
      condicoes.push(`l.status IN ('rascunho', 'pronto')`);
    } else if (q.status === 'enviada') {
      condicoes.push('lg.lote_id IS NOT NULL');
      condicoes.push(`l.status = 'enviado'`);
    }

    if (q.operadoraId !== undefined) {
      condicoes.push(`g.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.from !== undefined) {
      condicoes.push(`g.data_atendimento >= $${idx}::date`);
      params.push(q.from); idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`g.data_atendimento <= $${idx}::date`);
      params.push(q.to); idx += 1;
    }
    if (q.cursor !== undefined) {
      /**
       * O cursor tem de usar a MESMA chave da ordenação.
       *
       * A lista ordena por `(data_atendimento DESC, created_at DESC)` e o cursor
       * filtrava só `created_at <`. Como `data_atendimento` é a chave primária
       * da ordem, as duas não coincidem: uma guia lançada hoje para um
       * atendimento de semana passada tem `created_at` alto e
       * `data_atendimento` baixo. Ela aparece tarde na ordem mas é cortada cedo
       * pelo filtro — some da paginação inteira. E guia que some da tela "A
       * faturar" é guia que ninguém fatura.
       *
       * Comparação de TUPLA resolve com a semântica exata da ordem. O cursor
       * carrega os dois campos separados por '|'.
       */
      const [dataCursor, criadoCursor] = q.cursor.split('|');
      if (dataCursor === undefined || criadoCursor === undefined) {
        erroDominio('cursor_invalido', 400);
      }
      condicoes.push(
        `(g.data_atendimento, g.created_at) < ($${idx}::date, $${idx + 1}::timestamptz)`);
      params.push(dataCursor, criadoCursor); idx += 2;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; encounter_id: string; operadora_id: string; operadora_nome: string;
      registro_ans: string; numero_guia_prestador: string;
      numero_carteira: string; data_atendimento: string;
      paciente_nome: string | null; nome_procedimento: string | null;
      codigo_procedimento: string; valor_procedimento: string;
      lote_id: string | null; created_at: string;
    }>(
      `SELECT g.id, g.encounter_id, g.operadora_id, o.razao_social AS operadora_nome,
              g.registro_ans, g.numero_guia_prestador, g.numero_carteira,
              g.data_atendimento::text,
              p.display_name AS paciente_nome,
              t.termo AS nome_procedimento,
              g.codigo_procedimento, g.valor_procedimento::text,
              lg.lote_id,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.encounter_guia_consulta g
         JOIN tiss.operadora o
           ON o.tenant_id = g.tenant_id AND o.id = g.operadora_id
         LEFT JOIN clin.encounter e
           ON (e.tenant_id, e.id) = (g.tenant_id, g.encounter_id)
         LEFT JOIN clin.patient p
           ON (p.tenant_id, p.id) = (e.tenant_id, e.patient_id)
         -- vigencia @> data_atendimento: o termo do DIA DO EVENTO.
         LEFT JOIN ref.tuss_term t
           ON t.tabela = g.codigo_tabela::smallint
          AND t.codigo = g.codigo_procedimento
          AND t.vigencia @> g.data_atendimento
         LEFT JOIN tiss.lote_guia lg
           ON lg.tenant_id = g.tenant_id AND lg.guia_id = g.id
         LEFT JOIN tiss.lote l
           ON l.tenant_id = lg.tenant_id AND l.id = lg.lote_id
        WHERE ${where}
        ORDER BY g.data_atendimento DESC, g.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      guiaId: row.id,
      encounterId: row.encounter_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      registroAns: row.registro_ans,
      numeroGuiaPrestador: row.numero_guia_prestador,
      numeroCarteira: row.numero_carteira,
      pacienteNome: row.paciente_nome ?? 'Paciente nao localizado',
      nomeProcedimento: row.nome_procedimento ?? row.codigo_procedimento,
      dataAtendimento: row.data_atendimento,
      codigoProcedimento: row.codigo_procedimento,
      valorProcedimento: Number(row.valor_procedimento),
      loteId: row.lote_id,
      createdAt: row.created_at,
    }));

    const ultimo = itens[itens.length - 1];
    const nextCursor = hasMore && ultimo !== undefined
      ? `${ultimo.dataAtendimento}|${ultimo.createdAt}`
      : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/guias/:id — detalhe da guia ─────────────────────────
  r.get('/v1/tiss/guias/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: GuiaDetalheSchema },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; encounter_id: string; encounter_version_id: string;
      operadora_id: string; operadora_nome: string;
      registro_ans: string; numero_guia_prestador: string;
      numero_carteira: string; atendimento_rn: boolean;
      cnes: string; conselho_profissional: string;
      numero_conselho: string; uf_conselho: string; cbos: string;
      indicacao_acidente: string; regime_atendimento: string;
      data_atendimento: string; tipo_consulta: string;
      codigo_tabela: string; codigo_procedimento: string;
      valor_procedimento: string; observacao: string | null;
      paciente_nome: string | null; nome_procedimento: string | null;
      lote_id: string | null; created_at: string;
    }>(
      `SELECT g.id, g.encounter_id, g.encounter_version_id,
              g.operadora_id, o.razao_social AS operadora_nome,
              g.registro_ans, g.numero_guia_prestador, g.numero_carteira,
              g.atendimento_rn, g.cnes,
              g.conselho_profissional, g.numero_conselho, g.uf_conselho, g.cbos,
              g.indicacao_acidente, g.regime_atendimento,
              g.data_atendimento::text, g.tipo_consulta,
              g.codigo_tabela, g.codigo_procedimento,
              g.valor_procedimento::text, g.observacao,
              p2.display_name AS paciente_nome,
              t.termo AS nome_procedimento,
              lg.lote_id,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.encounter_guia_consulta g
         LEFT JOIN clin.encounter e2
           ON (e2.tenant_id, e2.id) = (g.tenant_id, g.encounter_id)
         LEFT JOIN clin.patient p2
           ON (p2.tenant_id, p2.id) = (e2.tenant_id, e2.patient_id)
         LEFT JOIN ref.tuss_term t
           ON t.tabela = g.codigo_tabela::smallint
          AND t.codigo = g.codigo_procedimento
          AND t.vigencia @> g.data_atendimento
         JOIN tiss.operadora o
           ON o.tenant_id = g.tenant_id AND o.id = g.operadora_id
         LEFT JOIN tiss.lote_guia lg
           ON lg.tenant_id = g.tenant_id AND lg.guia_id = g.id
        WHERE g.id = $1 AND g.live = true`,
      [p.id]);

    if (rows.length === 0) erroDominio('guia_nao_encontrada', 404);
    const row = rows[0]!;

    // Buscar ajustes
    const { rows: ajusteRows } = await tx.query<{
      id: string; campo_alterado: string; valor_anterior: string;
      valor_novo: string; motivo: string;
      created_by: string; created_at: string;
    }>(
      `SELECT id, campo_alterado, valor_anterior, valor_novo,
              motivo, created_by::text,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.guia_ajuste
        WHERE guia_id = $1
        ORDER BY created_at DESC`,
      [p.id]);

    return {
      guiaId: row.id,
      encounterId: row.encounter_id,
      encounterVersionId: row.encounter_version_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      registroAns: row.registro_ans,
      numeroGuiaPrestador: row.numero_guia_prestador,
      numeroCarteira: row.numero_carteira,
      pacienteNome: row.paciente_nome ?? 'Paciente nao localizado',
      nomeProcedimento: row.nome_procedimento ?? row.codigo_procedimento,
      atendimentoRn: row.atendimento_rn,
      cnes: row.cnes,
      conselhoProfissional: row.conselho_profissional,
      numeroConselho: row.numero_conselho,
      ufConselho: row.uf_conselho,
      cbos: row.cbos,
      indicacaoAcidente: row.indicacao_acidente,
      regimeAtendimento: row.regime_atendimento,
      dataAtendimento: row.data_atendimento,
      tipoConsulta: row.tipo_consulta,
      codigoTabela: row.codigo_tabela,
      codigoProcedimento: row.codigo_procedimento,
      valorProcedimento: Number(row.valor_procedimento),
      observacao: row.observacao,
      loteId: row.lote_id,
      createdAt: row.created_at,
      ajustes: ajusteRows.map((a) => ({
        ajusteId: a.id,
        campoAlterado: a.campo_alterado,
        valorAnterior: a.valor_anterior,
        valorNovo: a.valor_novo,
        motivo: a.motivo,
        createdBy: a.created_by,
        createdAt: a.created_at,
      })),
    };
  }));

  // ── POST /v1/tiss/guias/:id/ajuste — criar ajuste de faturamento ──────
  r.post('/v1/tiss/guias/:id/ajuste', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        campoAlterado: z.string().min(1).max(100),
        valorAnterior: z.string().max(500),
        valorNovo: z.string().min(1).max(500),
        motivo: z.string().min(1).max(500),
      }),
      response: { 201: z.object({ ajusteId: z.string().uuid() }) },
    },
  }, rota('tiss.guia.adjust', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      campoAlterado: string; valorAnterior: string;
      valorNovo: string; motivo: string };

    // Verificar que a guia existe e está ativa
    const { rowCount } = await tx.query(
      `SELECT 1 FROM tiss.encounter_guia_consulta
        WHERE id = $1 AND live = true`,
      [p.id]);
    if (rowCount === 0) erroDominio('guia_nao_encontrada', 404);

    const ajusteId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.guia_ajuste
         (id, guia_id, campo_alterado, valor_anterior, valor_novo, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
      [ajusteId, p.id, b.campoAlterado, b.valorAnterior,
       b.valorNovo, b.motivo]);

    void reply.code(201);
    return { ajusteId };
  }));
}
