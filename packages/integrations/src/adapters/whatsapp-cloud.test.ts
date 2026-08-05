// packages/integrations/src/adapters/whatsapp-cloud.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyWhatsAppWebhook,
  parseWhatsAppInbound,
  buildSendPayload,
  buildTemplateSendPayload,
} from './whatsapp-cloud';
import type { InboundMessage, StatusUpdate } from '../contracts/messaging';

const APP_SECRET = 'test-app-secret-1234';

describe('WhatsApp Cloud API — webhook e parsing', () => {
  it('verifyWhatsAppWebhook aceita assinatura HMAC-SHA256 valida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: true });
  });

  it('verifyWhatsAppWebhook rejeita assinatura invalida', () => {
    const payload = Buffer.from('{"entry":[]}');
    const headers = { 'x-hub-signature-256': 'sha256=invalido' };
    expect(verifyWhatsAppWebhook(payload, headers, APP_SECRET))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('verifyWhatsAppWebhook rejeita quando header ausente', () => {
    const payload = Buffer.from('{"entry":[]}');
    expect(verifyWhatsAppWebhook(payload, {}, APP_SECRET))
      .toEqual({ valid: false, reason: 'header x-hub-signature-256 ausente' });
  });

  it('parseWhatsAppInbound extrai mensagem de texto', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.HBgN',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Boa tarde, confirmo a consulta' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.kind).toBe('message');
    expect(msg.providerMessageId).toBe('wamid.HBgN');
    expect(msg.from).toBe('+5511999887766');
    expect(msg.body).toEqual({ kind: 'text', text: 'Boa tarde, confirmo a consulta' });
  });

  it('parseWhatsAppInbound extrai mensagem de imagem com caption', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.IMG1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'image',
              image: { id: 'media-img-1', mime_type: 'image/jpeg', caption: 'exame de sangue' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('image');
    if (msg.body.kind === 'image') {
      expect(msg.body.providerMediaId).toBe('media-img-1');
      expect(msg.body.caption).toBe('exame de sangue');
    }
  });

  it('parseWhatsAppInbound extrai mensagem de audio', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.AUD1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'audio',
              audio: { id: 'media-aud-1', mime_type: 'audio/ogg; codecs=opus' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('audio');
  });

  it('parseWhatsAppInbound extrai mensagem de documento', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.DOC1',
              from: '5511999887766',
              timestamp: '1722772800',
              type: 'document',
              document: { id: 'media-doc-1', mime_type: 'application/pdf', filename: 'laudo.pdf' },
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const msg = events[0] as InboundMessage;
    expect(msg.body.kind).toBe('document');
    if (msg.body.kind === 'document') {
      expect(msg.body.filename).toBe('laudo.pdf');
    }
  });

  it('parseWhatsAppInbound extrai status updates', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [
              { id: 'wamid.S1', status: 'sent', timestamp: '1722772800' },
              { id: 'wamid.S1', status: 'delivered', timestamp: '1722772801' },
              { id: 'wamid.S1', status: 'read', timestamp: '1722772805' },
            ],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(3);
    expect((events[0] as StatusUpdate).status).toBe('sent');
    expect((events[1] as StatusUpdate).status).toBe('delivered');
    expect((events[2] as StatusUpdate).status).toBe('read');
  });

  it('parseWhatsAppInbound extrai status failed com codigo de erro', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.F1', status: 'failed', timestamp: '1722772800',
              errors: [{ code: 131026, title: 'Message Undeliverable' }],
            }],
          },
        }],
      }],
    }));
    const events = parseWhatsAppInbound(raw);
    expect(events).toHaveLength(1);
    const st = events[0] as StatusUpdate;
    expect(st.status).toBe('failed');
    expect(st.errorCode).toBe('131026');
    expect(st.errorDetail).toBe('Message Undeliverable');
  });

  it('parseWhatsAppInbound devolve array vazio para payload sem mensagens', () => {
    const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('parseWhatsAppInbound ignora tipos de mensagem desconhecidos', () => {
    const raw = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.UNK', from: '5511999887766', timestamp: '1722772800',
              type: 'sticker', sticker: { id: 'stk-1' },
            }],
          },
        }],
      }],
    }));
    expect(parseWhatsAppInbound(raw)).toEqual([]);
  });

  it('buildSendPayload monta o corpo para envio de texto via Cloud API', () => {
    const payload = buildSendPayload('+5511987654321', { kind: 'text', text: 'Ola, bom dia!' });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'text',
      text: { preview_url: false, body: 'Ola, bom dia!' },
    });
  });

  it('buildTemplateSendPayload monta o corpo para envio de template', () => {
    const payload = buildTemplateSendPayload('+5511987654321', {
      kind: 'template',
      templateName: 'confirmacao_consulta',
      language: 'pt_BR',
      variables: ['Maria', '14/08/2026', '10:00'],
    });
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5511987654321',
      type: 'template',
      template: {
        name: 'confirmacao_consulta',
        language: { code: 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '14/08/2026' },
            { type: 'text', text: '10:00' },
          ],
        }],
      },
    });
  });
});
