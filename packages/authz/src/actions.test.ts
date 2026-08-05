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
