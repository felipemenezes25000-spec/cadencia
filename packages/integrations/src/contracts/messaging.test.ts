// packages/integrations/src/contracts/messaging.test.ts
import { describe, expect, it } from 'vitest';
import type {
  OutboundBody, InboundEvent, InboundMessage, StatusUpdate,
} from './messaging';

describe('tipos do contrato MessagingProvider', () => {
  it('OutboundBody aceita texto simples', () => {
    const body: OutboundBody = { kind: 'text', text: 'Ola' };
    expect(body.kind).toBe('text');
    expect(body.text).toBe('Ola');
  });

  it('OutboundBody aceita template com variaveis', () => {
    const body: OutboundBody = {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08', '10:00'],
    };
    expect(body.kind).toBe('template');
    expect(body.variables).toHaveLength(3);
  });

  it('InboundEvent discrimina mensagem de status update', () => {
    const msg: InboundEvent = {
      kind: 'message',
      providerMessageId: 'wamid.abc',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'text', text: 'Confirmo' },
    } satisfies InboundMessage;
    expect(msg.kind).toBe('message');

    const status: InboundEvent = {
      kind: 'status',
      providerMessageId: 'wamid.abc',
      status: 'delivered',
      timestamp: '2026-08-04T10:00:01.000Z',
    } satisfies StatusUpdate;
    expect(status.kind).toBe('status');
  });

  it('InboundMessage aceita corpo de midia com providerMediaId', () => {
    const msg: InboundMessage = {
      kind: 'message',
      providerMessageId: 'wamid.xyz',
      from: '+5511987654321',
      timestamp: '2026-08-04T10:00:00.000Z',
      body: { kind: 'image', providerMediaId: 'media-123', mime: 'image/jpeg', caption: 'exame' },
    };
    expect(msg.body.kind).toBe('image');
  });

  it('StatusUpdate cobre sent, delivered, read e failed', () => {
    const statuses: StatusUpdate['status'][] = ['sent', 'delivered', 'read', 'failed'];
    expect(statuses).toHaveLength(4);
  });
});
