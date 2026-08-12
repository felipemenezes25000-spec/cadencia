import { isoFromMs, systemClock } from '@cadencia/kernel';
import { failure, success, type ProviderResult } from '../contracts/common';
import type {
  FalaTranscrita, SugestaoClinica, TranscricaoBruta, TranscriptionProvider,
} from '../contracts/transcription';

/**
 * Transcrição clínica pela OpenAI.
 *
 * DOIS modelos, de propósito:
 *
 *   `gpt-4o-transcribe-diarize` para o áudio. A diarização — separar quem falou
 *   o quê — não é refinamento: sem ela, "estou com dor" pode acabar atribuído ao
 *   médico. Prontuário que troca a fala do paciente pela do médico é prontuário
 *   que conta outra consulta.
 *
 *   `gpt-5.4-mini` para estruturar. Medido contra `gpt-5.4` e `gpt-5.5` na
 *   própria tarefa: com a instrução anti-inferência, os três devolvem o MESMO
 *   código (R51) de forma estável, e o mini responde em ~1/3 do tempo. Pagar
 *   pelo maior compraria latência, não acerto.
 */

const INSTRUCAO_ANTI_INFERENCIA = `
Você transcreve consulta médica para SUGERIR preenchimento de prontuário.

REGRAS ABSOLUTAS:
1. NUNCA proponha diagnóstico que o médico não tenha dito. Se o paciente descreve
   sintoma, o código é do SINTOMA, não da doença que o sintoma sugere.
2. NUNCA invente número. Peso, altura e pressão só entram se foram DITOS.
3. Campo sem informação na transcrição volta null.
4. A evolução é prosa clínica do que foi dito, sem conclusão que ninguém tirou.

Devolva SOMENTE JSON:
{"evolucao":string,"alergias":string|null,"pesoKg":string|null,
 "alturaCm":string|null,"paSistolica":string|null,"paDiastolica":string|null,
 "cid":{"codigo":string,"descricao":string}|null,
 "medicamentosEmUso":string[],"confianca":number}
`.trim();

export interface OpenAiTranscricaoConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly modeloAudio?: string;
  readonly modeloTexto?: string;
  readonly deadlineMs?: number;
}

