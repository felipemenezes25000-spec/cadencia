import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS Fase 5 (demonstrativo, glosa, recurso)', () => {
  const fase5Keys = [
    'tiss.demonstrativo.import',
    'tiss.demonstrativo.read',
    'tiss.glosa.read',
    'tiss.glosa.manage',
    'tiss.recurso.manage',
    'tiss.recurso.send',
  ];

  it.each(fase5Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.demonstrativo.import so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.import')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.demonstrativo.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao Fase 5 TISS exige MFA', () => {
    for (const key of fase5Keys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
