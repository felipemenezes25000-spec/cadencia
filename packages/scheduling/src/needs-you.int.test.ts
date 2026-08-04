import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment } from './appointments';
import { needsYou } from './needs-you';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor;

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // Amanha, sem confirmacao: entra em "confirmacoes sem resposta".
  await withTenantTx(actor, (tx) => createAppointment(tx, {
    patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
    procedureId: s.procedureId,
    startsAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString() }));
});
afterAll(async () => { await closePools(); });

describe('painel Precisa de voce', () => {
  it('devolve as cinco filas na ordem em que a tela as mostra', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(Object.keys(r)).toEqual([
      'confirmacoesSemResposta', 'prescricoesNaoAssinadas', 'resultadosChegados',
      'rascunhosDeOntem', 'guiasAFaturar',
    ]);
  });

  it('conta o agendamento de amanha ainda sem confirmacao', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(r.confirmacoesSemResposta).toBeGreaterThanOrEqual(1);
  });

  it('nao conta rascunho de hoje como rascunho de ontem', async () => {
    const r = await withTenantTx(actor, (tx) => needsYou(tx, { clinicId: s.clinicId }));
    expect(r.rascunhosDeOntem).toBe(0);
  });
});
