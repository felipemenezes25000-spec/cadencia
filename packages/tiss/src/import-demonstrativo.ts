import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { receiveLoteReturn } from './lote-lifecycle';

export type ImportDemonstrativoFailure =
  | { kind: 'lote_nao_enviado' }
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'transicao_lote_falhou'; detalhe: string };

export interface ImportDemonstrativoInput {
  readonly operadoraId: string;
  readonly loteId: string | null;
  readonly protocoloOperadora: string;
  readonly kind: 'analise' | 'pagamento';
  readonly dataProcessamento: string;
  readonly dataPagamento?: string;
  readonly xmlStorageKey: string;
  readonly totalApresentadoCents: number;
  readonly totalProcessadoCents: number;
  readonly totalLiberadoCents: number;
  readonly totalGlosaCents: number;
  readonly importedBy: string;
  readonly items: readonly ImportDemonstrativoItem[];
}

export interface ImportDemonstrativoItem {
  readonly guiaId: string | null;
  readonly numeroGuiaPrestador: string;
  readonly valorApresentadoCents: number;
  readonly valorProcessadoCents: number;
  readonly valorLiberadoCents: number;
  readonly valorGlosaCents: number;
  readonly glosaCodigo?: string | null;
  readonly glosaDescricao?: string | null;
}

export interface ImportDemonstrativoResult {
  readonly demonstrativoId: string;
  readonly itemCount: number;
  readonly loteRetornado: boolean;
}

/**
 * Importa um demonstrativo de retorno TISS e seus itens na mesma transação.
 * Quando vinculado a um lote (lote_id não nulo), transita o lote para 'retornado'
 * via receiveLoteReturn. O lote PRECISA estar em status 'enviado'.
 */
export async function importDemonstrativo(
  tx: TxClient,
  i: ImportDemonstrativoInput,
): Promise<Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>> {
  // 1. Se vinculado a lote, valida que o lote existe e está em status 'enviado'
  let loteRetornado = false;

  if (i.loteId !== null) {
    const { rows: loteRows } = await tx.query<{ status: string }>(
      `SELECT status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
      [i.loteId],
    );
    if (loteRows.length === 0) {
      return err({ kind: 'lote_nao_encontrado' });
    }
    if (loteRows[0]!.status !== 'enviado') {
      return err({ kind: 'lote_nao_enviado' });
    }
  }

  // 2. Insere o demonstrativo
  const demonstrativoId = uuidv7();
  const dataPagamento = i.kind === 'pagamento' ? i.dataPagamento ?? null : null;

  await tx.query(
    `INSERT INTO tiss.demonstrativo
       (id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, data_pagamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by)
     VALUES ($1, $2, $3, $4, $5::tiss.demonstrativo_kind,
             $6::date, $7::date, $8,
             $9, $10, $11, $12, $13)`,
    [
      demonstrativoId, i.operadoraId, i.loteId, i.protocoloOperadora, i.kind,
      i.dataProcessamento, dataPagamento, i.xmlStorageKey,
      i.totalApresentadoCents, i.totalProcessadoCents,
      i.totalLiberadoCents, i.totalGlosaCents, i.importedBy,
    ],
  );

  // 3. Insere os itens
  for (const item of i.items) {
    const itemId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.demonstrativo_item
         (id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        itemId, demonstrativoId, item.guiaId, item.numeroGuiaPrestador,
        item.valorApresentadoCents, item.valorProcessadoCents,
        item.valorLiberadoCents, item.valorGlosaCents,
        item.glosaCodigo ?? null, item.glosaDescricao ?? null,
      ],
    );
  }

  // 4. Transita o lote para 'retornado' se vinculado
  if (i.loteId !== null) {
    const transicao = await receiveLoteReturn(tx, i.loteId);
    if (!transicao.ok) {
      return err({
        kind: 'transicao_lote_falhou',
        detalhe: transicao.error.kind,
      });
    }
    loteRetornado = true;
  }

  return ok({
    demonstrativoId,
    itemCount: i.items.length,
    loteRetornado,
  });
}
