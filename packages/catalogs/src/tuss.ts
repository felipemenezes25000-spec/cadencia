import { err, ok, type Result } from '@cadencia/kernel';
import type { Queryable, TransactionalDb } from './cid10';

export interface ResolvedTussTerm {
  system: 'TUSS';
  tabela: number;
  code: string;
  display: string;
  terminologyVersion: string;   // competencia da publicacao da ANS consultada
}

export type TussFailure = 'codigo_inexistente_na_data';

/**
 * Resolve o codigo TUSS PELA DATA DO EVENTO. `eventDate` e obrigatorio, no
 * formato AAAA-MM-DD: e a `occurred_date` do atendimento, ja no fuso da clinica.
 * Item 211 do Componente Organizacional: vale a terminologia vigente na data do
 * atendimento, nao a da execucao do faturamento.
 */
export async function resolveTussAt(
  db: Queryable, tabela: number, codigo: string, eventDate: string,
): Promise<Result<ResolvedTussTerm, TussFailure>> {
  const { rows } = await db.query(
    `SELECT tabela, codigo, termo, competencia
       FROM ref.tuss_term
      WHERE tabela = $1::smallint AND codigo = $2 AND vigencia @> $3::date`,
    [tabela, codigo, eventDate],
  );
  const row = rows[0];
  if (!row) return err('codigo_inexistente_na_data');
  return ok({
    system: 'TUSS',
    tabela: Number(row.tabela),
    code: row.codigo as string,
    display: row.termo as string,
    terminologyVersion: row.competencia as string,
  });
}

/**
 * Carga de uma competencia inteira da ANS, em UMA transacao, numa unica conexao,
 * com o papel `jobs`. Se qualquer codigo sobrepuser vigencia existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01): meia carga e pior que nenhuma.
 */
export async function loadTussCompetencia(
  db: TransactionalDb,
  input: {
    competencia: string;
    vigenciaFrom: string;
    vigenciaTo: string | null;
    rows: ReadonlyArray<{ tabela: number; codigo: string; termo: string; acao: string }>;
  },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.rows) {
      await client.query(
        `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
         VALUES ($1::smallint, $2, $3, daterange($4::date, $5::date, '[)'), $6, $7)`,
        [r.tabela, r.codigo, r.termo, input.vigenciaFrom, input.vigenciaTo,
         input.competencia, r.acao],
      );
    }
    await client.query('COMMIT');
    return input.rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
