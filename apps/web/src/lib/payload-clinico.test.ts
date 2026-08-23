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
    campos: [
      {
        fieldId: 'f-alergias', code: 'alergias', label: 'Alergias',
        kind: 'texto_curto', generation: 1, required: false,
        unit: null, options: null, refSource: null, observationCode: null, componentes: [],
      },
      {
        fieldId: 'f-tabagismo', code: 'tabagismo', label: 'Tabagismo',
        kind: 'lista_unica', generation: 1, required: false,
        unit: null, options: ['Nunca fumou', 'Ex-tabagista', 'Tabagista'],
        refSource: null, observationCode: null, componentes: [],
      },
      {
        fieldId: 'f-comorbidades', code: 'comorbidades', label: 'Comorbidades',
        kind: 'multipla_escolha', generation: 1, required: false,
        unit: null, options: ['Hipertensao', 'Diabetes', 'Asma', 'Nenhuma'],
        refSource: null, observationCode: null, componentes: [],
      },
    ],
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
        fieldId: 'f-altura', code: 'altura', label: 'Altura', kind: 'numerico',
        generation: 1, required: false, unit: 'cm', options: null,
        refSource: null, observationCode: 'ALTURA', componentes: [],
      },
      {
        fieldId: 'f-imc', code: 'imc', label: 'IMC', kind: 'imc',
        generation: 1, required: false, unit: 'kg/m2', options: null,
        refSource: null, observationCode: 'IMC', componentes: [],
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
  {
    sectionId: 's4', code: 'odonto', label: 'Odontologia',
    campos: [{
      fieldId: 'f-odonto', code: 'odontograma', label: 'Odontograma', kind: 'odontograma',
      generation: 1, required: false, unit: null, options: null,
      refSource: null, observationCode: null, componentes: [],
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

  it('campo obrigatório vazio bloqueia a selagem', () => {
    const obrigatoria: SecaoDaFicha = {
      ...SECOES[1]!,
      campos: [{ ...SECOES[1]!.campos[0]!, required: true }],
    };
    expect(() => montarPayloadClinico({
      secoes: [SECOES[0]!, obrigatoria], valores: {}, evolucao: 'x', competenciaCid: '202501',
    })).toThrow('campo_obrigatorio:alergias');
  });

  it('numérico vira campo E observação e aceita vírgula decimal brasileira', () => {
    const p = montarPayloadClinico({
      secoes: SECOES, valores: { 'f-peso': '72,40' }, evolucao: 'x',
      competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-peso')?.value)
      .toEqual({ slot: 'value_num', num: '72.40' });
    expect(p.observations).toContainEqual({
      fieldId: 'f-peso',
      observationCode: 'PESO', valueNum: '72.40', unit: 'kg', componentOrdinal: 1,
    });
  });

  it('recusa número inválido antes de chegar ao cast numeric do PostgreSQL', () => {
    expect(() => montarPayloadClinico({
      secoes: SECOES, valores: { 'f-peso': 'setenta' }, evolucao: 'x',
      competenciaCid: '202501',
    })).toThrow('campo_numerico_invalido:peso');
  });

  it('IMC é derivado de peso/altura e ignora valor adulterado do cliente', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-peso': '72,4', 'f-altura': '170', 'f-imc': '999' },
      evolucao: 'x', competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-imc')?.value)
      .toEqual({ slot: 'value_num', num: '25.05' });
    expect(p.observations).toContainEqual({
      fieldId: 'f-imc', observationCode: 'IMC', valueNum: '25.05',
      unit: 'kg/m2', componentOrdinal: 1,
    });
  });

  it('composto NÃO vira campo — vira uma observação por componente', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-pa:PA_SIS': '120', 'f-pa:PA_DIA': '80' },
      evolucao: 'x', competenciaCid: '202501',
    });
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

  it('lista única vira referência e achado clínico consultável', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-tabagismo': 'Ex-tabagista' },
      evolucao: 'x', competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-tabagismo')).toMatchObject({
      displaySnapshot: 'Ex-tabagista',
      value: { slot: 'value_ref_code', source: 'FIELD_OPTION:tabagismo', code: 'Ex-tabagista' },
    });
    expect(p.findings).toContainEqual({
      fieldCode: 'tabagismo', optionCode: 'Ex-tabagista',
      displaySnapshot: 'Ex-tabagista', ordinal: 0,
    });
  });

  it('múltipla escolha vira uma linha e um achado por opção marcada', () => {
    const p = montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-comorbidades': 'Hipertensao|Diabetes' },
      evolucao: 'x', competenciaCid: '202501',
    });
    expect(p.fields.filter((f) => f.fieldId === 'f-comorbidades')).toHaveLength(2);
    expect(p.findings).toEqual([
      { fieldCode: 'comorbidades', optionCode: 'Hipertensao', displaySnapshot: 'Hipertensao', ordinal: 0 },
      { fieldCode: 'comorbidades', optionCode: 'Diabetes', displaySnapshot: 'Diabetes', ordinal: 1 },
    ]);
  });

  it('odontograma é JSON clínico, não texto opaco', () => {
    const json = JSON.stringify({ '11': { status: 'carie' } });
    const p = montarPayloadClinico({
      secoes: SECOES, valores: { 'f-odonto': json }, evolucao: 'x', competenciaCid: '202501',
    });
    expect(p.fields.find((f) => f.fieldId === 'f-odonto')?.value)
      .toEqual({ slot: 'value_json', json: { '11': { status: 'carie' } } });
  });

  it('JSON clínico inválido bloqueia a finalização em vez de corromper o slot', () => {
    expect(() => montarPayloadClinico({
      secoes: SECOES, valores: { 'f-odonto': '{quebrado' },
      evolucao: 'x', competenciaCid: '202501',
    })).toThrow('campo_json_invalido:odontograma');
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
      terminologyVersion: '202501', isPrincipal: true,
    }]);
  });

  it('não sela CID sem a competência da terminologia', () => {
    expect(() => montarPayloadClinico({
      secoes: SECOES,
      valores: { 'f-cid': 'J06.9|Infeccao aguda das vias aereas superiores' },
      evolucao: 'x', competenciaCid: '',
    })).toThrow('competencia_terminologica_ausente');
  });

  it('CID-11 também vira diagnóstico, marcada como CID11', () => {
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
