// apps/api/src/routes/tiss/demonstrativos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// ---------------------------------------------------------------------------
// Parser minimo de demonstrativo TISS XML
// ---------------------------------------------------------------------------

interface DemoParsedItem {
  numeroGuiaPrestador: string;
  valorApresentadoCents: number;
  valorProcessadoCents: number;
  valorLiberadoCents: number;
  valorGlosaCents: number;
  glosaCodigo: string | null;
  glosaDescricao: string | null;
}

interface DemoParsed {
  protocolo: string;
  kind: 'analise' | 'pagamento';
  itens: DemoParsedItem[];
}

function tagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:ans:)?${tag}>([^<]*)<\\/(?:ans:)?${tag}>`);
  const m = xml.match(re);
  return m ? m[1]! : null;
}

function realToCents(val: string | null): number {
  if (val === null || val === '') return 0;
  return Math.round(Number(val.replace(',', '.')) * 100);
}

function parseDemonstrativoXml(xmlBytes: Buffer): DemoParsed {
  const xml = new TextDecoder('iso-8859-1').decode(xmlBytes);

  const protocolo = tagValue(xml, 'numeroDemonstrativo') ?? '';
  if (protocolo === '') erroDominio('xml_protocolo_ausente', 422);

  const kind: 'analise' | 'pagamento' =
    xml.includes('demonstrativoAnalise') ? 'analise' : 'pagamento';

  // Extrair blocos de guia
  const guiaRegex = /<(?:ans:)?guia>([\s\S]*?)<\/(?:ans:)?guia>/g;
  const itens: DemoParsedItem[] = [];

  let guiaMatch: RegExpExecArray | null;
  while ((guiaMatch = guiaRegex.exec(xml)) !== null) {
    const guiaBlock = guiaMatch[1]!;
    const nrGuia = tagValue(guiaBlock, 'numeroGuiaPrestador') ?? '';

    // Extrair procedimentos dentro da guia
    const procRegex =
      /<(?:ans:)?procedimento>([\s\S]*?)<\/(?:ans:)?procedimento>/g;
    let procMatch: RegExpExecArray | null;
    while ((procMatch = procRegex.exec(guiaBlock)) !== null) {
      const pb = procMatch[1]!;
      const valorApresentado = realToCents(tagValue(pb, 'valorInformado'));
      const valorProcessado = realToCents(tagValue(pb, 'valorProcessado'));
      const valorGlosa = realToCents(tagValue(pb, 'valorGlosa'));
      const valorLiberado = realToCents(tagValue(pb, 'valorLiberado'))
        || Math.max(0, valorProcessado - valorGlosa);

      const glosaCodigo = tagValue(pb, 'codigoGlosa');

      itens.push({
        numeroGuiaPrestador: nrGuia,
        valorApresentadoCents: valorApresentado,
        valorProcessadoCents: valorProcessado,
        valorLiberadoCents: valorLiberado,
        valorGlosaCents: valorGlosa,
        glosaCodigo,
        // glosa_codigo e glosa_descricao devem viver ou morrer juntos (CHECK constraint)
        glosaDescricao: glosaCodigo !== null
          ? (tagValue(pb, 'descricaoGlosa') ?? `Glosa ${glosaCodigo}`)
          : null,
      });
    }
  }

  return { protocolo, kind, itens };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DemoResumoSchema = z.object({
  demonstrativoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  kind: z.enum(['analise', 'pagamento']),
  dataProcessamento: z.string(),
  totalApresentadoCents: z.number().int(),
  totalProcessadoCents: z.number().int(),
  totalLiberadoCents: z.number().int(),
  totalGlosaCents: z.number().int(),
  itemCount: z.number().int(),
  importedAt: z.string(),
});

const DemoItemSchema = z.object({
  itemId: z.string().uuid(),
  numeroGuiaPrestador: z.string(),
  valorApresentadoCents: z.number().int(),
  valorProcessadoCents: z.number().int(),
  valorLiberadoCents: z.number().int(),
  valorGlosaCents: z.number().int(),
  glosaCodigo: z.string().nullable(),
  glosaDescricao: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function demonstrativoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  // -- POST /v1/tiss/demonstrativos/importar -- multipart upload -----------
  r.post('/v1/tiss/demonstrativos/importar', {
    schema: {
      response: {
        201: z.object({
          demonstrativoId: z.string().uuid(),
          itemCount: z.number().int(),
        }),
      },
    },
  }, async (req, reply) => {
    // Extrair campos do multipart antes do guard
    let xmlBuffer: Buffer | undefined;
    let operadoraIdField: string | undefined;
    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'xml') {
        xmlBuffer = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'operadoraId') {
        operadoraIdField = String(part.value);
      }
    }

    // Validacao basica de campos (antes do RBAC, pois sao pre-condicoes)
    if (xmlBuffer === undefined || xmlBuffer.length === 0) {
      erroDominio('xml_ausente', 400);
    }
    if (operadoraIdField === undefined || operadoraIdField === '') {
      erroDominio('operadora_id_ausente', 400);
    }

    const capturedXml = xmlBuffer;
    const capturedOpId = operadoraIdField;

    // Delegar ao guard de RBAC + transacao; XML parsing ocorre DENTRO do guard
    // para que RBAC negue antes de processar o XML (recepcao recebe 403)
    const handler = rota('tiss.demonstrativo.import', async (tx, _ctx) => {
      // Parse XML somente apos RBAC aprovar
      const parsed = parseDemonstrativoXml(capturedXml);

      // Verificar que a operadora existe
      const { rowCount: opExiste } = await tx.query(
        `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
        [capturedOpId]);
      if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

      const demoId = uuidv7();
      let totalApres = 0;
      let totalProc = 0;
      let totalLib = 0;
      let totalGlosa = 0;

      for (const item of parsed.itens) {
        totalApres += item.valorApresentadoCents;
        totalProc += item.valorProcessadoCents;
        totalLib += item.valorLiberadoCents;
        totalGlosa += item.valorGlosaCents;
      }

      const xmlStorageKey = `tiss/demonstrativo/${demoId}.xml`;

      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, protocolo_operadora, kind, data_processamento,
            xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, $4,
                 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
                 $5, $6, $7, $8, $9, app.current_user_id())`,
        [demoId, capturedOpId, parsed.protocolo, parsed.kind,
         xmlStorageKey,
         totalApres, totalProc, totalLib, totalGlosa]);

      // Inserir itens
      for (const item of parsed.itens) {
        await tx.query(
          `INSERT INTO tiss.demonstrativo_item
             (id, demonstrativo_id, numero_guia_prestador,
              valor_apresentado_cents, valor_processado_cents,
              valor_liberado_cents, valor_glosa_cents,
              glosa_codigo, glosa_descricao)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [uuidv7(), demoId, item.numeroGuiaPrestador,
           item.valorApresentadoCents, item.valorProcessadoCents,
           item.valorLiberadoCents, item.valorGlosaCents,
           item.glosaCodigo, item.glosaDescricao]);
      }

      // Auditoria — usar somente chaves presentes na whitelist de audit.meta_keys_ok
      await tx.query(
        `SELECT audit.log('TISS_DEMO_IMPORT', 'tiss', 'demonstrativo', $1,
                'sucesso',
                jsonb_build_object('record_count', $2::int,
                                   'kind', $3::text), $4)`,
        [demoId, parsed.itens.length, parsed.kind,
         _ctx.actor.clinicId]);

      void reply.code(201);
      return { demonstrativoId: demoId, itemCount: parsed.itens.length };
    });

    return handler(req, reply);
  });

  // -- GET /v1/tiss/demonstrativos -- listar com paginacao -----------------
  r.get('/v1/tiss/demonstrativos', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        kind: z.enum(['analise', 'pagamento']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(DemoResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; kind?: string;
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
    if (q.kind !== undefined) {
      condicoes.push(`d.kind = $${idx}`);
      params.push(q.kind); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`d.imported_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo_operadora: string; kind: string; data_processamento: string;
      total_apresentado_cents: string; total_processado_cents: string;
      total_liberado_cents: string; total_glosa_cents: string;
      item_count: string; imported_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo_operadora, d.kind::text, d.data_processamento::text,
              d.total_apresentado_cents::text, d.total_processado_cents::text,
              d.total_liberado_cents::text, d.total_glosa_cents::text,
              (SELECT count(*)::text FROM tiss.demonstrativo_item di
                WHERE di.demonstrativo_id = d.id
                  AND di.tenant_id = d.tenant_id) AS item_count,
              to_char(d.imported_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS imported_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
         ${where}
        ORDER BY d.imported_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      demonstrativoId: row.id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo_operadora,
      kind: row.kind as 'analise' | 'pagamento',
      dataProcessamento: row.data_processamento,
      totalApresentadoCents: Number(row.total_apresentado_cents),
      totalProcessadoCents: Number(row.total_processado_cents),
      totalLiberadoCents: Number(row.total_liberado_cents),
      totalGlosaCents: Number(row.total_glosa_cents),
      itemCount: Number(row.item_count),
      importedAt: row.imported_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.importedAt : null;

    return { itens, nextCursor };
  }));

  // -- GET /v1/tiss/demonstrativos/:id -- detalhe com itens ----------------
  r.get('/v1/tiss/demonstrativos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: DemoResumoSchema.extend({
          itens: z.array(DemoItemSchema),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo_operadora: string; kind: string; data_processamento: string;
      total_apresentado_cents: string; total_processado_cents: string;
      total_liberado_cents: string; total_glosa_cents: string;
      item_count: string; imported_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo_operadora, d.kind::text, d.data_processamento::text,
              d.total_apresentado_cents::text, d.total_processado_cents::text,
              d.total_liberado_cents::text, d.total_glosa_cents::text,
              (SELECT count(*)::text FROM tiss.demonstrativo_item di
                WHERE di.demonstrativo_id = d.id
                  AND di.tenant_id = d.tenant_id) AS item_count,
              to_char(d.imported_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS imported_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE d.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('demonstrativo_nao_encontrado', 404);
    const demo = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; numero_guia_prestador: string;
      valor_apresentado_cents: string; valor_processado_cents: string;
      valor_liberado_cents: string; valor_glosa_cents: string;
      glosa_codigo: string | null; glosa_descricao: string | null;
    }>(
      `SELECT id, numero_guia_prestador,
              valor_apresentado_cents::text, valor_processado_cents::text,
              valor_liberado_cents::text, valor_glosa_cents::text,
              glosa_codigo, glosa_descricao
         FROM tiss.demonstrativo_item
        WHERE demonstrativo_id = $1
        ORDER BY id`,
      [p.id]);

    return {
      demonstrativoId: demo.id,
      operadoraId: demo.operadora_id,
      operadoraNome: demo.operadora_nome,
      protocolo: demo.protocolo_operadora,
      kind: demo.kind as 'analise' | 'pagamento',
      dataProcessamento: demo.data_processamento,
      totalApresentadoCents: Number(demo.total_apresentado_cents),
      totalProcessadoCents: Number(demo.total_processado_cents),
      totalLiberadoCents: Number(demo.total_liberado_cents),
      totalGlosaCents: Number(demo.total_glosa_cents),
      itemCount: Number(demo.item_count),
      importedAt: demo.imported_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        numeroGuiaPrestador: i.numero_guia_prestador,
        valorApresentadoCents: Number(i.valor_apresentado_cents),
        valorProcessadoCents: Number(i.valor_processado_cents),
        valorLiberadoCents: Number(i.valor_liberado_cents),
        valorGlosaCents: Number(i.valor_glosa_cents),
        glosaCodigo: i.glosa_codigo,
        glosaDescricao: i.glosa_descricao,
      })),
    };
  }));
}
