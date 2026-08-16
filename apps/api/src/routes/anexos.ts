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
        }),
      },
    },
  }, rota('attachment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      patientId: string; encounterId?: string; kind: typeof TIPOS[number];
      originalName: string; contentType: string; conteudoBase64: string };

    const bytes = Buffer.from(b.conteudoBase64, 'base64');
    if (bytes.length === 0) erroDominio('anexo_vazio', 400);
    if (bytes.length > LIMITE_BYTES) erroDominio('anexo_grande_demais', 413);

    const attachmentId = uuidv7();
    const storageKey = uuidv7();
    const sha256 = createHash('sha256').update(bytes).digest();
    const dekRef = process.env['STORAGE_KMS_KEY_ID'] ?? 'sem-kms';

    await armazenamento().put(`anexos/${storageKey}`, bytes, b.contentType);

    await tx.query(
      `INSERT INTO clin.attachment
         (id, patient_id, encounter_id, kind, storage_key, original_name,
          content_type, size_bytes, sha256, dek_ref, occurred_date, created_by)
       VALUES ($1,$2,$3,$4::clin.attachment_kind,$5,$6,$7,$8,$9,$10,
               app.local_date(clock_timestamp(),
                 (SELECT c.timezone FROM app.clinic c WHERE c.id = $11)),
               app.current_user_id())`,
      [attachmentId, b.patientId, b.encounterId ?? null, b.kind, storageKey,
       b.originalName, b.contentType, bytes.length, sha256, dekRef, ctx.actor.clinicId]);

    void reply.code(201);
    return {
      attachmentId, sha256: sha256.toString('hex'), sizeBytes: bytes.length,
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
      criado_em: string;
    }>(
      `SELECT a.id, a.kind::text AS kind, a.original_name, a.content_type,
              a.size_bytes::text, a.sha256, a.encounter_id,
              to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS criado_em
         FROM clin.attachment a
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
