import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createFakePrescriptionProvider, createFakeSignatureProvider,
} from '@cadencia/integrations';
import { openPrescriberSession } from './session';
import { confirmPrescription } from './confirm';
import { semearPrescricao, type SementeRx } from './test-support';

let s: SementeRx; let actor: Actor;

beforeAll(async () => {
  s = await semearPrescricao();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('prescricao', () => {
  it('abre a sessao do prescritor com os dados do profissional e do paciente', async () => {
    const r = await withTenantTx(actor, (tx) => openPrescriberSession(tx, {
      provider: createFakePrescriptionProvider(),
      encounterId: s.encounterId, professionalId: s.professionalId, patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mode).toBe('embedded');
  });

  it('confirma buscando a verdade no SERVIDOR e persistindo tudo do nosso lado', async () => {
    const r = await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider(),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-1',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    expect(r.ok).toBe(true);

    const { rows } = await withTenantTx(actor, (tx) => tx.query<{
      link: string; codigo: string; itens: number }>(
      `SELECT p.patient_link_url AS link, p.validation_code AS codigo,
              (SELECT count(*)::int FROM clin.prescription_item i
                WHERE i.prescription_id = p.id) AS itens
         FROM clin.prescription p WHERE p.provider_prescription_id = 'rx-1'`));
    expect(rows[0]?.link).toMatch(/^https:\/\//);
    expect(rows[0]?.codigo).toBe('482913');
    expect(rows[0]?.itens).toBe(1);
  });

  it('o evento JS repetido NAO duplica a prescricao', async () => {
    await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider(),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-1',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM clin.prescription WHERE provider_prescription_id = 'rx-1'`));
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('parceiro indisponivel NAO trava o atendimento: devolve pendente', async () => {
    const r = await withTenantTx(actor, (tx) => confirmPrescription(tx, {
      prescriptionProvider: createFakePrescriptionProvider({ modo: 'indisponivel' }),
      signatureProvider: createFakeSignatureProvider(),
      providerPrescriptionId: 'rx-2',
      encounterId: s.encounterId, patientId: s.patientId,
      professionalId: s.professionalId, clinicId: s.clinicId,
      signerRef: 'signer-1', signerCpf: '00000000000',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'parceiro_indisponivel', retrySafe: true } });
  });
});
