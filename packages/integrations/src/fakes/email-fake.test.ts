import { describe, expect, it } from 'vitest';
import { createFakeEmailProvider } from './email-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r',
  idempotencyKey: 'email-1', deadlineMs: 3000,
};

const envelope = {
  to: 'paciente@example.com',
  subject: 'Confirmacao de consulta',
  html: '<p>Sua consulta esta confirmada.</p>',
} as const;

describe('provedor de email falso', () => {
  it('send acumula no array sent e devolve messageId', async () => {
    const p = createFakeEmailProvider();
    const r = await p.send(ctx, envelope);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.messageId).toBe('email-fake-1');
    }
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]!.envelope.to).toBe('paciente@example.com');
  });

  it('send incrementa messageId a cada chamada', async () => {
    const p = createFakeEmailProvider();
    await p.send(ctx, envelope);
    const r2 = await p.send({ ...ctx, idempotencyKey: 'email-2' }, envelope);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.messageId).toBe('email-fake-2');
    }
    expect(p.sent).toHaveLength(2);
  });

  it('modo indisponivel devolve unavailable', async () => {
    const p = createFakeEmailProvider({ modo: 'indisponivel' });
    const r = await p.send(ctx, envelope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('modo timeout devolve timeout e NAO e retryable', async () => {
    const p = createFakeEmailProvider({ modo: 'timeout' });
    const r = await p.send(ctx, envelope);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout');
      expect(r.error.retrySafe).toBe(false);
    }
  });

  it('modo default devolve ok com messageId', async () => {
    const p = createFakeEmailProvider();
    const r = await p.send(ctx, envelope);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.messageId).toMatch(/^email-fake-/);
    }
  });

  it('health reporta up quando modo e ok', async () => {
    const p = createFakeEmailProvider();
    const h = await p.health();
    expect(h.up).toBe(true);
  });

  it('health reporta down quando modo nao e ok', async () => {
    const p = createFakeEmailProvider({ modo: 'timeout' });
    const h = await p.health();
    expect(h.up).toBe(false);
  });

  it('declara safety send como unsafe', () => {
    const p = createFakeEmailProvider();
    expect(p.safety.send).toBe('unsafe');
  });
});
