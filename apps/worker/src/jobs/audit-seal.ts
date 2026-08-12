// apps/worker/src/jobs/audit-seal.ts
import { jobsPool } from '@cadencia/db';

/**
 * O SELO DIÁRIO DA TRILHA.
 *
 * A trilha de auditoria é append-only por REVOKE, o que impede que a aplicação
 * apague uma linha. Não impede, porém, que alguém com acesso ao banco reescreva
 * o passado. O que transforma REGISTRO em PROVA é o selo: uma vez por dia,
 * calcula-se o hash encadeado das linhas daquele dia e grava-se um resumo
 * assinado. Removida uma linha do meio, o encadeamento quebra e todo dia
 * posterior denuncia a alteração.
 *
 * A maquinaria mora no banco (`audit.seal_day`, `audit.run_seal`), porque ela
 * precisa ler a trilha inteira de todos os tenants — e só `jobs`, o único papel
 * com BYPASSRLS, enxerga isso. Este arquivo é o AGENDADOR: decide quais tenants
 * selar e registra o resultado.
 *
 * §9 lista "selo da auditoria falha em silêncio" como risco que pode matar o
 * produto, com a observação de que job que para não faz barulho. Por isso
 * `vigiarSelo` existe e é chamado junto: ele transforma AUSÊNCIA de execução em
 * alarme, que é o modo de falha que ninguém percebe sozinho.
 */

export interface SeloResult {
  readonly dia: string;
  readonly tenantsSelados: number;
  /**
   * Adiado NÃO é falha. `audit.run_seal` devolve 'adiado' com sqlstate 55006
   * quando o lock não está disponível — outra execução está selando o mesmo
   * tenant. Contar isso como erro faria o alarme disparar por concorrência
   * normal, e alarme que grita à toa é alarme que ninguém lê.
   */
  readonly adiados: number;
  /** Dia já selado numa execução anterior. Reexecutar é no-op, não erro. */
  readonly jaSelados: number;
  readonly falhas: number;
  readonly detalhes: readonly { tenantId: string; outcome: string }[];
}

export interface VigiaResult {
  readonly status: string;
  readonly ultimaExecucao: string | null;
  readonly atrasado: boolean;
}

/**
 * Sela o dia para todo tenant que teve movimento na trilha.
 *
 * Tenant sem evento nenhum NÃO é selado, e isso é proposital: selo de dia vazio
 * ocuparia a cadeia com linhas que não provam nada e faria o vigia relatar
 * sucesso para uma clínica que talvez esteja com a aplicação fora do ar.
 */
export async function selarTrilha(opts: { dia?: string } = {}): Promise<SeloResult> {
  const pool = jobsPool();

  const { rows: dias } = await pool.query<{ dia: string }>(
    opts.dia !== undefined
      ? `SELECT $1::date::text AS dia`
      : `SELECT (clock_timestamp() - interval '1 day')::date::text AS dia`,
    opts.dia !== undefined ? [opts.dia] : []);
  const dia = dias[0]!.dia;

  // Quem JÁ tem selo do dia fica de fora da lista, e não é tentado de novo.
  //
  // `audit.seal` tem PK (tenant_id, seal_date) e `audit.run_seal` não trata o
  // 23505: reexecutar registraria 'erro' em seal_run e o vigia acusaria falha
  // por causa de um dia que está selado corretamente. Filtrar aqui torna o job
  // idempotente sem depender de casar a mensagem de erro do banco, que é a
  // forma mais frágil de detectar qualquer coisa.
  const { rows: tenants } = await pool.query<{ tenant_id: string }>(
    `SELECT DISTINCT e.tenant_id
       FROM audit.event e
      WHERE e.occurred_at >= $1::date
        AND e.occurred_at <  ($1::date + 1)
        AND e.tenant_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM audit.seal s
           WHERE s.tenant_id = e.tenant_id AND s.seal_date = $1::date)`,
    [dia]);

  const { rows: contagemJa } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM audit.seal WHERE seal_date = $1::date`, [dia]);
  const jaSelados = Number(contagemJa[0]?.n ?? 0);

  const detalhes: { tenantId: string; outcome: string }[] = [];
  let falhas = 0;
  let adiados = 0;
  let selados = 0;

  for (const t of tenants) {
    try {
      // `audit.run_seal` já grava em audit.seal_run — sucesso e fracasso ficam
      // registrados no banco, não apenas no log deste processo, que some.
      const { rows } = await pool.query<{ outcome: string }>(
        `SELECT audit.run_seal($1, $2::date) AS outcome`, [t.tenant_id, dia]);
      const outcome = rows[0]?.outcome ?? 'desconhecido';
      detalhes.push({ tenantId: t.tenant_id, outcome });
      if (outcome === 'sucesso') selados += 1;
      else if (outcome === 'adiado') adiados += 1;
      else falhas += 1;
    } catch (e) {
      // Falha de um tenant não pode abortar os outros: um selo perdido é ruim,
      // todos os selos perdidos é o fim da garantia.
      falhas += 1;
      detalhes.push({ tenantId: t.tenant_id, outcome: `erro: ${(e as Error).message}` });
    }
  }

  return { dia, tenantsSelados: selados, adiados, jaSelados, falhas, detalhes };
}

/**
 * Dead man's switch. Pergunta ao banco há quanto tempo o selo não roda e
 * devolve um status acionável.
 */
export async function vigiarSelo(
  opts: { atrasoMaximo?: string } = {},
): Promise<VigiaResult> {
  const { rows } = await jobsPool().query<{
    status: string; ultima_execucao: Date | null; atraso: string | null;
  }>(
    `SELECT status, ultima_execucao, atraso::text AS atraso
       FROM audit.seal_watchdog($1::interval)`,
    [opts.atrasoMaximo ?? '26 hours']);

  const r = rows[0];
  return {
    status: r?.status ?? 'desconhecido',
    ultimaExecucao: r?.ultima_execucao === null || r?.ultima_execucao === undefined
      ? null : r.ultima_execucao.toISOString(),
    atrasado: (r?.status ?? '') !== 'ok',
  };
}
