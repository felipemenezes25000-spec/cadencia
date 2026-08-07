// packages/authz/src/actions-fase4.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type ActionDef } from './actions';

describe('acoes de TISS — Fase 4', () => {
  it('tiss.operadora.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.operadora.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.paciente_convenio.read existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('profissional');
    expect(action!.roles).toContain('recepcao');
  });

  it('tiss.paciente_convenio.write existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('recepcao');
  });

  it('nenhuma acao TISS exige MFA', () => {
    const tissActions = ACTIONS.filter((a) => a.key.startsWith('tiss.'));
    for (const action of tissActions) {
      expect((action as ActionDef).requiresMfa, `${action.key} nao deve exigir MFA`).toBeUndefined();
    }
  });
});
