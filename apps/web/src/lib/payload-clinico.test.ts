import { describe, expect, it } from 'vitest';
import { montarPayloadClinico } from './payload-clinico';
import type { SecaoDaFicha } from './ficha-tipos';

const SECOES: SecaoDaFicha[] = [
  {
    sectionId: 's0', code: 'evolucao', label: 'Evolucao',
    campos: [{
      fieldId: 'f-evo', code: 'evolucao', label: 'Evolucao clinica',
      kind: 'texto_longo', generation: 1, required: false,
      unit: null, options: null, refSource: null, observationCode: null, componentes: [],
    }],
  },
  {
    sectionId: 's1', code: 'antecedentes', label: 'Antecedentes',
    campos: [{
      fieldId: 'f-alergias', code: 'alergias', label: 'Alergias',
      kind: 'texto_curto', generation: 1, required: false,
      unit: null, options: null, refSource: null, observationCode: null, componentes: [],
    }],
  },
  {
    sectionId: 's2', code: 'sinais_vitais', label: 'Sinais vitais',
    campos: [
      {
        fieldId: 'f-peso', code: 'peso', label: 'Peso', kind: 'numerico',
        generation: 1, required: false, unit: 'kg', options: null,
        refSource: null, observationCode: 'PESO', componentes: [],
      },
      {
        fieldId: 'f-pa', code: 'pa', label: 'Pressao arterial', kind: 'composto',
        generation: 1, required: false, unit: null, options: null,
        refSource: null, observationCode: null,
        componentes: [
          { ordinal: 1, label: 'Sistolica', unit: 'mmHg', observationCode: 'PA_SIS' },
          { ordinal: 2, label: 'Diastolica', unit: 'mmHg', observationCode: 'PA_DIA' },
        ],
      },
    ],
  },
  {
    sectionId: 's3', code: 'hipoteses', label: 'Hipoteses',
    campos: [{
      fieldId: 'f-cid', code: 'cid', label: 'CID-10', kind: 'busca_tabela',
      generation: 1, required: false, unit: null, options: null,
      refSource: 'CID10', observationCode: null, componentes: [],
    }],
  },
];

describe('montagem do payload clínico', () => {
  it('a evolução do EDITOR entra como campo, e a ficha não a duplica', () => {
    const p = montarPayloadClinico({
      secoes: SECOES, valores: {}, evolucao: 'Paciente refere melhora.',
      competenciaCid: '202501',
    });
    const evo = p.fields.filter((f) => f.fieldId === 'f-evo');
    // Duas caixas para a mesma coisa fariam o médico escrever numa e a outra
    // sobrescrever com vazio na hora de selar.
    expect(evo).toHaveLength(1);
    expect(evo[0]?.value).toEqual({ slot: 'value_text', text: 'Paciente refere melhora.' });
  });

  it('campo vazio não vira linha — versão selada não guarda branco', () => {
    const p = montarPayloadClinico({
      secoes: SECOES, valores: { 'f-alergias': '   ' }, evolucao: 'x',
      competenciaCid: '202501',
    });
    expect(p.fields.some((f) => f.fieldId === 'f-alergias')).toBe(false);
  });

  it('numérico vira campo E observação — é a observação que faz gráfico existir', () => {
    const p = montarPayloadClinico({
      secoes: SECOES, valores: { 'f-peso': '72.4' }, evolucao: 'x',
      competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-peso')?.value)
      .toEqual({ slot: 'value_num', num: '72.4' });
    // Número como STRING de ponta a ponta: "70.50" e "70.5" são valores
    // diferentes na tela e precisam de hashes diferentes (§4.3).
    expect(p.observations).toContainEqual({
      // fieldId acompanha: `clin.observation.field_id` é NOT NULL porque a
      // observação é projeção de um campo, e sem a origem não dá para
      // reprojetar quando o atendimento for retificado.
      fieldId: 'f-peso',
      observationCode: 'PESO', valueNum: '72.4', unit: 'kg', componentOrdinal: 1,
    });
  });

  it('composto NÃO vira campo — vira uma observação por componente', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-pa:PA_SIS': '120', 'f-pa:PA_DIA': '80' },
      evolucao: 'x', competenciaCid: '202501',
    });
    // FIELD_KINDS diz `slot: null` para composto: o campo em si não tem valor,
    // quem carrega o dado são os componentes.
    expect(p.fields.some((f) => f.fieldId === 'f-pa')).toBe(false);
    expect(p.observations).toContainEqual({
      fieldId: 'f-pa',
      observationCode: 'PA_SIS', valueNum: '120', unit: 'mmHg', componentOrdinal: 1,
    });
    expect(p.observations).toContainEqual({
      fieldId: 'f-pa',
      observationCode: 'PA_DIA', valueNum: '80', unit: 'mmHg', componentOrdinal: 2,
    });
  });

  it('só a sistólica preenchida não inventa a diastólica', () => {
    const p = montarPayloadClinico({
      secoes: SECOES, valores: { 'f-pa:PA_SIS': '120' }, evolucao: 'x',
      competenciaCid: '202501',
    });
    expect(p.observations.filter((o) => o.observationCode.startsWith('PA_')))
      .toHaveLength(1);
  });

  it('CID vira campo codificado E diagnóstico, com a competência do catálogo', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-cid': 'J06.9|Infeccao aguda das vias aereas superiores' },
      evolucao: 'x', competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-cid')?.value)
      .toEqual({ slot: 'value_ref_code', source: 'CID10', code: 'J06.9' });
    expect(p.diagnoses).toEqual([{
      codeSystem: 'CID10', code: 'J06.9',
      displaySnapshot: 'Infeccao aguda das vias aereas superiores',
      // A versão vem do catálogo. Fixar '2025' aqui seria afirmar em prontuário
      // uma versão de terminologia que ninguém conferiu.
      terminologyVersion: '202501', isPrincipal: true,
    }]);
    expect(p.fields.find((f) => f.fieldId === 'f-cid')?.displaySnapshot)
      .toBe('Infeccao aguda das vias aereas superiores');
  });

  it('CID-11 também vira diagnóstico, marcada como CID11', () => {
    // A partir de 2027 a ficha pode ter um campo com `refSource: 'CID11'`. Sem
    // este ramo, o código entraria como campo codificado e NÃO viraria
    // diagnóstico: o prontuário ficaria com a hipótese escrita e a lista de
    // diagnósticos vazia, e nenhuma tela mostraria a diferença.
    const secaoCid11 = {
      ...SECOES[3]!,
      campos: [{ ...SECOES[3]!.campos[0]!, refSource: 'CID11', label: 'CID-11' }],
    };
    const p = montarPayloadClinico({
      secoes: [SECOES[0]!, secaoCid11],
      valores: { 'f-cid': 'ZZ90|Termo sintetico de teste' },
      evolucao: 'x', competenciaCid: '202701',
    });
    expect(p.diagnoses).toEqual([{
      // `clin.diagnosis` tem CHECK (code_system IN ('CID10','CID11')). Gravar
      // com o sistema errado não daria erro: daria um diagnóstico de 2027
      // catalogado como CID-10, impossível de reconciliar depois.
      codeSystem: 'CID11', code: 'ZZ90',
      displaySnapshot: 'Termo sintetico de teste',
      terminologyVersion: '202701', isPrincipal: true,
    }]);
  });

  it('sem campo de evolução configurado, avisa em vez de selar vazio', () => {
    expect(() => montarPayloadClinico({
      secoes: [SECOES[1]!], valores: {}, evolucao: 'texto',
      competenciaCid: '202501',
    })).toThrow(/evolucao/i);
  });
});
