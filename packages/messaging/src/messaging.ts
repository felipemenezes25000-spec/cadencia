// packages/messaging/src/messaging.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos de falha
// ---------------------------------------------------------------------------

export type MessagingFailure =
  | { kind: 'canal_nao_encontrado' }
  | { kind: 'conversa_nao_encontrada' }
  | { kind: 'canal_inativo' };

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

export interface ResolveConversationInput {
  readonly channelIdentityId: string;
  readonly remotePhone: string;
  readonly patientId?: string;
}

export interface ResolvedConversation {
  readonly conversationId: string;
  readonly created: boolean;
  readonly patientId: string | null;
}

export async function resolveConversation(
  tx: TxClient, i: ResolveConversationInput,
): Promise<Result<ResolvedConversation, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Buscar conversa ativa pelo telefone.
  const existente = await tx.query<{ id: string; patient_id: string | null }>(
    `SELECT id, patient_id FROM msg.conversation
      WHERE channel_identity_id = $1
        AND remote_phone = $2
        AND status = 'active'`,
    [i.channelIdentityId, i.remotePhone]);

  if (existente.rows.length > 0) {
    const conv = existente.rows[0]!;
    return ok({
      conversationId: conv.id,
      created: false,
      patientId: conv.patient_id,
    });
  }

  // 3. Criar conversa nova.
  let patientId: string | null = i.patientId ?? null;

  // Se patientId nao foi fornecido, tenta lookup pelo telefone do paciente.
  if (patientId === null) {
    const paciente = await tx.query<{ id: string }>(
      `SELECT id FROM clin.patient
        WHERE phone_primary = $1
        LIMIT 1`,
      [i.remotePhone]);
    if (paciente.rows.length > 0) {
      patientId = paciente.rows[0]!.id;
    }
  }

  const conversationId = uuidv7();
  await tx.query(
    `INSERT INTO msg.conversation
       (id, channel_identity_id, patient_id, remote_phone, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [conversationId, i.channelIdentityId, patientId, i.remotePhone]);

  return ok({ conversationId, created: true, patientId });
}
