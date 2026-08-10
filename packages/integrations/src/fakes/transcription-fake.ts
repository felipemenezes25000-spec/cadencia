import { success, type ProviderResult } from '../contracts/common';
import type {
  SugestaoClinica, TranscricaoBruta, TranscriptionProvider,
} from '../contracts/transcription';

/**
 * Transcricao simulada, deterministica.
 *
 * Existe pelo mesmo motivo dos outros fakes: a suite nao pode chamar um provedor
 * de verdade. Aqui isso e mais serio que custo — o audio de uma consulta e dado
 * de saude, e um teste que o enviasse para fora estaria fazendo transferencia
 * internacional de dado sensivel toda vez que alguem rodasse `pnpm test`.
 */
export interface FakeTranscriptionOptions {
  readonly sugestao?: Partial<SugestaoClinica>;
}

export function createFakeTranscriptionProvider(
  opts: FakeTranscriptionOptions = {},
): TranscriptionProvider {
  return {
    id: 'transcription-fake',
    // Declara `local`: nada sai da maquina. E a resposta honesta para "para onde
    // foi o audio" quando ele nao foi a lugar nenhum.
    residency: 'local',
    modelId: 'fake-transcribe',
    modelVersion: '0',
    capabilities: new Set(['residency:local', 'diarizacao']),
    safety: { transcrever: 'idempotent', estruturar: 'idempotent' },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: '1970-01-01T00:00:00.000Z' as never };
    },

    async transcrever(): Promise<ProviderResult<TranscricaoBruta>> {
      return success<TranscricaoBruta>({
        texto: 'MEDICO: Bom dia.\nPACIENTE: Estou com dor de cabeca ha tres dias.',
        falas: [
          { locutor: 'MEDICO', texto: 'Bom dia.', inicioMs: 0 },
          { locutor: 'PACIENTE', texto: 'Estou com dor de cabeca ha tres dias.',
            inicioMs: 1500 },
        ],
        idioma: 'pt',
        duracaoMs: 4000,
      }, 'fake-transcricao');
    },

    async estruturar(): Promise<ProviderResult<SugestaoClinica>> {
      return success<SugestaoClinica>({
        evolucao: 'Paciente refere cefaleia ha tres dias.',
        alergias: null,
        pesoKg: null,
        alturaCm: null,
        paSistolica: null,
        paDiastolica: null,
        cid: { codigo: 'R51', descricao: 'Cefaleia' },
        medicamentosEmUso: [],
        confianca: 0.9,
        ...opts.sugestao,
      }, 'fake-estrutura');
    },
  };
}
