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

/** 20 MB. Resultado de exame com imagem passa fácil de 5; tomografia nao sobe por aqui. */
const LIMITE_BYTES = 20 * 1024 * 1024;

/**
 * Tipos que o navegador pode ABRIR no lugar de baixar.
 *
 * Lista fechada de proposito, e curta de proposito: e exatamente o conjunto em
 * que ver o anexo na tela vale mais do que baixa-lo — laudo em PDF e foto de
 * exame. Nada aqui executa script. `text/html`, `image/svg+xml` e
 * `application/xhtml+xml` ficam de FORA justamente porque executariam, e o
 * conteudo veio de upload.
 */
const TIPOS_INLINE: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif',
]);

/**
 * Anexos do prontuario: o exame que o paciente traz na mao.
 *
 * O arquivo vai para o armazenamento de objetos e a linha em `clin.attachment`
 * guarda o PONTEIRO mais o sha256. O hash e calculado no servidor sobre os bytes
 * que chegaram: aceitar um hash enviado pelo cliente seria aceitar a afirmacao
 * de quem envia sobre o proprio arquivo — e anexo e prova clinica.
 */
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
        // Base64 no corpo, e nao multipart: o volume aqui e laudo e foto, nao
        // exame de imagem inteiro. Quando entrar DICOM, entra por upload direto
        // ao armazenamento com URL assinada — e ai o corpo nem passa pela API.
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
    // `CHECK (size_bytes > 0)` no banco. Recusar aqui devolve erro de validacao
    // em vez de 500 vindo do Postgres — e base64 invalido tambem cai aqui,
    // porque Buffer.from ignora lixo em silencio e produz vazio.
    if (bytes.length === 0) erroDominio('anexo_vazio', 400);
    if (bytes.length > LIMITE_BYTES) erroDominio('anexo_grande_demais', 413);

    const attachmentId = uuidv7();
    const storageKey = uuidv7();
    const sha256 = createHash('sha256').update(bytes).digest();

    // Grava o OBJETO antes da linha. Na ordem inversa, uma falha de disco
    // deixaria no prontuario um anexo que nao abre — e o medico so descobre
    // quando precisa dele. Objeto orfao, ao contrario, e lixo que a purga limpa.
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
       b.originalName, b.contentType, bytes.length, sha256,
       // `dek_ref` e NOT NULL e aponta para a chave de dado que cifra o objeto.
       // Sem KMS ainda, marcamos explicitamente que NAO ha cifra em repouso, em
       // vez de gravar um identificador que sugira uma chave inexistente.
       'sem-kms', ctx.actor.clinicId]);

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
          -- Anexo purgado pela LGPD some da lista. A linha continua para a
          -- auditoria saber que existiu; o conteudo e que nao existe mais.
          AND a.purged_at IS NULL
        ORDER BY a.created_at DESC`,
      [p.id]);

    return {
      itens: rows.map((x) => ({
        attachmentId: x.id,
        kind: x.kind,
        originalName: x.original_name,
        contentType: x.content_type,
        // `size_bytes` e bigint: node-postgres devolve string para nao perder
        // precisao, e o schema de resposta diz numero.
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
    // RLS ja filtrou tenant e escopo clinico: zero linhas e "nao existe para
    // voce", e a mensagem nao distingue isso de "nao existe".
    if (a === undefined) erroDominio('anexo_nao_encontrado', 404);
    if (a.purged_at !== null) erroDominio('anexo_purgado', 410);

    // §3.7 — baixar o anexo E acessar conteudo clinico: o laudo que o paciente
    // trouxe e prontuario tanto quanto a evolucao. Registra antes de entregar.
    await tx.query(`SELECT audit.log_read('attachment_read', $1)`, [a.patient_id]);

    const bytes = await armazenamento().get(`anexos/${a.storage_key}`);
    if (bytes === null) erroDominio('anexo_sem_conteudo', 404);

    // `content_type` e o que o CLIENTE declarou no upload (string livre de ate
    // 120 chars, sem validacao). Devolver isso como veio, com `inline`, na
    // origem da API, transforma o upload de anexo em XSS armazenado: basta
    // enviar `text/html` com <script> e abrir o anexo depois. O cookie de CSRF
    // nasce com httpOnly:false, entao o script leria o token e emitiria
    // requisicao autenticada em nome de quem abriu.
    //
    // So os tipos que o navegador precisa RENDERIZAR para o anexo ter serventia
    // (laudo em PDF, foto de exame) continuam inline. Todo o resto vira
    // download, e ai o navegador nao executa nada.
    const inline = TIPOS_INLINE.has(a.content_type);
    void reply
      .header('content-type', inline ? a.content_type : 'application/octet-stream')
      .header('content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${
          a.original_name.replace(/["\r\n]/g, '')}"`)
      // Rede de seguranca para o caso de um tipo novo entrar na lista: sem
      // script, sem fetch, sem plugin, mesmo que o conteudo tente.
      .header('content-security-policy',
        "default-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'")
      // Dado de saude com nome de paciente: nao entra em cache de proxy.
      .header('cache-control', 'private, no-store');
    return reply.send(Buffer.from(bytes));
  }));
}
