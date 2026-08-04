import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { openDraft, saveDraft } from './draft';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('rascunho do atendimento', () => {
  it('abre com revisao 1 e payload vazio quando ainda nao existe', async () => {
    const r = await withTenantTx(actor, (tx) => openDraft(tx, s.encounterId));
    expect(r).toEqual({ ok: true, value: { encounterId: s.encounterId, rev: 1, payload: {} } });
  });

  it('grava e devolve a revisao seguinte', async () => {
    const r = await withTenantTx(actor, (tx) =>
      saveDraft(tx, { encounterId: s.encounterId, expectedRev: 1, payload: { queixa: 'cefaleia' } }));
    expect(r).toEqual({ ok: true, value: { rev: 2 } });
  });

  it('recusa gravacao com revisao velha e devolve o payload vigente para a tela reconciliar', async () => {
    const r = await withTenantTx(actor, (tx) =>
      saveDraft(tx, { encounterId: s.encounterId, expectedRev: 1, payload: { queixa: 'do celular' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('conflito_de_revisao');
      if (r.error.kind === 'conflito_de_revisao') {
        expect(r.error.currentRev).toBe(2);
        expect(r.error.currentPayload).toEqual({ queixa: 'cefaleia' });
      }
    }
  });

  it('recusa abrir rascunho de atendimento ja finalizado', async () => {
    const r = await withTenantTx(actor, (tx) => openDraft(tx, s.finalizedEncounterId));
    expect(r).toEqual({ ok: false, error: { kind: 'atendimento_nao_esta_em_rascunho' } });
  });
});
