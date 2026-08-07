// packages/tiss/src/project-guia.test.ts
import { describe, expect, it } from 'vitest';
import type { ProjectionResult, ProjectionError } from './project-guia';
import { ok, err, isOk, isErr, type Result } from '@cadencia/kernel';

describe('tipos de projectGuiaConsulta', () => {
  it('Result.ok com projecao completa carrega guiaId e status completa', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'projected',
      guiaId: '00000000-0000-0000-0000-000000000001',
      numeroGuia: '1',
      status: 'completa',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('projected');
      if (r.value.kind === 'projected') {
        expect(r.value.status).toBe('completa');
      }
    }
  });

  it('Result.ok com skip quando atendimento e particular', () => {
    const r: Result<ProjectionResult, ProjectionError> = ok({
      kind: 'skipped',
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.kind).toBe('skipped');
    }
  });

  it('Result.err com lista de campos ausentes quando dados obrigatorios faltam', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'dados_obrigatorios_ausentes',
      guiaId: '00000000-0000-0000-0000-000000000002',
      missingFields: ['numero_carteira', 'cnes'],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('dados_obrigatorios_ausentes');
      if (r.error.kind === 'dados_obrigatorios_ausentes') {
        expect(r.error.missingFields).toContain('numero_carteira');
      }
    }
  });

  it('Result.err com tuss_nao_vigente quando procedimento nao existe na TUSS', () => {
    const r: Result<ProjectionResult, ProjectionError> = err({
      kind: 'tuss_nao_vigente',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      dataAtendimento: '2026-08-01',
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe('tuss_nao_vigente');
    }
  });
});
