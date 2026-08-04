import { describe, expect, it } from 'vitest';
import {
  CANONICAL_VERSION, canonicalBytes, canonicalHashHex, canonicalize, type JsonValue,
} from './canonical';
import { ValidationError } from './errors';

// Vetores CONGELADOS. Alterar qualquer linha daqui invalida a verificacao de
// todo o historico assinado. Se o comportamento precisar mudar: 'jcs-2'.
const VETORES: readonly { readonly nome: string; readonly entrada: JsonValue; readonly canonico: string }[] = [
  {
    nome: 'ordem de chaves por unidade de codigo UTF-16',
    entrada: { b: 1, a: 2, 'ä': 3, A: 4, '10': 5, '2': 6 },
    canonico: '{"10":5,"2":6,"A":4,"a":2,"b":1,"ä":3}',
  },
  {
    nome: 'array preserva a ordem de insercao (array nunca e ordenado)',
    entrada: { lista: [3, 1, 2], vazio: {}, nulo: null, ok: true },
    canonico: '{"lista":[3,1,2],"nulo":null,"ok":true,"vazio":{}}',
  },
  {
    nome: 'numeros no formato ECMAScript exigido pela RFC 8785',
    entrada: [0, -0, 1, 1.5, 1e30, 1e-7, 0.000001, 5e-324, 9007199254740991],
    canonico: '[0,0,1,1.5,1e+30,1e-7,0.000001,5e-324,9007199254740991]',
  },
  {
    nome: 'escape minimo: so aspas, contrabarra e caracteres de controle',
    entrada: { t: 'a"b\\c\nd\tef' },
    canonico: '{"t":"a\\"b\\\\c\\nd\\tef"}',
  },
  {
    nome: 'acentuacao sai como UTF-8 literal, sem sequencia \\u',
    entrada: { nome: 'Jos\u00E9 da Silva' },
    canonico: '{"nome":"Jos\u00E9 da Silva"}',
  },
];

// 'e' precomposto = U+00E9. 'e' + U+0301 (acento combinante) e a forma que chega
// de planilha e de importacao de outro sistema. Escritos com escape \u de proposito:
// a diferenca e INVISIVEL no editor, e um arquivo normalizado por engano apagaria
// este teste sem ninguem perceber.
const NOME_PRECOMPOSTO: string = 'Jos\u00E9 da Silva';
const NOME_DECOMPOSTO: string = 'Jose\u0301 da Silva';

// Atendimento canonico congelado — os campos que entram no content_hash (§3.4).
const ATENDIMENTO: JsonValue = {
  canonicalVersion: 'jcs-1',
  clinicId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c',
  fields: [
    { code: 'PA_SIS', ordinal: 0, value: 120 },
    { code: 'PA_DIA', ordinal: 1, value: 80 },
    { code: 'QUEIXA', ordinal: 2, value: 'Cefaleia há 3 dias' },
  ],
  occurredAt: '2026-08-03T13:45:00.000Z',
  patientId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d',
  professionalId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e',
};

const ATENDIMENTO_CANONICO =
  '{"canonicalVersion":"jcs-1","clinicId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c",' +
  '"fields":[{"code":"PA_SIS","ordinal":0,"value":120},{"code":"PA_DIA","ordinal":1,"value":80},' +
  '{"code":"QUEIXA","ordinal":2,"value":"Cefaleia há 3 dias"}],' +
  '"occurredAt":"2026-08-03T13:45:00.000Z",' +
  '"patientId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d",' +
  '"professionalId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e"}';

const ATENDIMENTO_SHA256 = '0e8fb87ba8007a7d6f6f72e3ce331da212609d6bf764c9ed36565fe3083131a3';

describe('canonicalizacao JCS', () => {
  it('a versao do canonicalizador e jcs-1 e nunca muda: e ela que fica gravada em cada assinatura', () => {
    expect(CANONICAL_VERSION).toBe('jcs-1');
  });

  for (const vetor of VETORES) {
    it(`vetor congelado: ${vetor.nome}`, () => {
      expect(canonicalize(vetor.entrada)).toBe(vetor.canonico);
    });
  }

  it('normaliza Unicode para NFC: o mesmo nome digitado no consultorio e importado de planilha produz o MESMO hash', () => {
    expect(NOME_PRECOMPOSTO === NOME_DECOMPOSTO).toBe(false);   // sao strings diferentes...
    expect(canonicalize({ nome: NOME_DECOMPOSTO })).toBe('{"nome":"Jos\u00E9 da Silva"}');
    expect(canonicalHashHex({ nome: NOME_DECOMPOSTO }))
      .toBe(canonicalHashHex({ nome: NOME_PRECOMPOSTO }));      // ...e o mesmo prontuario
    expect(canonicalHashHex({ nome: NOME_PRECOMPOSTO }))
      .toBe('27e45a5ae17c164636b9536ff616696b6683e2d40178fdee80498352051ed65c');
  });

  it('normaliza tambem a CHAVE antes de ordenar', () => {
    const decomposta: JsonValue = { ['pressa\u0303o']: 1 };     // 'a' + U+0303
    expect(canonicalize(decomposta)).toBe('{"press\u00E3o":1}');
  });

  it('recusa duas chaves que viram a mesma apos NFC: ambiguidade no hash e inaceitavel', () => {
    const ambiguo = { ['press\u00E3o']: 1, ['pressa\u0303o']: 2 } as JsonValue;
    expect(Object.keys(ambiguo as Record<string, JsonValue>)).toHaveLength(2);               // o objeto REALMENTE tem duas chaves
    expect(() => canonicalize(ambiguo)).toThrow(ValidationError);
  });

  it('congela o hash do atendimento canonico: mudou este valor, mudou o contrato de assinatura de todo o acervo', () => {
    expect(canonicalize(ATENDIMENTO)).toBe(ATENDIMENTO_CANONICO);
    expect(canonicalBytes(ATENDIMENTO)).toHaveLength(379);
    expect(canonicalHashHex(ATENDIMENTO)).toBe(ATENDIMENTO_SHA256);
  });

  it('a ordem em que os campos chegam do formulario nao muda o hash', () => {
    const embaralhado: JsonValue = {
      professionalId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e',
      patientId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d',
      occurredAt: '2026-08-03T13:45:00.000Z',
      fields: [
        { ordinal: 0, value: 120, code: 'PA_SIS' },
        { value: 80, code: 'PA_DIA', ordinal: 1 },
        { code: 'QUEIXA', value: 'Cefaleia há 3 dias', ordinal: 2 },
      ],
      clinicId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c',
      canonicalVersion: 'jcs-1',
    };
    expect(canonicalHashHex(embaralhado)).toBe(ATENDIMENTO_SHA256);
  });

  it('recusa o que nao e JSON: undefined, NaN, Infinity e Date sumiriam ou mudariam em silencio', () => {
    expect(() => canonicalize({ a: undefined } as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(Number.NaN as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(new Date() as unknown as JsonValue)).toThrow(ValidationError);
  });
});
