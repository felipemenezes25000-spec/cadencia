// apps/worker/src/jobs/audit-seal.ts
import { jobsPool } from '@cadencia/db';

/**
 * O SELO DIARIO DA TRILHA.
 *
 * A trilha de auditoria e append-only por REVOKE, o que impede que a aplicacao
 * apague uma linha. Nao impede, porem, que alguem com acesso ao banco reescreva
 * o passado. O que transforma REGISTRO em PROVA e o selo: uma vez por dia,
 * calcula-se o hash encadeado das linhas daquele dia e grava-se um resumo
 * assinado. Removida uma linha do meio, o encadeamento quebra e todo dia
 * posterior denuncia a alteracao.
 *
 * A maquinaria mora no banco (`audit.seal_day`, `audit.run_seal`), porque ela
 * precisa ler a trilha inteira de todos os tenants — e so `jobs`, o unico papel
 * com BYPASSRLS, enxerga isso. Este arquivo e o AGENDADOR: decide quais tenants
 * selar e registra o resultado.
 *
 * §9 lista "selo da auditoria falha em silencio" como risco que pode matar o
 * produto, com a observacao de que job que para nao faz barulho. Por isso
 * `vigiarSelo` existe e e chamado junto: ele transforma AUSENCIA de execucao em
 * alarme, que e o modo de falha que ninguem percebe sozinho.
 */

export interface SeloResult {
  readonly dia: string;
  readonly tenantsSelados: number;
  /**
   * Adiado NAO e falha. `audit.run_seal` devolve 'adiado' com sqlstate 55006
   * quando o lock nao esta disponivel — outra execucao esta selando o mesmo
   * tenant. Contar isso como erro faria o alarme disparar por concorrencia
   * normal, e alarme que grita a toa e alarme que ninguem le.
   */
  readonly adiados: number;
  /** Dia ja selado numa execucao anterior. Reexecutar e no-op, nao erro. */
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
 * Tenant sem evento nenhum NAO e selado, e isso e proposital: selo de dia vazio
 * ocuparia a cadeia com linhas que nao provam nada e faria o vigia relatar
 * sucesso para uma clinica que talvez esteja com a aplicacao fora do ar.
 */
export async function selarTrilha(opts: { dia?: string } = {}): Promise<SeloResult> {
  const pool = jobsPool();

  const { rows: dias } = await pool.query<{ dia: string }>(
    opts.dia !== undefined
      ? `SELECT $1::date::text AS dia`
      : `SELECT (clock_timestamp() - interval '1 day')::date::text AS dia`,
    opts.dia !== undefined ? [opts.dia] : []);
  const dia = dias[0]!.dia;

  // Quem JA tem selo do dia fica de fora da lista, e nao e tentado de novo.
  //
  // `audit.seal` tem PK (tenant_id, seal_date) e `audit.run_seal` nao trata o
  // 23505: reexecutar registraria 'erro' em seal_run e o vigia acusaria falha
  // por causa de um dia que esta selado corretamente. Filtrar aqui torna o job
  // idempotente sem depender de casar a mensagem de erro do banco, que e a
  // forma mais fragil de detectar qualquer coisa.
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
      // `audit.run_seal` ja grava em audit.seal_run — sucesso e fracasso ficam
      // registrados no banco, nao apenas no log deste processo, que some.
      const { rows } = await pool.query<{ outcome: string }>(
        `SELECT audit.run_seal($1, $2::date) AS outcome`, [t.tenant_id, dia]);
      const outcome = rows[0]?.outcome ?? 'desconhecido';
      detalhes.push({ tenantId: t.tenant_id, outcome });
      if (outcome === 'sucesso') selados += 1;
      else if (outcome === 'adiado') adiados += 1;
      else falhas += 1;
    } catch (e) {
      // Falha de um tenant nao pode abortar os outros: um selo perdido e ruim,
      // todos os selos perdidos e o fim da garantia.
      falhas += 1;
      detalhes.push({ tenantId: t.tenant_id, outcome: `erro: ${(e as Error).message}` });
    }
  }

  return { dia, tenantsSelados: selados, adiados, jaSelados, falhas, detalhes };
}

/**
 * Dead man's switch. Pergunta ao banco ha quanto tempo o selo nao roda e
 * devolve um status acionavel.
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
