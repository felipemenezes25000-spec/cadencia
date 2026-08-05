// packages/messaging/src/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveConversation } from './messaging';
import { semearMensageria, type SementeMensageria } from './test-support';

let s: SementeMensageria;
let actor: Actor;

beforeAll(async () => {
  s = await semearMensageria();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('resolveConversation', () => {
  it('cria conversa nova e vincula paciente pelo telefone', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.conversationId).toBeTruthy();
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('retorna conversa existente sem criar duplicata', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(false);
  });

  it('cria conversa com patient_id NULL para numero desconhecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511888880000',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.patientId).toBeNull();
  });

  it('usa patient_id explicito quando fornecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511777770000',
      patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: uuidv7(),
      remotePhone: '+5511999990001',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
