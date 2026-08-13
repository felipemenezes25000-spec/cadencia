/**
 * @cadencia/bulas
 *
 * Stub — busca de medicamentos e bulas.
 * Implementação completa virá em fase futura.
 */
import type { TxClient } from '@cadencia/db';

export interface DrugSearchResult {
  id: string;
  registroAnvisa: string;
  nome: string;
  principioAtivo: string;
  classeTerapeutica: string | null;
  concentracao: string | null;
  formaFarmaceutica: string | null;
  fabricante: string | null;
  tsRank: number;
}

export async function searchDrugs(
  tx: TxClient, query: string, limit: number,
): Promise<DrugSearchResult[]> {
  const { rows } = await tx.query<DrugRow>(
    `SELECT id, registro_anvisa, nome, principio_ativo, classe_terapeutica,
            concentracao, forma_farmaceutica, fabricante,
            ts_rank(
              to_tsvector('portuguese', nome || ' ' || principio_ativo),
              websearch_to_tsquery('portuguese', $1)
            ) AS ts_rank,
            created_at
       FROM drug.medicamento
      WHERE nome ILIKE '%' || $1 || '%'
         OR principio_ativo ILIKE '%' || $1 || '%'
      ORDER BY (nome ILIKE $1 || '%') DESC, ts_rank DESC, nome
      LIMIT $2`,
    [query, limit],
  );
  return rows.map(mapDrug);
}

export async function getDrugById(
  tx: TxClient, id: string,
): Promise<(DrugSearchResult & { createdAt: Date }) | null> {
  const { rows } = await tx.query<DrugRow>(
    `SELECT id, registro_anvisa, nome, principio_ativo, classe_terapeutica,
            concentracao, forma_farmaceutica, fabricante, 0::real AS ts_rank,
            created_at
       FROM drug.medicamento
      WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapDrug(rows[0]) : null;
}

export interface DrugLeaflet {
  id: string;
  medicamentoId: string;
  tipo: 'paciente' | 'profissional';
  conteudo: string;
  versao: string | null;
  dataPublicacao: Date | null;
  createdAt: Date;
}

export async function getLeaflet(
  tx: TxClient, medicamentoId: string, tipo: 'paciente' | 'profissional',
): Promise<DrugLeaflet | null> {
  const { rows } = await tx.query<LeafletRow>(
    `SELECT id, medicamento_id, tipo, conteudo, versao, data_publicacao, created_at
       FROM drug.bula
      WHERE medicamento_id = $1 AND tipo = $2
      ORDER BY data_publicacao DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [medicamentoId, tipo],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    medicamentoId: row.medicamento_id,
    tipo: row.tipo as DrugLeaflet['tipo'],
    conteudo: row.conteudo,
    versao: row.versao,
    dataPublicacao: row.data_publicacao,
    createdAt: row.created_at,
  };
}

interface DrugRow {
  id: string;
  registro_anvisa: string;
  nome: string;
  principio_ativo: string;
  classe_terapeutica: string | null;
  concentracao: string | null;
  forma_farmaceutica: string | null;
  fabricante: string | null;
  ts_rank: number;
  created_at: Date;
}

interface LeafletRow {
  id: string;
  medicamento_id: string;
  tipo: string;
  conteudo: string;
  versao: string | null;
  data_publicacao: Date | null;
  created_at: Date;
}

function mapDrug(row: DrugRow): DrugSearchResult & { createdAt: Date } {
  return {
    id: row.id,
    registroAnvisa: row.registro_anvisa,
    nome: row.nome,
    principioAtivo: row.principio_ativo,
    classeTerapeutica: row.classe_terapeutica,
    concentracao: row.concentracao,
    formaFarmaceutica: row.forma_farmaceutica,
    fabricante: row.fabricante,
    tsRank: Number(row.ts_rank),
    createdAt: row.created_at,
  };
}
