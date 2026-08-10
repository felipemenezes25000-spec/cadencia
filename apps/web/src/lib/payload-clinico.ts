import type { SecaoDaFicha } from './ficha-tipos';

/**
 * Transforma o que o medico preencheu no PAYLOAD CLINICO que finaliza o
 * atendimento.
 *
 * Nao e mapeamento burro: cada tipo de campo tem um destino diferente no acervo,
 * e errar o destino significa dado que existe na tela e nao existe em relatorio
 * nenhum. A tabela de destinos e `FIELD_KINDS` em `packages/emr`.
 */

export type ValorDeCampo =
  | { readonly slot: 'value_text'; readonly text: string }
  | { readonly slot: 'value_num'; readonly num: string }
  | { readonly slot: 'value_bool'; readonly bool: boolean }
  | { readonly slot: 'value_date'; readonly date: string }
  | { readonly slot: 'value_ref_code'; readonly source: string; readonly code: string };

export interface CampoSelado {
  readonly fieldId: string;
  readonly fieldGeneration: number;
  readonly labelSnapshot: string;
  readonly displaySnapshot: string | null;
  readonly terminologyVersion: string | null;
  readonly sectionInstance: number;
  readonly ordinal: number;
  readonly value: ValorDeCampo;
}

export interface ObservacaoSelada {
  /** De qual campo esta observacao e projecao. NOT NULL no banco. */
  readonly fieldId: string;
  readonly observationCode: string;
  readonly valueNum: string;
  readonly unit: string | null;
  readonly componentOrdinal: number;
}

export interface DiagnosticoSelado {
  readonly codeSystem: string;
  readonly code: string;
  readonly displaySnapshot: string;
  readonly terminologyVersion: string;
  readonly isPrincipal: boolean;
}

export interface PayloadClinico {
  readonly fields: readonly CampoSelado[];
  readonly diagnoses: readonly DiagnosticoSelado[];
  readonly observations: readonly ObservacaoSelada[];
  readonly findings: readonly never[];
  readonly procedures: readonly never[];
  readonly ai: readonly never[];
}

export interface EntradaDoPayload {
  readonly secoes: readonly SecaoDaFicha[];
  readonly valores: Readonly<Record<string, string>>;
  /** Texto do editor narrativo. Vai para o campo de code `evolucao`. */
  readonly evolucao: string;
  /** Competencia do CID vigente, vinda de /v1/catalogos/cid. */
  readonly competenciaCid: string;
}

export function montarPayloadClinico(i: EntradaDoPayload): PayloadClinico {
  const fields: CampoSelado[] = [];
  const observations: ObservacaoSelada[] = [];
  const diagnoses: DiagnosticoSelado[] = [];

  let achouEvolucao = false;

  for (const secao of i.secoes) {
    for (const [ordinal, campo] of secao.campos.entries()) {
      const base = {
        fieldId: campo.fieldId,
        fieldGeneration: campo.generation,
        labelSnapshot: campo.label,
        sectionInstance: 1,
        ordinal,
      };

      // A evolucao narrativa vem do EDITOR, nao da ficha. Duas caixas para a
      // mesma coisa fariam o medico escrever numa e a outra sobrescrever com
      // vazio na hora de selar.
      if (campo.code === 'evolucao') {
        achouEvolucao = true;
        if (i.evolucao.trim() !== '') {
          fields.push({ ...base, displaySnapshot: null, terminologyVersion: null,
            value: { slot: 'value_text', text: i.evolucao } });
        }
        continue;
      }

      if (campo.kind === 'composto') {
        // `FIELD_KINDS` diz `slot: null`: o campo em si nao tem valor. Quem
        // carrega o dado sao os componentes, um por observacao. Preencher so a
        // sistolica registra so a sistolica — inventar a diastolica seria
        // inventar sinal vital.
        for (const k of campo.componentes) {
          const v = (i.valores[`${campo.fieldId}:${k.observationCode}`] ?? '').trim();
          if (v === '') continue;
          observations.push({
            fieldId: campo.fieldId,
            observationCode: k.observationCode, valueNum: v,
            unit: k.unit, componentOrdinal: k.ordinal,
          });
        }
        continue;
      }

      const bruto = (i.valores[campo.fieldId] ?? '').trim();
      if (bruto === '') continue;

      if (campo.kind === 'busca_tabela') {
        const [code, ...resto] = bruto.split('|');
        if (code === undefined || code === '') continue;
        const display = resto.join('|');
        fields.push({ ...base,
          displaySnapshot: display === '' ? null : display,
          terminologyVersion: i.competenciaCid,
          value: { slot: 'value_ref_code', source: campo.refSource ?? '', code } });
        // As duas CIDs viram diagnostico; o sistema vem do proprio campo.
        // `clin.diagnosis` tem CHECK (code_system IN ('CID10','CID11')), e um
        // diagnostico de 2027 catalogado como CID-10 seria impossivel de
        // reconciliar depois — sem que nada na tela indicasse o erro.
        if (campo.refSource === 'CID10' || campo.refSource === 'CID11') {
          diagnoses.push({
            codeSystem: campo.refSource, code, displaySnapshot: display,
            // A versao vem do CATALOGO. Fixar um valor aqui afirmaria em
            // prontuario uma versao de terminologia que ninguem conferiu.
            terminologyVersion: i.competenciaCid,
            // Um CID por atendimento nesta tela, entao ele e o principal.
            // Quando houver lista, `isPrincipal` vira escolha do medico.
            isPrincipal: true,
          });
        }
        continue;
      }

      if (campo.kind === 'numerico' || campo.kind === 'imc') {
        fields.push({ ...base, displaySnapshot: null, terminologyVersion: null,
          value: { slot: 'value_num', num: bruto } });
        if (campo.observationCode !== null) {
          // Numero como STRING de ponta a ponta: "70.50" e "70.5" sao valores
          // diferentes na tela e precisam de hashes diferentes (§4.3).
          observations.push({
            fieldId: campo.fieldId,
            observationCode: campo.observationCode, valueNum: bruto,
            unit: campo.unit, componentOrdinal: 1,
          });
        }
        continue;
      }

      if (campo.kind === 'booleano') {
        fields.push({ ...base, displaySnapshot: null, terminologyVersion: null,
          value: { slot: 'value_bool', bool: bruto === 'true' } });
        continue;
      }

      if (campo.kind === 'data') {
        fields.push({ ...base, displaySnapshot: null, terminologyVersion: null,
          value: { slot: 'value_date', date: bruto } });
        continue;
      }

      // texto_curto, texto_longo e qualquer tipo que a ficha renderize como
      // texto. Tipo que a ficha nao renderiza nunca chega aqui com valor.
      fields.push({ ...base, displaySnapshot: null, terminologyVersion: null,
        value: { slot: 'value_text', text: bruto } });
    }
  }

  if (!achouEvolucao) {
    // Selar sem lugar para a evolucao perderia o atendimento inteiro em
    // silencio. Falhar alto manda configurar o prontuario.
    throw new Error('prontuario_sem_campo_de_evolucao');
  }

  return { fields, diagnoses, observations, findings: [], procedures: [], ai: [] };
}
