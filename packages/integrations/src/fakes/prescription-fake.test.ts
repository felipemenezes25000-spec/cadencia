import { describe, expect, it } from 'vitest';
import { createFakePrescriptionProvider } from './prescription-fake';
import type { ProviderCtx } from '../contracts/common';

const ctx: ProviderCtx = {
  tenantId: 't', actorUserId: 'u', requestId: 'r', idempotencyKey: 'enc-1', deadlineMs: 3000,
};
const sessao = {
  professional: { fullName: 'Dr. Alceu', cpf: '00000000000',
                  council: 'CRM' as const, number: '123456', uf: 'SP' },
  patient: { fullName: 'Maria Souza Lima', birthDate: '1988-03-14' },
  encounterId: 'enc-1',
};

describe('provedor de prescricao falso', () => {
  it('a sessao e EMBUTIDA: devolve scriptUrl, nao um endpoint de criacao', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.openPrescriberSession(ctx, sessao);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('embedded');
      expect(r.value.scriptUrl).toMatch(/^https:\/\//);
    }
  });

  it('o token e DINAMICO e vem com expiracao — cachear como fixo e o bug classico', async () => {
    const p = createFakePrescriptionProvider();
    const a = await p.openPrescriberSession(ctx, sessao);
    const b = await p.openPrescriberSession(ctx, sessao);
    if (a.ok && b.ok) {
      expect(a.value.token).not.toBe(b.value.token);
      expect(a.value.expiresAt).toMatch(/Z$/);
    }
  });

  it('o adaptador RECUSA servir token vencido em vez de deixar a tela falhar sozinha', async () => {
    const p = createFakePrescriptionProvider({ tokenJaVencido: true });
    const r = await p.openPrescriberSession(ctx, sessao);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('misconfigured');
  });

  it('fetchPrescription e a VERDADE server-side — o browser so informa um id', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.fetchPrescription(ctx, { providerPrescriptionId: 'rx-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.providerPrescriptionId).toBe('rx-1');
      expect(r.value.items.length).toBeGreaterThan(0);
      expect(r.value.patientLinkUrl).toMatch(/^https:\/\//);
      expect(r.value.validationCode).toHaveLength(6);
    }
  });

  it('fetchSignedArtifact devolve os bytes assinados e o sha256', async () => {
    const p = createFakePrescriptionProvider();
    const r = await p.fetchSignedArtifact(ctx, { providerPrescriptionId: 'rx-1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBeGreaterThan(0);
      expect(r.value.sha256).toHaveLength(64);
    }
  });

  it('declara safety: openPrescriberSession idempotent, fetch* safe', () => {
    const p = createFakePrescriptionProvider();
    expect(p.safety.openPrescriberSession).toBe('idempotent');
    expect(p.safety.fetchPrescription).toBe('safe');
    expect(p.safety.fetchSignedArtifact).toBe('safe');
  });
});