function extrairJson(texto: string): unknown {
  // O modelo às vezes cerca o JSON com crase tripla mesmo instruído a não fazer.
  const limpo = texto.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
  try { return JSON.parse(limpo); } catch { return null; }
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function createOpenAiTranscriptionProvider(
  cfg: OpenAiTranscricaoConfig,
): TranscriptionProvider {
  const base = cfg.baseUrl ?? 'https://api.openai.com/v1';
  const modeloAudio = cfg.modeloAudio ?? 'gpt-4o-transcribe-diarize';
  const modeloTexto = cfg.modeloTexto ?? 'gpt-5.4-mini';
  const deadline = cfg.deadlineMs ?? 120_000;

  async function chamar(caminho: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), deadline);
    try {
      return await fetch(`${base}${caminho}`, {
        ...init,
        signal: ac.signal,
        headers: { authorization: `Bearer ${cfg.apiKey}`, ...(init.headers ?? {}) },
      });
    } finally { clearTimeout(t); }
  }

  return {
    id: 'openai',
    // A OpenAI processa fora do Brasil. Declarado explicitamente porque isto vai
    // para `clin.ai_assistance.residency` e e a resposta que a clinica da quando
    // perguntam para onde foi o audio da consulta.
    residency: 'us',
    modelId: modeloTexto,
    modelVersion: modeloAudio,
    capabilities: new Set(['diarizacao', 'residency:us']),
    safety: { transcrever: 'idempotent', estruturar: 'idempotent' },

    async health() {
      // O relogio vem do kernel, e nao da chamada global de tempo do runtime: o
      // lint de fonte de tempo so abre excecao para `kernel/clock.ts` e
      // `kernel/uuid.ts`, e a regra existe para que carimbo persistido venha
      // sempre do Postgres.
      const t0 = systemClock.nowMs();
      const r = await chamar('/models', { method: 'GET' }).catch(() => null);
      return {
        up: r !== null && r.ok,
        latencyMs: systemClock.nowMs() - t0,
        checkedAt: isoFromMs(systemClock.nowMs()) as never,
      };
    },

    async transcrever(_ctx, i): Promise<ProviderResult<TranscricaoBruta>> {
      const form = new FormData();
      form.append('file', new Blob([i.audio as BlobPart], { type: i.contentType }),
        'consulta.webm');
      form.append('model', modeloAudio);
      form.append('response_format', 'json');
      if (i.idioma !== undefined) form.append('language', i.idioma);

      const r = await chamar('/audio/transcriptions', { method: 'POST', body: form });
      if (!r.ok) {
        const detalhe = (await r.text()).slice(0, 300);
        return failure({
          kind: r.status >= 500 ? 'unavailable' : 'rejected',
          retrySafe: r.status >= 500,
          ...(r.status >= 500 ? {} : { code: String(r.status) }),
          detail: detalhe,
        } as never);
      }

      const j = await r.json() as {
        text?: string; language?: string; duration?: number;
        segments?: { speaker?: string; text?: string; start?: number }[];
      };

      const falas: FalaTranscrita[] = (j.segments ?? []).map((sgm) => ({
        // Sem rótilo de locutor, `desconhecido` — e não "MÉDICO" por padrão.
        // Chutar quem falou é o erro que troca a queixa do paciente pela
        // conduta do médico.
        locutor: sgm.speaker ?? 'desconhecido',
        texto: sgm.text ?? '',
        inicioMs: Math.round((sgm.start ?? 0) * 1000),
      }));

      return success<TranscricaoBruta>({
        texto: j.text ?? '',
        falas,
        idioma: j.language ?? i.idioma ?? 'pt',
        duracaoMs: Math.round((j.duration ?? 0) * 1000),
      }, 'openai:transcricao');
    },

    async estruturar(_ctx, i): Promise<ProviderResult<SugestaoClinica>> {
      const r = await chamar('/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modeloTexto,
          input: `${INSTRUCAO_ANTI_INFERENCIA}\n\nTRANSCRICAO:\n${i.transcricao}`,
        }),
      });
      if (!r.ok) {
        return failure({
          kind: r.status >= 500 ? 'unavailable' : 'rejected',
          retrySafe: r.status >= 500,
          ...(r.status >= 500 ? {} : { code: String(r.status) }),
          detail: (await r.text()).slice(0, 300),
        } as never);
      }

      const j = await r.json() as {
        output?: { content?: { text?: string }[] }[];
      };
      const bruto = (j.output ?? [])
        .flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
      const obj = extrairJson(bruto) as Record<string, unknown> | null;
      if (obj === null) {
        return failure({
          kind: 'rejected', retrySafe: false, code: 'json_invalido',
          detail: bruto.slice(0, 200),
        } as never);
      }

      const cid = obj['cid'] as { codigo?: unknown; descricao?: unknown } | null;
      const meds = Array.isArray(obj['medicamentosEmUso'])
        ? (obj['medicamentosEmUso'] as unknown[]).filter(
            (x): x is string => typeof x === 'string')
        : [];
      const conf = typeof obj['confianca'] === 'number' ? obj['confianca'] : 0;

      return success<SugestaoClinica>({
        evolucao: texto(obj['evolucao']) ?? '',
        alergias: texto(obj['alergias']),
        pesoKg: texto(obj['pesoKg']),
        alturaCm: texto(obj['alturaCm']),
        paSistolica: texto(obj['paSistolica']),
        paDiastolica: texto(obj['paDiastolica']),
        cid: typeof cid?.codigo === 'string' && cid.codigo !== ''
          ? { codigo: cid.codigo,
              descricao: typeof cid.descricao === 'string' ? cid.descricao : '' }
          : null,
        medicamentosEmUso: meds,
        // Confianca fora de 0..1 vira 0: modelo que se declara 1.4 confiante
        // esta errado sobre si mesmo, e o numero seria usado para ordenar
        // revisao.
        confianca: conf >= 0 && conf <= 1 ? conf : 0,
      }, 'openai:estrutura');
    },
  };
}
