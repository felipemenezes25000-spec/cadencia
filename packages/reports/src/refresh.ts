// packages/reports/src/refresh.ts
import type { Pool } from 'pg';
import type { RefreshLogEntry } from './types';

/**
 * Nomes das matviews no schema rpt. Cada uma tem uma função
 * rpt.refresh_<nome>() SECURITY DEFINER pertencente a rpt_owner.
 */
export const MATVIEW_NAMES = [
  'mv_atendimentos',
  'mv_financeiro',
  'mv_agenda',
  'mv_pacientes',
  'mv_satisfacao',
] as const;

export type MatviewName = (typeof MATVIEW_NAMES)[number];

function isMatviewName(name: string): name is MatviewName {
  return (MATVIEW_NAMES as readonly string[]).includes(name);
}

/**
 * Executa o refresh de uma matview chamando a função SECURITY DEFINER
 * correspondente. Deve ser chamado pelo worker usando o jobsPool (papel jobs).
 *
 * §3.8: NUNCA full refresh em horário comercial. O worker configura a
 * frequência e o horário de execução via pg-boss.
 */
export async function refreshMatview(pool: Pool, name: MatviewName): Promise<void> {
  if (!isMatviewName(name)) {
    throw new Error(`matview desconhecida: ${name}`);
  }
  await pool.query(`SELECT rpt.refresh_${name}()`);
}

/**
 * Retorna o refresh mais recente de cada matview, ordenado por horário
 * decrescente. Usado pela API para exibir "dados ate HH:MM" na tela.
 */
export async function getLatestRefresh(pool: Pool): Promise<RefreshLogEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    matview_name: string;
    started_at: Date;
    finished_at: Date | null;
    row_count: string;
    success: boolean;
    error_message: string | null;
  }>(`
    SELECT DISTINCT ON (matview_name)
           id, matview_name, started_at, finished_at,
           row_count, success, error_message
      FROM rpt.refresh_log
     ORDER BY matview_name, started_at DESC`);

  return rows.map((r) => ({
    id: Number(r.id),
    matviewName: r.matview_name,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    rowCount: Number(r.row_count),
    success: r.success,
    errorMessage: r.error_message,
  }));
}
