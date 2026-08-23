import type { SecaoDaFicha } from './ficha-tipos';

/**
 * Transforma o que o médico preencheu no PAYLOAD CLÍNICO que finaliza o
 * atendimento.
 *
 * Cada tipo de campo precisa respeitar o slot definido em `packages/emr`.
 * Gravar uma opção categórica como texto, ou um odontograma como string, faz o
 * dado existir visualmente e desaparecer das projeções clínicas/relatórios.
 */

export type ValorDeCampo =
  | { readonly slot: 'value_text'; readonly text: string }
  | { readonly slot: 'value_num'; readonly num: string }
  | { readonly slot: 'value_bool'; readonly bool: boolean }
  | { readonly slot: 'value_date'; readonly date: string }
  | { readonly slot: 'value_json'; readonly json: unknown }
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

export interface AchadoSelado {
  readonly fieldCode: string;
  readonly optionCode: string;
  readonly displaySnapshot: string;
  readonly ordinal: number;
}

export interface PayloadClinico {
  readonly fields: readonly CampoSelado[];
  readonly diagnoses: readonly DiagnosticoSelado[];
  readonly observations: readonly ObservacaoSelada[];
  readonly findings: readonly AchadoSelado[];
  readonly procedures: readonly never[];
  readonly ai: readonly never[];
}

export interface EntradaDoPayload {
  readonly secoes: readonly SecaoDaFicha[];
  readonly valores: Readonly<Record<string, string>>;
  /** Texto do editor narrativo. Vai para o campo de code `evolucao`. */
  readonly evolucao: string;
  /** Competência da terminologia codificada usada no atendimento. */
  readonly competenciaCid: string;
}

function erroObrigatorio(code: string): never {
  throw new Error(`campo_obrigatorio:${code}`);
}

function fonteDaOpcao(code: string, refSource: string | null): string {
  return refSource ?? `FIELD_OPTION:${code}`;
}

function ordinalDaOpcao(
  opcoes: readonly string[] | null,
  opcao: string,
  fallback: number,
): number {
  const indice = opcoes?.indexOf(opcao) ?? -1;
  return indice >= 0 ? indice : fallback;
}

function jsonClinico(bruto: string, code: string): unknown {
  try {
    return JSON.parse(bruto) as unknown;
  } catch {
    throw new Error(`campo_json_invalido:${code}`);
  }
}

