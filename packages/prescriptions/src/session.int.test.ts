import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { PrescriptionProvider } from '@cadencia/integrations';
import { openPrescriberSession } from './session';
import { semearPrescricao } from './test-support';

afterAll(async () => { await closePools(); });

/** Provider espião: guarda o que recebeu e devolve uma sessão válida. */
function espiao() {
  const recebido: { professional?: unknown; patient?: unknown } = {};
  const provider = {
    id: 'espiao',
    capabilities: new Set<string>(),
    safety: {},
    async openPrescriberSession(_ctx: unknown, i: {
      professional: unknown; patient: unknown;
    }) {
      recebido.professional = i.professional;
      recebido.patient = i.patient;
      return {
        ok: true as const,
        value: {
          mode: 'embedded' as const,
          scriptUrl: 'https://memed.test/s.js',
          token: 'tok',
          expiresAt: '2030-01-01T00:00:00Z',
          patientPayload: { nome: 'x' },
          correlationId: 'c',
        },
      };
    },
  } as unknown as PrescriptionProvider;
  return { provider, recebido };
}

describe('sessao do prescritor', () => {
  it('leva o CPF do prescritor para o parceiro', async () => {
    const s = await semearPrescricao();
    const cpf = '39053344705';
    const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      await admin.query(`UPDATE id."user" SET cpf = $2 WHERE id = $1`, [s.userId, cpf]);
    } finally { await admin.end(); }

    const { provider, recebido } = espiao();
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };

    const r = await withTenantTx(actor, async (tx) => openPrescriberSession(tx, {
      provider, encounterId: s.encounterId,
      patientId: s.patientId, professionalId: s.professionalId,
    }));

    expect(r.ok).toBe(true);
    // A Memed identifica o prescritor pelo CPF (external_id). Mandar string
    // vazia faz o parceiro recusar a sessão inteira — e a receita não abre para
    // um médico que existe, tem CRM e está com o paciente na sala.
    expect((recebido.professional as { cpf: string }).cpf).toBe(cpf);
    expect((recebido.professional as { council: string }).council).toBe('CRM');
  });
});
