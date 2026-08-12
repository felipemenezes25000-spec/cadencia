// apps/worker/src/jobs/reprojetar-guia-tiss.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { reprojectGuiaOnAmend, type ReprojectAction } from '@cadencia/tiss';

/**
 * Consome `ENCOUNTER_AMENDED` do outbox e reprojeta a guia TISS.
 *
 * Quando o prontuário é retificado, a guia de convênio derivada dele fica
 * desatualizada: o CID que mudou, o procedimento que mudou, o valor que mudou.
 * `clin.finalize_encounter` emite `ENCOUNTER_AMENDED` justamente para disparar a
 * correção, e `resolveQueue` já roteava o evento para `tiss.encounter_amended`.
 *
 * O que faltava era ESTE consumidor. Sem ele o despachante marcava o evento como
 * despachado, empurrava para uma fila que ninguém escutava e o evento sumia: a
 * guia continuava com o conteúdo antigo e ia para a operadora assim. É o mesmo
 * defeito que já tinha acontecido com `create_payment_link` — fila existindo sem
 * ouvinte não levanta erro em lugar nenhum, só para de funcionar em silêncio.
 */

export interface ReprojetarGuiaInput {
  readonly tenantId: string;
  /** `aggregate_id` do evento: o atendimento retificado. */
  readonly aggregateId: string;
}

export type ReprojetarGuiaResult =
  | { readonly status: 'ok'; readonly acao: ReprojectAction }
  | { readonly status: 'sem_versao' }
  | { readonly status: 'falhou'; readonly detalhe: string };

export async function reprojetarGuiaTiss(
  input: ReprojetarGuiaInput,
): Promise<ReprojetarGuiaResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'reprojetar-guia-tiss',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    /**
     * A versão vem do `head_version_id`, não do evento.
     *
     * O payload de `ENCOUNTER_AMENDED` (migration 0120) leva encounterId,
     * patientId, professionalId, versionNo e kind — não leva o id da versão.
     * Buscar o head aqui é melhor do que reescrever a função de 250 linhas só
     * para acrescentar um campo, e é o valor CERTO: a guia espelha o estado
     * vigente do prontuário, que é exatamente o que o head aponta.
     */
    const { rows } = await tx.query<{ head_version_id: string | null }>(
      `SELECT head_version_id FROM clin.encounter WHERE id = $1`,
      [input.aggregateId]);
    const versionId = rows[0]?.head_version_id;
    if (versionId === undefined || versionId === null) {
      return { status: 'sem_versao' as const };
    }

    const r = await reprojectGuiaOnAmend(tx, input.aggregateId, versionId);
    if (!r.ok) return { status: 'falhou' as const, detalhe: r.error.message };
    return { status: 'ok' as const, acao: r.value };
  });
}