export function montarPayloadClinico(i: EntradaDoPayload): PayloadClinico {
  const fields: CampoSelado[] = [];
  const observations: ObservacaoSelada[] = [];
  const diagnoses: DiagnosticoSelado[] = [];
  const findings: AchadoSelado[] = [];

  let achouEvolucao = false;

  for (const secao of i.secoes) {
    for (const [ordinal, campo] of secao.campos.entries()) {
      const base = {
        fieldId: campo.fieldId,
        fieldGeneration: campo.generation,
        labelSnapshot: campo.label,
        sectionInstance: 1,
      };

      // A evolução narrativa vem do EDITOR, não da ficha. Duas caixas para a
      // mesma coisa fariam uma sobrescrever a outra durante a selagem.
      if (campo.code === 'evolucao') {
        achouEvolucao = true;
        const evolucao = i.evolucao.trim();
        if (evolucao === '') {
          if (campo.required) erroObrigatorio(campo.code);
          continue;
        }
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: null,
          terminologyVersion: null,
          value: { slot: 'value_text', text: i.evolucao },
        });
        continue;
      }

      if (campo.kind === 'composto') {
        let preenchidos = 0;
        for (const k of campo.componentes) {
          const v = (i.valores[`${campo.fieldId}:${k.observationCode}`] ?? '').trim();
          if (v === '') continue;
          preenchidos += 1;
          observations.push({
            fieldId: campo.fieldId,
            observationCode: k.observationCode,
            valueNum: v,
            unit: k.unit,
            componentOrdinal: k.ordinal,
          });
        }
        if (campo.required && preenchidos !== campo.componentes.length) {
          erroObrigatorio(campo.code);
        }
        continue;
      }

      const bruto = (i.valores[campo.fieldId] ?? '').trim();
      if (bruto === '') {
        if (campo.required) erroObrigatorio(campo.code);
        continue;
      }

      if (campo.kind === 'multipla_escolha') {
        const marcados = bruto.split('|').map((x) => x.trim()).filter(Boolean);
        for (const [indice, opcao] of marcados.entries()) {
          const ordinalOpcao = ordinalDaOpcao(campo.options, opcao, indice);
          fields.push({
            ...base,
            ordinal: ordinalOpcao,
            displaySnapshot: opcao,
            terminologyVersion: null,
            value: {
              slot: 'value_ref_code',
              source: fonteDaOpcao(campo.code, campo.refSource),
              code: opcao,
            },
          });
          findings.push({
            fieldCode: campo.code,
            optionCode: opcao,
            displaySnapshot: opcao,
            ordinal: ordinalOpcao,
          });
        }
        continue;
      }

      if (campo.kind === 'lista_unica') {
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: bruto,
          terminologyVersion: null,
          value: {
            slot: 'value_ref_code',
            source: fonteDaOpcao(campo.code, campo.refSource),
            code: bruto,
          },
        });
        findings.push({
          fieldCode: campo.code,
          optionCode: bruto,
          displaySnapshot: bruto,
          ordinal: 0,
        });
        continue;
      }

      if (campo.kind === 'busca_tabela') {
        const [code, ...resto] = bruto.split('|');
        if (code === undefined || code === '') continue;
        const display = resto.join('|');
        const usaCid = campo.refSource === 'CID10' || campo.refSource === 'CID11';
        if (usaCid && i.competenciaCid.trim() === '') {
          throw new Error('competencia_terminologica_ausente');
        }
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: display === '' ? null : display,
          terminologyVersion: i.competenciaCid.trim() === '' ? null : i.competenciaCid,
          value: { slot: 'value_ref_code', source: campo.refSource ?? '', code },
        });
        if (usaCid) {
          diagnoses.push({
            codeSystem: campo.refSource as 'CID10' | 'CID11',
            code,
            displaySnapshot: display,
            terminologyVersion: i.competenciaCid,
            isPrincipal: diagnoses.length === 0,
          });
        }
        continue;
      }

      if (campo.kind === 'numerico' || campo.kind === 'imc' || campo.kind === 'dpp_ig') {
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: null,
          terminologyVersion: null,
          value: { slot: 'value_num', num: bruto },
        });
        if (campo.observationCode !== null) {
          observations.push({
            fieldId: campo.fieldId,
            observationCode: campo.observationCode,
            valueNum: bruto,
            unit: campo.unit,
            componentOrdinal: 1,
          });
        }
        continue;
      }

      if (campo.kind === 'booleano') {
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: null,
          terminologyVersion: null,
          value: { slot: 'value_bool', bool: bruto === 'true' },
        });
        continue;
      }

      if (campo.kind === 'data') {
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: null,
          terminologyVersion: null,
          value: { slot: 'value_date', date: bruto },
        });
        continue;
      }

      if (
        campo.kind === 'odontograma'
        || campo.kind === 'curva_crescimento'
        || campo.kind === 'oculos'
        || campo.kind === 'orcamento'
      ) {
        fields.push({
          ...base,
          ordinal,
          displaySnapshot: null,
          terminologyVersion: null,
          value: { slot: 'value_json', json: jsonClinico(bruto, campo.code) },
        });
        continue;
      }

      fields.push({
        ...base,
        ordinal,
        displaySnapshot: null,
        terminologyVersion: null,
        value: { slot: 'value_text', text: bruto },
      });
    }
  }

  if (!achouEvolucao) {
    throw new Error('prontuario_sem_campo_de_evolucao');
  }

  return { fields, diagnoses, observations, findings, procedures: [], ai: [] };
}
