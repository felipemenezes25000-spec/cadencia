import type { Queryable } from '../queryable';

export interface AuditAliveOptions {
  /** Defasagem maxima aceita entre agora e o evento mais recente. Ausente = sem limite. */
  maxLagMinutes?: number;
}

async function relationExists(db: Queryable, relation: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>('SELECT to_regclass($1) IS NOT NULL AS existe', [relation]);
  return rows[0]?.existe === true;
}

/**
 * A trilha nao pode so existir: uma tabela audit.event vazia da impressao de controle
 * e nao prova nada em auditoria. Num banco recem-migrado o check reprova de proposito —
 * a resposta certa e exercitar audit.log, nao afrouxar o invariante.
 */
export async function auditAliveViolations(db: Queryable, opts: AuditAliveOptions = {}): Promise<string[]> {
  if (!(await relationExists(db, 'audit.event'))) {
    return ['audit.event nao existe — a trilha nao e opcional'];
  }

  const { rows } = await db.query<{ total: string; lag_minutes: string | null }>(
    `SELECT count(*)::text AS total,
            round(extract(epoch FROM (now() - max(occurred_at))) / 60)::text AS lag_minutes
       FROM audit.event`,
  );
  const total = Number(rows[0]?.total ?? '0');
  if (total === 0) {
    return ['audit.event vazio — a trilha existe e ninguem escreve nela'];
  }

  const limite = opts.maxLagMinutes;
  const atraso = rows[0]?.lag_minutes;
  if (limite !== undefined && atraso !== null && atraso !== undefined && Number(atraso) > limite) {
    return [`audit.event parado ha ${Number(atraso)} min (orcamento: ${limite} min)`];
  }

  return [];
}
