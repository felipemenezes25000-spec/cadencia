import { describe, expect, it } from 'vitest';
import { canonicalize } from '@cadencia/kernel';
import { buildCanonicalVersion, hashCanonicalVersion, type VersionSnapshot } from './canonical-version';

const SNAPSHOT: VersionSnapshot = {
  encounterId: '0198f2a0-0003-7000-8000-000000000001',
  patientId: '0198f2a0-0004-7000-8000-000000000001',
  professionalId: '0198f2a0-0005-7000-8000-000000000001',
  clinicId: '0198f2a0-0006-7000-8000-000000000001',
  occurredAt: '2026-08-03T17:30:00.000Z',
  occurredDate: '2026-08-03',
  versionNo: 1,
  kind: 'original',
  supersedesVersionId: null,
  justificativa: null,
  authorUserId: '0198f2a0-0007-7000-8000-000000000001',
  authorProfessionalId: '0198f2a0-0005-7000-8000-000000000001',
  cosignerProfessionalId: null,
  incompleto: false,
  fields: [
    { fieldId: '0198f2a0-0008-7000-8000-000000000001', fieldGeneration: 1,
      labelSnapshot: 'Queixa principal', sectionInstance: 1, ordinal: 0,
      displaySnapshot: null, terminologyVersion: null,
      value: { slot: 'value_text', text: 'cefaleia ha 3 dias' } },
    { fieldId: '0198f2a0-0009-7000-8000-000000000001', fieldGeneration: 2,
      labelSnapshot: 'Pressao arterial', sectionInstance: 1, ordinal: 1,
      displaySnapshot: null, terminologyVersion: null,
      value: { slot: 'value_num', num: '120' } },
  ],
  diagnoses: [
    { codeSystem: 'CID10', code: 'I10', displaySnapshot: 'Hipertensao essencial',
      terminologyVersion: '2026-01', isPrincipal: true },
  ],
  observations: [
    { fieldId: '0198f2a0-0000-7000-8000-0000000000pa'.replace('pa', 'aa'),
      observationCode: 'PA_SIS', valueNum: '120', unit: 'mmHg', componentOrdinal: 1 },
    { fieldId: '0198f2a0-0000-7000-8000-0000000000pa'.replace('pa', 'aa'),
      observationCode: 'PA_DIA', valueNum: '80', unit: 'mmHg', componentOrdinal: 2 },
  ],
  findings: [
    { fieldCode: 'comorbidades', optionCode: 'Hipertensao',
      displaySnapshot: 'Hipertensao', ordinal: 0 },
  ],
  procedures: [
    { codeSystem: 'TUSS', tabela: 22, code: '10101012',
      displaySnapshot: 'Consulta em consultorio', terminologyVersion: '202607',
      quantidade: 1, valorCentavos: 25000 },
  ],
  ai: [
    { provider: 'fake', modelId: 'fake-1', modelVersion: '2026.08', purpose: 'sugestao_cid',
      riskClass: 'IIa', residency: 'br', inputHash: 'a'.repeat(64), outputHash: 'b'.repeat(64),
      clinicianDecision: 'aceito_com_edicao' },
  ],
};

describe('payload canonico da versao', () => {
  it('carimba o esquema e a versao do canonicalizador', () => {
    const p = buildCanonicalVersion(SNAPSHOT);
    expect(p.schema).toBe('cadencia.encounter_version');
    expect(p.canonicalVersion).toBe('jcs-1');
  });

  it('NAO inclui live, head_version_id nem version_count', () => {
    const texto = canonicalize(buildCanonicalVersion(SNAPSHOT));
    expect(texto).not.toContain('"live"');
    expect(texto).not.toContain('headVersionId');
    expect(texto).not.toContain('versionCount');
  });

  it('inclui o output_hash da IA — sem ele nao se prova o que a IA produziu', () => {
    expect(canonicalize(buildCanonicalVersion(SNAPSHOT))).toContain('b'.repeat(64));
  });

  it('e estavel: a ordem de entrada das listas nao muda o hash', () => {
    const invertido: VersionSnapshot = {
      ...SNAPSHOT,
      observations: [...SNAPSHOT.observations].reverse(),
      fields: [...SNAPSHOT.fields].reverse(),
    };
    expect(hashCanonicalVersion(invertido).toString('hex'))
      .toBe(hashCanonicalVersion(SNAPSHOT).toString('hex'));
  });

  it('VETOR CONGELADO — este hash NUNCA muda; se mudar, e versao nova do canonicalizador', () => {
    // Gravado na execucao da Task 18. Alterar este literal invalida a verificacao
    // de TODO o acervo assinado. Se a canonicalizacao precisar mudar, o caminho e
    // CANONICAL_VERSION = 'jcs-2' com o verificador 'jcs-1' mantido para sempre.
    expect(hashCanonicalVersion(SNAPSHOT).toString('hex'))
      .toBe('fd29e08f1700c53e9e02b7e5a90e7081ba78d4ef7ddb0bddd0570754212f21b8');
  });

  it('mudar UM caractere do texto clinico muda o hash', () => {
    const outro: VersionSnapshot = {
      ...SNAPSHOT,
      fields: SNAPSHOT.fields.map((f, i) =>
        i === 0 ? { ...f, value: { slot: 'value_text', text: 'cefaleia ha 4 dias' } as const } : f),
    };
    expect(hashCanonicalVersion(outro).toString('hex'))
      .not.toBe(hashCanonicalVersion(SNAPSHOT).toString('hex'));
  });
});
