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
  _tx: TxClient, _query: string, _limit: number,
): Promise<DrugSearchResult[]> {
  return [];
}

export async function getDrugById(
  _tx: TxClient, _id: string,
): Promise<(DrugSearchResult & { createdAt: Date }) | null> {
  return null;
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
  _tx: TxClient, _medicamentoId: string, _tipo: 'paciente' | 'profissional',
): Promise<DrugLeaflet | null> {
  return null;
}
