// packages/tiss/src/demonstrativo/import-demonstrativo.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { parseDemonstrativoXml, type ParsedDemonstrativo } from './parse-demonstrativo';
import { receiveLoteReturn } from '../lote-lifecycle';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ImportDemonstrativoInput {
  /** XML do demonstrativo em bytes ISO-8859-1. */
  readonly xml: Uint8Array;
  /** Id da operadora destino (FK obrigatoria em tiss.demonstrativo). */
  readonly operadoraId: string;
  /** Chave de storage do XML original (coluna xml_storage_key). */
  readonly xmlStorageKey: string;
  /** Se informado, atualiza o lote para status 'retornado'. */
  readonly loteId?: string;
}

export type ImportDemonstrativoFailure =
  | { kind: 'xml_invalido'; message: string }
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string };

export interface ImportDemonstrativoResult {
  /** Id do demonstrativo inserido. */
  readonly demonstrativoId: string;
  /** Quantidade de itens (guias) no demonstrativo. */
  readonly itemCount: number;
  /** Quantas guias foram vinculadas a encounter_guia_consulta existente. */
  readonly matchedCount: number;
  /** Valor total de glosa em centavos. */
  readonly totalGlosaCents: number;
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Importa um demonstrativo TISS para o banco de dados.
 *
 * (1) Chama parseDemonstrativoXml para extrair dados estruturados do XML.
 * (2) Para cada item, faz match de numero_guia_prestador com
 *     tiss.encounter_guia_consulta (RLS filtra por tenant automaticamente).
 * (3) Insere em tiss.demonstrativo e tiss.demonstrativo_item.
 * (4) Marca guias com glosa: o vinculo demonstrativo_item.guia_id +
 *     valor_glosa_cents > 0 constitui a marcacao de glosa na guia.
 * (5) Se loteId presente, atualiza lote.status para 'retornado' via
 *     receiveLoteReturn.
 *
 * As tabelas tiss.demonstrativo e tiss.demonstrativo_item sao criadas
 * pelo bloco 01-demonstrativo-migrations.
 */
export async function importDemonstrativo(
  tx: TxClient,
  input: ImportDemonstrativoInput,
  importedBy: string,
): Promise<Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>> {
  // 1. Parse XML
  let parsed: ParsedDemonstrativo;
  try {
    parsed = parseDemonstrativoXml(input.xml);
  } catch (e) {
    return err({
      kind: 'xml_invalido',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const demonstrativoId = uuidv7();
  const cab = parsed.cabecalho;

  // 2. Computa totais a partir dos itens parseados
  let totalApresentado = 0;
  let totalProcessado = 0;
  let totalLiberado = 0;
  let totalGlosa = 0;
  for (const item of parsed.itens) {
    totalApresentado += item.valorInformadoCents;
    totalProcessado += item.valorProcessadoCents;
    totalLiberado += item.valorLiberadoCents;
    totalGlosa += item.valorGlosaCents;
  }

  // 3. Insere cabecalho do demonstrativo (tenant_id vem do DEFAULT via RLS).
  //    Nomes de coluna seguem o schema canonico do bloco 01 (migration 0123).
  await tx.query(
    `INSERT INTO tiss.demonstrativo
       (id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by)
     VALUES ($1, $2, $3, $4, $5::tiss.demonstrativo_kind,
             $6::date, $7, $8, $9, $10, $11, $12)`,
    [
      demonstrativoId,
      input.operadoraId,
      input.loteId ?? null,
      cab.numeroProtocolo,
      parsed.tipo === 'analise' ? 'analise' : 'pagamento',
      cab.dataProcessamento,
      input.xmlStorageKey,
      totalApresentado,
      totalProcessado,
      totalLiberado,
      totalGlosa,
      importedBy,
    ],
  );

  // 4. Para cada item, faz match e insere demonstrativo_item
  let matchedCount = 0;
  for (const item of parsed.itens) {
    // Match por numero_guia_prestador na guia VIVA (RLS filtra por tenant)
    const { rows: guiaRows } = await tx.query<{ id: string }>(
      `SELECT id FROM tiss.encounter_guia_consulta
        WHERE numero_guia_prestador = $1 AND live = true`,
      [item.numeroGuiaPrestador],
    );
    const guiaId = guiaRows.length > 0 ? guiaRows[0]!.id : null;
    if (guiaId !== null) matchedCount++;

    // Nomes de coluna seguem o schema canonico do bloco 01 (migration 0124).
    // Glosa armazenada como par codigo+descricao (primeiro da lista parseada);
    // detalhes completos preservados no XML original (xml_storage_key).
    const primaryGlosa = item.glosas.length > 0 ? item.glosas[0]! : null;
    await tx.query(
      `INSERT INTO tiss.demonstrativo_item
         (id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv7(),
        demonstrativoId,
        guiaId,
        item.numeroGuiaPrestador,
        item.valorInformadoCents,
        item.valorProcessadoCents,
        item.valorLiberadoCents,
        item.valorGlosaCents,
        primaryGlosa?.codigoGlosa ?? null,
        primaryGlosa?.descricaoGlosa ?? null,
      ],
    );
  }

  // 5. Atualiza lote para 'retornado' se loteId presente
  if (input.loteId) {
    const loteResult = await receiveLoteReturn(tx, input.loteId);
    if (!loteResult.ok) {
      const e = loteResult.error;
      if (e.kind === 'lote_nao_encontrado') {
        return err({ kind: 'lote_nao_encontrado' });
      }
      if (e.kind === 'transicao_invalida') {
        return err({ kind: 'transicao_invalida', de: e.de, para: e.para });
      }
    }
  }

  return ok({
    demonstrativoId,
    itemCount: parsed.itens.length,
    matchedCount,
    totalGlosaCents: totalGlosa,
  });
}
