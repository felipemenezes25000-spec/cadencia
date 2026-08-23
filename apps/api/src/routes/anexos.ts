import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';
import { armazenamento } from '../storage';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

const TIPOS = ['resultado_exame', 'imagem', 'documento_externo',
  'consentimento', 'outro'] as const;
const LIMITE_BYTES = 20 * 1024 * 1024;
const TIPOS_INLINE: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif',
]);

export async function anexoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/anexos', {
    schema: {
      body: z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        requestDocumentId: z.string().uuid().optional(),
        kind: z.enum(TIPOS),
        originalName: z.string().min(1).max(255),
        contentType: z.string().min(1).max(120),
        conteudoBase64: z.string().min(1),
      }),
      response: {
        201: z.object({
          attachmentId: z.string().uuid(),
          sha256: z.string(),
          sizeBytes: z.number().int(),
          requestDocumentId: z.string().uuid().nullable(),
        }),
      },
    },
  }, rota('attachment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; requestDocumentId?: string;
      kind: typeof TIPOS[number]; originalName: string; contentType: string;
      conteudoBase64: string };

    let encounterId = b.encounterId ?? null;
    if (b.requestDocumentId !== undefined) {
      if (b.kind !== 'resultado_exame') erroDominio('pedido_so_pode_vincular_resultado_exame', 422);
      const pedido = await tx.query<{ encounter_id: string | null }>(
        `SELECT encounter_id
           FROM clin.document
          WHERE id = $1 AND patient_id = $2 AND kind = 'pedido_exame'`,
        [b.requestDocumentId, b.patientId]);
      const p = pedido.rows[0];
      if (p === undefined) erroDominio('pedido_exame_nao_encontrado', 422);
      if (encounterId !== null && p.encounter_id !== null && encounterId !== p.encounter_id) {
        erroDominio('resultado_exame_atendimento_divergente', 422);
      }
      encounterId = p.encounter_id ?? encounterId;
    }

    const bytes = Buffer.from(b.conteudoBase64, 'base64');
    if (bytes.length === 0) erroDominio('anexo_vazio', 400);
    if (bytes.length > LIMITE_BYTES) erroDominio('anexo_grande_demais', 413);

    const attachmentId = uuidv7();
    const storageKey = uuidv7();
    const sha256 = createHash('sha256').update(bytes).digest();
    const dekRef = process.env['STORAGE_KMS_KEY_ID'] ?? 'sem-kms';
    const objectKey = `anexos/${storageKey}`;

    await armazenamento().put(objectKey, bytes, b.contentType);
    try {
      await tx.query(
        `INSERT INTO clin.attachment
           (id, patient_id, encounter_id, request_document_id, kind, storage_key, original_name,
            content_type, size_bytes, sha256, dek_ref, occurred_date, created_by)
         VALUES ($1,$2,$3,$4,$5::clin.attachment_kind,$6,$7,$8,$9,$10,$11,
                 app.local_date(clock_timestamp(),
                   (SELECT c.timezone FROM app.clinic c WHERE c.id = $12)),
                 app.current_user_id())`,
        [attachmentId, b.patientId, encounterId, b.requestDocumentId ?? null, b.kind, storageKey,
         b.originalName, b.contentType, bytes.length, sha256, dekRef, ctx.actor.clinicId]);
    } catch (e) {
      // A linha é a fonte de verdade. Se ela não entrar, não deixa um objeto
      // clínico órfão sem RLS nem referência auditável no armazenamento.
      await armazenamento().delete(objectKey).catch(() => undefined);
      throw e;
    }

    void reply.code(201);
    return {
      attachmentId, sha256: sha256.toString('hex'), sizeBytes: bytes.length,
      requestDocumentId: b.requestDocumentId ?? null,
    };
  }));

  r.get('/v1/pacientes/:id/pedidos-exame', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({ pendentes: z.coerce.boolean().optional() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            documentId: z.string().uuid(),
            titulo: z.string(),
            issuedDate: z.string(),
            encounterId: z.string().uuid().nullable(),
            resultados: z.number().int(),
          })),
        }),
      },
    },
  }, rota('document.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const q = req.query as { pendentes?: boolean };
    const { rows } = await tx.query<{
      id: string; titulo: string; issued_date: string; encounter_id: string | null;
      resultados: number;
    }>(
      `SELECT d.id,
              coalesce(nullif(d.payload->>'titulo', ''), 'Solicitação de exames') AS titulo,
              d.issued_date::text AS issued_date,
              d.encounter_id,
              count(a.id)::int AS resultados
         FROM clin.document d
         LEFT JOIN clin.attachment a
           ON (a.tenant_id, a.request_document_id) = (d.tenant_id, d.id)
          AND a.kind = 'resultado_exame' AND a.purged_at IS NULL
        WHERE d.patient_id = $1
          AND d.kind = 'pedido_exame'
        GROUP BY d.tenant_id, d.id, d.payload, d.issued_date, d.encounter_id, d.created_at
       HAVING (NOT $2::boolean OR count(a.id) = 0)
        ORDER BY d.issued_date DESC, d.created_at DESC`,
      [p.id, q.pendentes ?? false]);

    await tx.query(`SELECT audit.log_read('exam_request_list', $1)`, [p.id]);
    return {
      itens: rows.map((x) => ({
        documentId: x.id,
        titulo: x.titulo,
        issuedDate: x.issued_date,
        encounterId: x.encounter_id,
        resultados: x.resultados,
      })),
    };
  }));

  r.get('/v1/pacientes/:id/anexos', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          itens: z.array(z.object({
            attachmentId: z.string().uuid(),
            kind: z.string(),
            originalName: z.string(),
            contentType: z.string(),
            sizeBytes: z.number().int(),
            sha256: z.string(),
            encounterId: z.string().uuid().nullable(),
            requestDocumentId: z.string().uuid().nullable(),
            pedidoTitulo: z.string().nullable(),
            criadoEm: z.string(),
          })),
        }),
      },
    },
  }, rota('attachment.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; kind: string; original_name: string; content_type: string;
      size_bytes: string; sha256: Buffer; encounter_id: string | null;
      request_document_id: string | null; pedido_titulo: string | null; criado_em: string;
    }>(
      `SELECT a.id, a.kind::text AS kind, a.original_name, a.content_type,
              a.size_bytes::text, a.sha256, a.encounter_id, a.request_document_id,
              CASE WHEN d.id IS NULL THEN NULL
                   ELSE coalesce(nullif(d.payload->>'titulo', ''), 'Solicitação de exames') END
                AS pedido_titulo,
              to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS criado_em
         FROM clin.attachment a
         LEFT JOIN clin.document d
           ON (d.tenant_id, d.id) = (a.tenant_id, a.request_document_id)
        WHERE a.patient_id = $1
          AND a.purged_at IS NULL
        ORDER BY a.created_at DESC`,
      [p.id]);

    return {
      itens: rows.map((x) => ({
        attachmentId: x.id,
        kind: x.kind,
        originalName: x.original_name,
        contentType: x.content_type,
        sizeBytes: Number(x.size_bytes),
        sha256: x.sha256.toString('hex'),
        encounterId: x.encounter_id,
        requestDocumentId: x.request_document_id,
        pedidoTitulo: x.pedido_titulo,
        criadoEm: x.criado_em,
      })),
    };
  }));

  r.get('/v1/anexos/:id/conteudo', {
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, rota('attachment.read', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      storage_key: string; content_type: string; original_name: string;
      sha256: Buffer; purged_at: string | null; patient_id: string;
    }>(
      `SELECT storage_key, content_type, original_name, sha256, purged_at, patient_id
         FROM clin.attachment WHERE id = $1`,
      [p.id]);

    const a = rows[0];
    if (a === undefined) erroDominio('anexo_nao_encontrado', 404);
    if (a.purged_at !== null) erroDominio('anexo_purgado', 410);
    await tx.query(`SELECT audit.log_read('attachment_read', $1)`, [a.patient_id]);

    const bytes = await armazenamento().get(`anexos/${a.storage_key}`);
    if (bytes === null) erroDominio('anexo_sem_conteudo', 404);

    const inline = TIPOS_INLINE.has(a.content_type);
    void reply
      .header('content-type', inline ? a.content_type : 'application/octet-stream')
      .header('content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${
          a.original_name.replace(/["\r\n]/g, '')}"`)
      .header('content-security-policy',
        "default-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'")
      .header('cache-control', 'private, no-store');
    return reply.send(Buffer.from(bytes));
  }));
}
