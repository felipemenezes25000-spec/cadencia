import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  PrescriberSession, PrescriptionProvider, ProviderCtx,
} from '@cadencia/integrations';

export interface OpenSessionInput {
  readonly provider: PrescriptionProvider;
  readonly encounterId: string;
  readonly professionalId: string;
  readonly patientId: string;
}

export type PrescriptionFailure =
  | { kind: 'profissional_nao_encontrado' }
  | { kind: 'paciente_nao_encontrado' }
  | { kind: 'parceiro_indisponivel'; retrySafe: boolean }
  | { kind: 'parceiro_recusou'; code: string }
  | { kind: 'artefato_assinado_indisponivel' };

export async function openPrescriberSession(
  tx: TxClient, i: OpenSessionInput,
): Promise<Result<PrescriberSession, PrescriptionFailure>> {
  const prof = await tx.query<{
    full_name: string; cpf: string | null; conselho: string; numero: string; uf: string }>(
    // O CPF vem de id."user" e nao de um NULL fixo. A Memed identifica o
    // prescritor por ele (external_id): sem CPF o parceiro recusa a sessao
    // inteira, e a receita nao abre para um medico que existe, tem CRM e esta
    // com o paciente na sala.
    `SELECT u.full_name, u.cpf, p.conselho_profissional AS conselho,
            p.numero_conselho AS numero, p.uf_conselho AS uf
       FROM app.professional p JOIN id."user" u ON u.id = p.user_id
      WHERE p.id = $1`, [i.professionalId]);
  const pr = prof.rows[0];
  if (!pr) return err({ kind: 'profissional_nao_encontrado' });

  const pac = await tx.query<{ display_name: string; birth_date: string | null;
                               phone: string | null; cpf: string | null }>(
    `SELECT p.display_name, p.birth_date::text AS birth_date, p.phone_primary AS phone,
            (SELECT i.value FROM clin.patient_identifier i
              WHERE i.tenant_id = p.tenant_id AND i.patient_id = p.id AND i.kind='CPF'
              LIMIT 1) AS cpf
       FROM clin.patient p WHERE p.id = $1`, [i.patientId]);
  const pa = pac.rows[0];
  if (!pa) return err({ kind: 'paciente_nao_encontrado' });

  const ctx: ProviderCtx = {
    tenantId: '', actorUserId: null, requestId: uuidv7(),
    idempotencyKey: `rxsession:${i.encounterId}`,
    deadlineMs: 3000,
  };

  const r = await i.provider.openPrescriberSession(ctx, {
    professional: {
      fullName: pr.full_name, cpf: pr.cpf ?? '',
      council: pr.conselho === '06' ? 'CRM' : 'CRO',
      number: pr.numero, uf: pr.uf,
    },
    patient: {
      fullName: pa.display_name,
      ...(pa.birth_date === null ? {} : { birthDate: pa.birth_date }),
      ...(pa.cpf === null ? {} : { cpf: pa.cpf }),
    },
    encounterId: i.encounterId,
  });

  if (!r.ok) {
    if (r.error.kind === 'rejected') return err({ kind: 'parceiro_recusou', code: r.error.code });
    return err({ kind: 'parceiro_indisponivel', retrySafe: r.error.retrySafe });
  }
  return ok(r.value);
}
