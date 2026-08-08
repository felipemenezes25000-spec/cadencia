// packages/authz/src/actions-tiss.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS (Fase 4)', () => {
  // NOTA: tiss.operadora.manage foi desmembrado em .read/.write pelo Bloco 01.
  // Testamos .write aqui como representante; .read ja e coberto em actions-fase4.test.ts.
  const tissKeys = [
    'tiss.operadora.write',
    'tiss.guia.read',
    'tiss.guia.adjust',
    'tiss.lote.manage',
    'tiss.lote.send',
  ];

  it.each(tissKeys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.operadora.write so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.write')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.guia.read permite admin_clinico, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('tiss.guia.adjust so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.adjust')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.lote.manage permite admin_clinico, recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.lote.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao TISS exige MFA', () => {
    for (const key of tissKeys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
