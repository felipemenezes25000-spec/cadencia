// packages/integrations/src/fakes/messaging-fake.test.ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeMessagingProvider } from './messaging-fake';
import { asE164, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'msg-1', deadlineMs: 3000,
};

const telefone = asE164('+5511987654321')!;

describe('provedor de mensageria falso', () => {
  it('declara channel whatsapp e supportsInbound true', () => {
    const p = createFakeMessagingProvider();
    expect(p.channel).toBe('whatsapp');
    expect(p.supportsInbound).toBe(true);
  });

  it('declara safety por metodo', () => {
    const p = createFakeMessagingProvider();
    expect(p.safety.registerChannelIdentity).toBe('idempotent');
    expect(p.safety.send).toBe('unsafe');
    expect(p.safety.findByIdempotencyKey).toBe('safe');
    expect(p.safety.verifyWebhook).toBe('safe');
    expect(p.safety.parseInbound).toBe('safe');
    expect(p.safety.fetchMedia).toBe('safe');
  });

  it('registerChannelIdentity devolve channelIdentityRef e status verified', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.registerChannelIdentity(ctx, {
      displayName: 'Clinica Exemplo',
      phone: telefone,
      wabaRef: 'waba-123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.channelIdentityRef).toContain('fake-identity');
      expect(r.value.status).toBe('verified');
    }
  });

  it('send grava a chamada e devolve providerMessageId', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: { kind: 'text', text: 'Lembrete de consulta' },
      conversationId: 'conv-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
    }
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body).toEqual({ kind: 'text', text: 'Lembrete de consulta' });
  });

  it('send com template grava templateName e variaveis', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-identity-1',
      to: telefone,
      body: {
        kind: 'template',
        templateName: 'confirmacao_consulta',
        language: 'pt_BR',
        variables: ['Maria', '14/08', '10:00'],
      },
      conversationId: 'conv-2',
    });
    expect(r.ok).toBe(true);
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body.kind).toBe('template');
  });

  it('findByIdempotencyKey devolve null quando nao existe', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.findByIdempotencyKey(ctx, { key: 'inexistente' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('findByIdempotencyKey devolve o providerMessageId apos send', async () => {
    const p = createFakeMessagingProvider();
    await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-3',
    });
    const r = await p.findByIdempotencyKey(ctx, { key: ctx.idempotencyKey });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toBeNull();
    if (r.ok && r.value) expect(r.value.providerMessageId).toMatch(/^wamid-fake-/);
  });

  it('verifyWebhook aceita HMAC-SHA256 valido e rejeita invalido', () => {
    const p = createFakeMessagingProvider({ appSecret: 'meu-secret' });
    const payload = Buffer.from('{"entry":[]}');
    const hmac = createHmac('sha256', 'meu-secret').update(payload).digest('hex');
    const headers = { 'x-hub-signature-256': `sha256=${hmac}` };

    expect(p.verifyWebhook(payload, headers)).toEqual({ valid: true });
    expect(p.verifyWebhook(payload, { 'x-hub-signature-256': 'sha256=errado' }))
      .toEqual({ valid: false, reason: 'assinatura HMAC invalida' });
  });

  it('parseInbound extrai mensagem de texto do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: 'wamid.abc',
              from: '5511987654321',
              timestamp: '1722772800',
              type: 'text',
              text: { body: 'Confirmo' },
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('message');
    if (eventos[0]!.kind === 'message') {
      expect(eventos[0]!.body).toEqual({ kind: 'text', text: 'Confirmo' });
      expect(eventos[0]!.from).toBe('+5511987654321');
    }
  });

  it('parseInbound extrai status update do payload WhatsApp', () => {
    const p = createFakeMessagingProvider();
    const payload = Buffer.from(JSON.stringify({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid.xyz',
              status: 'delivered',
              timestamp: '1722772801',
            }],
          },
        }],
      }],
    }));
    const eventos = p.parseInbound(payload);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.kind).toBe('status');
    if (eventos[0]!.kind === 'status') {
      expect(eventos[0]!.status).toBe('delivered');
    }
  });

  it('fetchMedia devolve bytes e sha256', async () => {
    const p = createFakeMessagingProvider();
    const r = await p.fetchMedia(ctx, { providerMediaId: 'media-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
      expect(r.value.mime).toBe('image/jpeg');
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  it('o modo indisponivel devolve unavailable em send', async () => {
    const p = createFakeMessagingProvider({ modo: 'indisponivel' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-4',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('o modo timeout devolve timeout, que NAO e retryable', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-5',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.retrySafe).toBe(false);
  });

  it('health reporta up quando modo e ok', async () => {
    const p = createFakeMessagingProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health reporta down quando modo nao e ok', async () => {
    const p = createFakeMessagingProvider({ modo: 'timeout' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });
});
