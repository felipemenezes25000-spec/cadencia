import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';
import { providers } from '../providers';

function erroDominio(kind: string, status: number): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind });
}

/** 25 MB. Consulta de 40 minutos em webm/opus cabe folgado. */
const LIMITE_AUDIO = 25 * 1024 * 1024;

/**
 * Transcricao da consulta por IA.
 *
 * A rota devolve SUGESTAO e nao escreve nada no prontuario. O rascunho continua
 * como estava; quem digita — ou aceita — e o medico. Preencher sozinho poria no
 * acervo clinico texto que ninguem leu, e o acervo e assinado por uma pessoa.
 *
 * Tres coisas acontecem antes de qualquer byte sair daqui:
 *   1. o paciente nao pode ter recusado IA;
 *   2. quem chama tem que estar atendendo (`ai.transcribe`);
 *   3. a residencia do provedor e registrada, porque dado de saude processado
 *      fora do Brasil e transferencia internacional sob a LGPD e a clinica
 *      precisa conseguir dizer para onde o audio foi.
 */
export async function transcricaoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/v1/atendimentos/:id/transcricao', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        audioBase64: z.string().min(1),
        contentType: z.string().min(1).max(80),
        idioma: z.string().min(2).max(8).optional(),
      }),
      response: {
        201: z.object({
          aiAssistanceId: z.string().uuid(),
          transcricao: z.object({
            texto: z.string(),
            idioma: z.string(),
            duracaoMs: z.number().int(),
            falas: z.array(z.object({
              locutor: z.string(), texto: z.string(), inicioMs: z.number().int(),
            })),
          }),
          sugestao: z.object({
            evolucao: z.string(),
            alergias: z.string().nullable(),
            pesoKg: z.string().nullable(),
            alturaCm: z.string().nullable(),
            paSistolica: z.string().nullable(),
            paDiastolica: z.string().nullable(),
            cid: z.object({ codigo: z.string(), descricao: z.string() }).nullable(),
            medicamentosEmUso: z.array(z.string()),
            confianca: z.number(),
          }),
        }),
      },
    },
  }, rota('ai.transcribe', async (tx, ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as { audioBase64: string; contentType: string; idioma?: string };

    const { rows: enc } = await tx.query<{
      patient_id: string; ai_refused_at: string | null;
    }>(
      `SELECT e.patient_id, pat.ai_refused_at
         FROM clin.encounter e
         JOIN clin.patient pat ON (pat.tenant_id, pat.id) = (e.tenant_id, e.patient_id)
        WHERE e.id = $1`,
      [p.id]);

    const e = enc[0];
    if (e === undefined) erroDominio('atendimento_nao_encontrado', 404);
    // A recusa e do TITULAR e vale contra a clinica inteira. Checar depois de
    // enviar o audio seria pedir desculpa por um dado que ja saiu.
    if (e.ai_refused_at !== null) erroDominio('paciente_recusou_ia', 403);

    const audio = Buffer.from(b.audioBase64, 'base64');
    if (audio.length === 0) erroDominio('audio_vazio', 400);
    if (audio.length > LIMITE_AUDIO) erroDominio('audio_grande_demais', 413);

    const prov = providers().transcription;
    const pctx = {
      tenantId: ctx.actor.tenantId, actorUserId: ctx.actor.userId,
      requestId: uuidv7(), idempotencyKey: `transcricao:${p.id}`,
      deadlineMs: 120_000,
    };

    const t = await prov.transcrever(pctx, {
      audio, contentType: b.contentType,
      ...(b.idioma === undefined ? {} : { idioma: b.idioma }),
    });
    if (!t.ok) erroDominio('transcricao_falhou', 503);

    const sug = await prov.estruturar(pctx, { transcricao: t.value.texto });
    if (!sug.ok) erroDominio('estruturacao_falhou', 503);

    // Os hashes cobrem entrada e saida. Sem eles nao da para responder depois
    // "foi isto que o modelo recebeu e foi isto que ele devolveu" — e essa e a
    // pergunta quando alguem contesta uma sugestao aceita.
    const inputHash = createHash('sha256').update(audio).digest();

    // `residency` so aceita 'br' ou 'other': o que a LGPD distingue e dentro ou
    // fora do pais, e nao qual pais. O valor preciso do provedor fica no log.
    const residencia = prov.residency === 'br' ? 'br' : 'other';

    const registrar = async (
      proposito: string, classeDeRisco: string, corpo: unknown,
    ): Promise<string> => {
      const texto = JSON.stringify(corpo);
      const { rows } = await tx.query<{ id: string }>(
        `SELECT clin.record_ai_assistance(
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) AS id`,
        [p.id, proposito, classeDeRisco, prov.id, prov.modelId, prov.modelVersion,
         residencia, inputHash, texto,
         createHash('sha256').update(texto).digest()]);
      return rows[0]?.id ?? '';
    };

    // DOIS registros, e nao um.
    //
    // O schema separa `transcricao_anamnese` de `sugestao_cid` porque sao
    // funcoes de risco diferente sob a RDC 751: transcrever o que foi dito e
    // classe I; sugerir um codigo diagnostico e informacao que sustenta decisao
    // clinica, e sobe para IIa. Gravar a sugestao de CID sob o proposito da
    // transcricao classificaria uma funcao de risco maior como se fosse a menor
    // — que e exatamente o que a fiscalizacao procura.
    const aiId = await registrar(
      'transcricao_anamnese', 'I',
      { texto: t.value.texto, falas: t.value.falas, evolucao: sug.value.evolucao });

    if (sug.value.cid !== null) {
      await registrar('sugestao_cid', 'IIa', { cid: sug.value.cid,
        confianca: sug.value.confianca });
    }

    void reply.code(201);
    return {
      aiAssistanceId: aiId,
      transcricao: {
        texto: t.value.texto,
        idioma: t.value.idioma,
        duracaoMs: t.value.duracaoMs,
        falas: t.value.falas.map((f) => ({
          locutor: f.locutor, texto: f.texto, inicioMs: f.inicioMs,
        })),
      },
      sugestao: {
        evolucao: sug.value.evolucao,
        alergias: sug.value.alergias,
        pesoKg: sug.value.pesoKg,
        alturaCm: sug.value.alturaCm,
        paSistolica: sug.value.paSistolica,
        paDiastolica: sug.value.paDiastolica,
        cid: sug.value.cid,
        medicamentosEmUso: [...sug.value.medicamentosEmUso],
        confianca: sug.value.confianca,
      },
    };
  }));
}
