import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('catalogo de acoes — mensageria e pagamento', () => {
  const ESPERADAS = [
    'messaging.conversation.read',
    'messaging.message.read',
    'messaging.message.write',
    'messaging.template.read',
    'messaging.template.write',
    'messaging.automation.write',
    'payment.read',
    'payment.write',
    'payment.refund',
    'payment.link.write',
  ];

  it.each(ESPERADAS)('acao %s existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('recepcao pode ver conversas e registrar pagamento', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const msgRead = ACTION_BY_KEY.get('messaging.message.read')!;
    const payWrite = ACTION_BY_KEY.get('payment.write')!;
    expect(convRead.roles).toContain('recepcao');
    expect(msgRead.roles).toContain('recepcao');
    expect(payWrite.roles).toContain('recepcao');
  });

  it('profissional pode ver conversas mas nao configurar automacoes', () => {
    const convRead = ACTION_BY_KEY.get('messaging.conversation.read')!;
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    expect(convRead.roles).toContain('profissional');
    expect(autoWrite.roles).not.toContain('profissional');
  });

  it('admin pode configurar automacoes e templates', () => {
    const autoWrite = ACTION_BY_KEY.get('messaging.automation.write')!;
    const tplWrite = ACTION_BY_KEY.get('messaging.template.write')!;
    expect(autoWrite.roles).toContain('admin_clinico');
    expect(tplWrite.roles).toContain('admin_clinico');
  });

  it('estorno exige papel financeiro ou admin', () => {
    const refund = ACTION_BY_KEY.get('payment.refund')!;
    expect(refund.roles).toContain('admin_clinico');
    expect(refund.roles).toContain('financeiro');
    expect(refund.roles).not.toContain('recepcao');
  });

  it('nao ha chaves duplicadas no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('acoes da Fase 3', () => {
  const fase3Keys = [
    'finance.settings',
    'finance.write',
    'finance.repasse',
    'inventory.read',
    'inventory.write',
    'report.read',
  ];

  it.each(fase3Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('finance.settings exige papel financeiro ou admin_clinico', () => {
    const action = ACTION_BY_KEY.get('finance.settings')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('finance.write permite recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('finance.write')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
  });

  it('finance.repasse exige MFA', () => {
    const action = ACTION_BY_KEY.get('finance.repasse')!;
    expect(action.requiresMfa).toBe(true);
  });

  it('inventory.read permite profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('inventory.read')!;
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('report.read permite financeiro e diretor_tecnico', () => {
    const action = ACTION_BY_KEY.get('report.read')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('diretor_tecnico');
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
