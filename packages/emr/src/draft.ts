import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type DraftPayload = Readonly<Record<string, unknown>>;

export interface DraftState {
  readonly encounterId: string;
  readonly rev: number;
  readonly payload: DraftPayload;
}

export type DraftFailure =
  | { kind: 'atendimento_nao_encontrado' }
  | { kind: 'atendimento_nao_esta_em_rascunho' }
  | { kind: 'conflito_de_revisao'; currentRev: number; currentPayload: DraftPayload };

/**
 * Abre o rascunho. Se ainda não existe, devolve o estado inicial SEM gravar:
 * abrir a tela não pode criar linha, senão todo atendimento aberto por engano
 * vira rascunho órfão e depois versão `incompleto` pela política dos 7 dias.
 */
export async function openDraft(
  tx: TxClient, encounterId: string,
): Promise<Result<DraftState, DraftFailure>> {
  const enc = await tx.query<{ status: string }>(
    `SELECT status::text AS status FROM clin.encounter WHERE id = $1`, [encounterId]);
  const linha = enc.rows[0];
  // RLS já filtrou tenant e escopo clínico: zero linhas é "não existe para você".
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  if (linha.status !== 'rascunho') return err({ kind: 'atendimento_nao_esta_em_rascunho' });

  const d = await tx.query<{ rev: number; payload: DraftPayload }>(
    `SELECT rev, payload FROM clin.encounter_draft WHERE encounter_id = $1`, [encounterId]);
  const atual = d.rows[0];
  return ok({
    encounterId,
    rev: atual?.rev ?? 1,
    payload: atual?.payload ?? {},
  });
}

export interface SaveDraftInput {
  readonly encounterId: string;
  readonly expectedRev: number;
  readonly payload: DraftPayload;
}

/**
 * Grava o rascunho com concorrência otimista. `expectedRev` é a revisão que a
 * tela tinha quando o usuário começou a digitar; se o banco avançou, devolvemos
 * o estado vigente para a tela reconciliar em vez de sobrescrever.
 */
export async function saveDraft(
  tx: TxClient, input: SaveDraftInput,
): Promise<Result<{ rev: number }, DraftFailure>> {
  const enc = await tx.query<{ status: string }>(
    `SELECT status::text AS status FROM clin.encounter WHERE id = $1`, [input.encounterId]);
  const linha = enc.rows[0];
  if (!linha) return err({ kind: 'atendimento_nao_encontrado' });
  if (linha.status !== 'rascunho') return err({ kind: 'atendimento_nao_esta_em_rascunho' });

  // Primeira gravação: INSERT idempotente. ON CONFLICT DO NOTHING evita corrida
  // entre duas abas do mesmo médico abrindo o atendimento ao mesmo tempo.
  if (input.expectedRev === 1) {
    const ins = await tx.query<{ rev: number }>(
      `INSERT INTO clin.encounter_draft (encounter_id, payload, rev, updated_by)
       VALUES ($1, $2::jsonb, 2, app.current_user_id())
       ON CONFLICT (encounter_id) DO NOTHING
       RETURNING rev`,
      [input.encounterId, JSON.stringify(input.payload)]);
    const criado = ins.rows[0];
    if (criado) return ok({ rev: criado.rev });
    // Já existia: cai no caminho do UPDATE, que devolve o conflito correto.
  }

  const upd = await tx.query<{ rev: number }>(
    `UPDATE clin.encounter_draft
        SET payload = $3::jsonb, rev = rev + 1,
            updated_at = clock_timestamp(), updated_by = app.current_user_id()
      WHERE encounter_id = $1 AND rev = $2
    RETURNING rev`,
    [input.encounterId, input.expectedRev, JSON.stringify(input.payload)]);
  const gravado = upd.rows[0];
  if (gravado) return ok({ rev: gravado.rev });

  const atual = await tx.query<{ rev: number; payload: DraftPayload }>(
    `SELECT rev, payload FROM clin.encounter_draft WHERE encounter_id = $1`, [input.encounterId]);
  const vigente = atual.rows[0];
  return err({
    kind: 'conflito_de_revisao',
    currentRev: vigente?.rev ?? 1,
    currentPayload: vigente?.payload ?? {},
  });
}
