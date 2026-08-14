// packages/integrations/src/fakes/sms-fake.test.ts
import { describe, expect, it } from 'vitest';
import { createFakeSmsProvider } from './sms-fake';
import { asE164, type ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'sms-1', deadlineMs: 3000,
};

const telefone = asE164('+5511987654321')!;

describe('provedor SMS falso', () => {
  it('send acumula em sent', async () => {
    const p = createFakeSmsProvider();
    const r = await p.send(ctx, {
      channelIdentityRef: 'fake-sms-identity-1',
      to: telefone,
      body: { kind: 'text', text: 'Lembrete via SMS' },
      conversationId: 'conv-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerMessageId).toMatch(/^smsid-fake-/);
    }
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.body).toEqual({ kind: 'text', text: 'Lembrete via SMS' });
  });

  it('modo indisponivel devolve unavailable', async () => {
    const p = createFakeSmsProvider({ modo: 'indisponivel' });
    const r = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-2',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('supportsInbound e false', () => {
    const p = createFakeSmsProvider();
    expect(p.supportsInbound).toBe(false);
  });

  it('verifyWebhook devolve invalid', () => {
    const p = createFakeSmsProvider();
    const result = p.verifyWebhook(Buffer.from('{}'), {});
    expect(result).toEqual({ valid: false, reason: 'SMS nao suporta webhook inbound' });
  });

  it('parseInbound devolve array vazio', () => {
    const p = createFakeSmsProvider();
    const events = p.parseInbound(Buffer.from('{}'));
    expect(events).toEqual([]);
  });

  it('fetchMedia devolve unsupported', async () => {
    const p = createFakeSmsProvider();
    const r = await p.fetchMedia(ctx, { providerMediaId: 'media-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unsupported');
  });

  it('send com mesma idempotencyKey devolve mesmo providerMessageId', async () => {
    const p = createFakeSmsProvider();
    const r1 = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-3',
    });
    const r2 = await p.send(ctx, {
      channelIdentityRef: 'id-1',
      to: telefone,
      body: { kind: 'text', text: 'Ola' },
      conversationId: 'conv-3',
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.providerMessageId).toBe(r2.value.providerMessageId);
    }
    expect(p.sent).toHaveLength(1);
  });

  it('channel e sms', () => {
    const p = createFakeSmsProvider();
    expect(p.channel).toBe('sms');
  });

  it('capabilities inclui residency:br mas nao inbound nem templates', () => {
    const p = createFakeSmsProvider();
    expect(p.capabilities.has('residency:br')).toBe(true);
    expect(p.capabilities.has('inbound')).toBe(false);
    expect(p.capabilities.has('templates')).toBe(false);
  });

  it('health reporta up quando modo e ok', async () => {
    const p = createFakeSmsProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health reporta down quando modo nao e ok', async () => {
    const p = createFakeSmsProvider({ modo: 'timeout' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });
});
