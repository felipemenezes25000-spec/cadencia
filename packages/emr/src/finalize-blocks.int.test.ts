import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { finalizeEncounter } from './finalize';
import { semearAtendimento, type Semente } from './test-support';

let s: Semente; let actor: Actor;

beforeAll(async () => {
  s = await semearAtendimento();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  // Rebaixa o paciente para preliminar: e o estado real de quem foi agendado
  // pelo telefone com nome e um canal, e ainda nao passou pelo check-in.
  // A escrita vai por withTenantTx e nao pelo appPool: clin.patient tem RLS
  // FORCE, e fora da transacao de tenant o UPDATE nao levanta erro — ele
  // simplesmente casa zero linhas, e o teste passaria a medir outra coisa.
  await definirCadastro('preliminar', null);
});
afterAll(async () => { await closePools(); });

/** Escreve no cadastro do paciente semeado e confirma que a linha foi mesmo tocada. */
async function definirCadastro(status: string, birthDate: string | null): Promise<void> {
  const n = await withTenantTx(actor, async (tx) => {
    const r = await tx.query(
      `UPDATE clin.patient SET cadastro_status = $2, birth_date = $3::date WHERE id = $1`,
      [s.patientId, status, birthDate]);
    return r.rowCount;
  });
  expect(n).toBe(1);
}

describe('divida de dados bloqueia a finalizacao — no momento certo', () => {
  it('recusa finalizar e diz EXATAMENTE o que falta', async () => {
    const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
      encounterId: s.encounterId,
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [] }));
    expect(r).toEqual({
      ok: false,
      error: { kind: 'cadastro_preliminar_bloqueia_finalizacao',
               faltando: ['cadastro_status', 'birth_date'] },
    });
  });

  it('o atendimento continua em rascunho — nada foi selado pela metade', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ status: string; n: number }>(
      `SELECT status::text AS status, version_count AS n FROM clin.encounter WHERE id = $1`,
      [s.encounterId]));
    expect(rows[0]).toEqual({ status: 'rascunho', n: 0 });
  });

  it('pago o dado, finaliza', async () => {
    await definirCadastro('completo', '1988-03-14');
    const r = await withTenantTx(actor, (tx) => finalizeEncounter(tx, {
      encounterId: s.encounterId,
      fields: [], diagnoses: [], observations: [], findings: [], procedures: [] }));
    expect(r.ok).toBe(true);
  });
});
