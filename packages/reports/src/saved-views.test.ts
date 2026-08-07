// packages/reports/src/saved-views.test.ts
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_VIEWS,
  getSavedView,
  validateCustomViewInput,
} from './saved-views';
import type { CustomViewInput } from './types';

describe('visoes salvas built-in', () => {
  it('contem exatamente 11 visoes', () => {
    expect(BUILT_IN_VIEWS).toHaveLength(11);
  });

  it('todas as visoes tem id, nome e sao built-in', () => {
    for (const v of BUILT_IN_VIEWS) {
      expect(v.id).toBeTruthy();
      expect(v.name).toBeTruthy();
      expect(v.builtIn).toBe(true);
    }
  });

  it('visao "Atendimentos realizados" usa view atendimentos com filtro de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Atendimentos realizados');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'realizado')).toBe(true);
  });

  it('visao "Pacientes para retorno" usa view atendimentos', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Pacientes para retorno');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
  });

  it('visao "Por periodo" usa view atendimentos sem filtro fixo de status', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por periodo');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.every((f) => f.column !== 'status')).toBe(true);
  });

  it('visao "Por CID" usa view atendimentos e agrupa por cid_code', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por CID');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.columns.groupBy).toBe('cid_code');
  });

  it('visao "Por indicacao" usa view pacientes e agrupa por referral_source', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Por indicacao');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.columns.groupBy).toBe('referral_source');
  });

  it('visao "Faltas" usa view atendimentos com filtro de status falta', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Faltas');
    expect(v).toBeDefined();
    expect(v!.view).toBe('atendimentos');
    expect(v!.filters.some((f) => f.column === 'status' && f.op === 'eq' && f.value === 'falta')).toBe(true);
  });

  it('visao "Analises financeiras" usa view financeiro', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Analises financeiras');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
  });

  it('visao "Repasse" usa view financeiro e agrupa por professional_name', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Repasse');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.columns.groupBy).toBe('professional_name');
  });

  it('visao "Fluxo de caixa" usa view financeiro com basis caixa', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Fluxo de caixa');
    expect(v).toBeDefined();
    expect(v!.view).toBe('financeiro');
    expect(v!.filters.some((f) => f.column === 'basis' && f.value === 'caixa')).toBe(true);
  });

  it('visao "Envios" usa view mensagens', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Envios');
    expect(v).toBeDefined();
    expect(v!.view).toBe('mensagens');
  });

  it('visao "Aniversariantes" usa view pacientes e ordena por birth_month_day', () => {
    const v = BUILT_IN_VIEWS.find((view) => view.name === 'Aniversariantes');
    expect(v).toBeDefined();
    expect(v!.view).toBe('pacientes');
    expect(v!.sort.some((s) => s.column === 'birth_month_day')).toBe(true);
  });
});

describe('getSavedView', () => {
  it('retorna visao por id quando existe', () => {
    const primeira = BUILT_IN_VIEWS[0]!;
    const result = getSavedView(primeira.id);
    expect(result).toEqual(primeira);
  });

  it('retorna undefined quando id nao existe', () => {
    expect(getSavedView('inexistente')).toBeUndefined();
  });
});

describe('validateCustomViewInput', () => {
  it('aceita input valido', () => {
    const input: CustomViewInput = {
      name: 'Minha visao',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(true);
  });

  it('rejeita nome vazio', () => {
    const input: CustomViewInput = {
      name: '',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['professional_name'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita view invalida', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'inexistente' as any,
      filters: [],
      columns: { visible: ['id'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejeita coluna com caractere invalido', () => {
    const input: CustomViewInput = {
      name: 'Teste',
      view: 'atendimentos',
      filters: [],
      columns: { visible: ['id; DROP'] },
      sort: [],
      chartKind: 'table',
    };
    const result = validateCustomViewInput(input);
    expect(result.ok).toBe(false);
  });
});
