import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type LoteLifecycleFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_vazio' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'protocolo_obrigatorio' }
  | { kind: 'lote_ja_enviado' };

export interface LoteReadyResult {
  readonly loteId: string;
  readonly guiaCount: number;
  readonly totalValueCents: number;
}

export interface LoteSentResult {
  readonly loteId: string;
  readonly protocoloOperadora: string;
  readonly sentAt: string;
}

export interface LoteReturnedResult {
  readonly loteId: string;
}

export interface LoteCancelledResult {
  readonly loteId: string;
  readonly guiasLiberadas: number;
}

/**
 * Marca o lote como pronto para envio. Valida que o lote tem ao menos uma guia.
 * Transicao permitida: rascunho -> pronto.
 */
export async function markLoteReady(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteReadyResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'pronto' });
  }
  if (lote.guia_count === 0) {
    return err({ kind: 'lote_vazio' });
  }

  await tx.query(
    `UPDATE tiss.lote SET status = 'pronto' WHERE id = $1`,
    [loteId],
  );

  return ok({
    loteId: lote.id,
    guiaCount: lote.guia_count,
    totalValueCents: Number(lote.total_value_cents),
  });
}

/**
 * Marca o lote como enviado. Grava o protocolo da operadora e a data de envio.
 * Transicao permitida: pronto -> enviado.
 * xml_storage_key e xml_hash_md5 devem ter sido gravados antes (pelo bloco de XML).
 */
export async function markLoteSent(
  tx: TxClient,
  i: {
    loteId: string;
    protocoloOperadora: string;
    xmlStorageKey: string;
    xmlHashMd5: string;
  },
): Promise<Result<LoteSentResult, LoteLifecycleFailure>> {
  if (!i.protocoloOperadora) {
    return err({ kind: 'protocolo_obrigatorio' });
  }

  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'pronto') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'enviado' });
  }

  await tx.query(
    `UPDATE tiss.lote
        SET status = 'enviado',
            protocolo_operadora = $2,
            xml_storage_key = $3,
            xml_hash_md5 = $4,
            sent_at = clock_timestamp()
      WHERE id = $1`,
    [i.loteId, i.protocoloOperadora, i.xmlStorageKey, i.xmlHashMd5],
  );

  // Retorna a data de envio gravada pelo banco
  const { rows: sentRows } = await tx.query<{ sent_at: string }>(
    `SELECT sent_at FROM tiss.lote WHERE id = $1`,
    [i.loteId],
  );

  return ok({
    loteId: lote.id,
    protocoloOperadora: i.protocoloOperadora,
    sentAt: String(sentRows[0]!.sent_at),
  });
}

/**
 * Marca o lote como retornado pela operadora (demonstrativo recebido).
 * Transicao permitida: enviado -> retornado.
 */
export async function receiveLoteReturn(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteReturnedResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'enviado') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'retornado' });
  }

  await tx.query(
    `UPDATE tiss.lote SET status = 'retornado' WHERE id = $1`,
    [loteId],
  );

  return ok({ loteId: lote.id });
}

/**
 * Cancela o lote e libera suas guias para inclusao em outro lote.
 * So e permitido se o lote NAO foi enviado (rascunho ou pronto).
 * As linhas de lote_guia sao removidas para liberar o indice unico.
 */
export async function cancelLote(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteCancelledResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status === 'enviado' || lote.status === 'retornado') {
    return err({ kind: 'lote_ja_enviado' });
  }
  if (lote.status === 'cancelado') {
    return err({ kind: 'transicao_invalida', de: 'cancelado', para: 'cancelado' });
  }

  // Remove os vinculos de guia para liberar o indice unico
  const { rowCount } = await tx.query(
    `DELETE FROM tiss.lote_guia WHERE lote_id = $1`,
    [loteId],
  );

  // Marca como cancelado e zera contadores
  await tx.query(
    `UPDATE tiss.lote
        SET status = 'cancelado', guia_count = 0, total_value_cents = 0
      WHERE id = $1`,
    [loteId],
  );

  return ok({
    loteId: lote.id,
    guiasLiberadas: rowCount ?? 0,
  });
}
