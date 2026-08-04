import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

// Tenants NOVOS a cada execucao, pela mesma razao ja documentada em
// no-mutate.int.test.ts e channel-b.int.test.ts: audit.event e append-only e
// nenhum afterAll consegue limpar o que este teste grava — o trigger no_mutate
// recusa o DELETE. Com tenant constante os eventos da rodada anterior
// sobrevivem, `row_count` cresce (3, 5, 7...) e a chave (tenant_id, seal_date)
// de audit.seal ja esta tomada: o selo do dia vira 23505, `run_seal` devolve
// 'erro' em vez de 'sucesso' e o watchdog nunca chega a 'ok'. Verificado no
// banco local: com tenant fixo a suite passa exatamente UMA vez.
//
// A saida nao e limpar, e sim isolar: cada rodada sela sob tenants que so ela
// conhece. As linhas antigas continuam la, como a norma exige, sem interferir.
const TENANT = randomUUID();
const TENANT_RUN_OK = randomUUID();
const TENANT_RUN_ADIADO = randomUUID();

async function inserirEvento(owner: Client, tipo: string): Promise<void> {
  await owner.query(
    `INSERT INTO audit.event
       (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
     VALUES ($1, 'system', $2, 'clin', 'encounter_version', 'sucesso', '{}'::jsonb)`,
    [TENANT, tipo],
  );
}

describe('audit.seal: selo diario, marca d agua de visibilidade e dead man switch', () => {
  let root: Client;
  let jobs: Client;
  let owner: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
    jobs = await connectAs('jobs');
    owner = await connectAs('audit_owner');
    await inserirEvento(owner, 'ENCOUNTER_FINALIZE');
    await inserirEvento(owner, 'ENCOUNTER_AMEND');
  });

  afterAll(async () => {
    await owner.end();
    await jobs.end();
    await root.end();
  });

  it('o papel jobs e o unico do cluster com BYPASSRLS', async () => {
    const res = await root.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY rolname',
    );
    expect(res.rows.map((r) => r.rolname)).toEqual(['jobs']);
  });

  it('a marca d agua exige pg_read_all_stats em jobs, senao o selo cega em silencio', async () => {
    const res = await root.query<{ ok: boolean }>(
      `SELECT pg_has_role('jobs', 'pg_read_all_stats', 'MEMBER') AS ok`,
    );
    expect(res.rows[0]?.ok).toBe(true);
  });

  it('adia o selo enquanto existe transacao COM ESCRITA aberta antes do fim do dia', async () => {
    const lote = await connectAs('audit_owner');
    try {
      // O "lote das 23h58": abriu antes do corte, ja escreveu e ainda nao commitou.
      await lote.query('BEGIN');
      await inserirEvento(lote, 'TISS_BATCH_SUBMIT');

      // Selar hoje com esse lote aberto entraria num dia que ainda pode receber
      // linhas: a verificacao futura acusaria adulteracao.
      await expect(
        jobs.query('SELECT audit.seal_day($1, CURRENT_DATE)', [TENANT]),
      ).rejects.toMatchObject({
        code: '55006',
        message: expect.stringContaining('selo adiado'),
      });

      await lote.query('COMMIT');
    } finally {
      await lote.end();
    }
  });

  it('depois do commit do lote, o selo fecha o dia contando as linhas do lote', async () => {
    const res = await jobs.query<{
      row_count: string;
      snapshot_xmin: string;
      chain_hash: Buffer;
      prev_chain_hash: Buffer | null;
    }>(
      `SELECT row_count::text, snapshot_xmin::text, chain_hash, prev_chain_hash
         FROM audit.seal_day($1, CURRENT_DATE)`,
      [TENANT],
    );

    const selo = res.rows[0];
    expect(selo).toBeDefined();
    expect(Number(selo?.row_count)).toBe(3);          // 2 do beforeAll + 1 do lote
    expect(Number(selo?.snapshot_xmin)).toBeGreaterThan(0);
    expect(selo?.chain_hash?.length).toBe(32);
    expect(selo?.prev_chain_hash).toBeNull();          // primeiro selo do tenant
  });

  it('nao sela o mesmo dia duas vezes', async () => {
    await expect(
      jobs.query('SELECT audit.seal_day($1, CURRENT_DATE)', [TENANT]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a aplicacao le o selo mas nao escreve nele', async () => {
    const res = await root.query<{ sel: boolean; ins: boolean; upd: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.seal', 'SELECT') AS sel,
              has_table_privilege('app_rw', 'audit.seal', 'INSERT') AS ins,
              has_table_privilege('app_rw', 'audit.seal', 'UPDATE') AS upd`,
    );
    expect(res.rows[0]).toEqual({ sel: true, ins: false, upd: false });
  });

  it('run_seal e o batimento do dead man switch: registra sucesso e o proprio evento', async () => {
    await root.query('TRUNCATE audit.seal_run');

    const res = await jobs.query<{ run_seal: string }>(
      'SELECT audit.run_seal($1, CURRENT_DATE) AS run_seal',
      [TENANT_RUN_OK],
    );
    expect(res.rows[0]?.run_seal).toBe('sucesso');

    const run = await root.query<{ outcome: string; finished: boolean }>(
      `SELECT outcome, finished_at IS NOT NULL AS finished FROM audit.seal_run`,
    );
    expect(run.rows).toEqual([{ outcome: 'sucesso', finished: true }]);

    // Sem esta linha o watchdog nunca sai de 'nunca_executou' em producao.
    const wd = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(wd.rows[0]?.status).toBe('ok');

    // §3.1: toda execucao de `jobs` grava evento proprio na trilha.
    const ev = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'SEAL_RUN' AND meta ->> 'job_name' = 'seal'`,
      [TENANT_RUN_OK],
    );
    expect(Number(ev.rows[0]?.n)).toBe(1);
  });

  it('run_seal registra adiado sem contar como sinal de vida', async () => {
    await root.query('TRUNCATE audit.seal_run');
    const lote = await connectAs('audit_owner');
    try {
      await lote.query('BEGIN');
      await inserirEvento(lote, 'TISS_BATCH_SUBMIT');

      const res = await jobs.query<{ run_seal: string }>(
        'SELECT audit.run_seal($1, CURRENT_DATE) AS run_seal',
        [TENANT_RUN_ADIADO],
      );
      expect(res.rows[0]?.run_seal).toBe('adiado');

      await lote.query('ROLLBACK');
    } finally {
      await lote.end();
    }

    const wd = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(wd.rows[0]?.status).toBe('nunca_executou');
  });

  it('sem nenhuma execucao registrada, o watchdog acusa ausencia, nao ok', async () => {
    await root.query('TRUNCATE audit.seal_run');
    const res = await jobs.query<{ status: string; ultima_execucao: Date | null }>(
      'SELECT * FROM audit.seal_watchdog()',
    );
    expect(res.rows[0]?.status).toBe('nunca_executou');
    expect(res.rows[0]?.ultima_execucao).toBeNull();
  });

  it('execucao que terminou em erro nao conta como sinal de vida', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, outcome, detail)
       VALUES ($1, CURRENT_DATE - 1, 'erro', 'conexao recusada')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('nunca_executou');
  });

  it('ultima execucao bem-sucedida ha 30 horas dispara o alarme de ausencia', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, started_at, finished_at, outcome)
       VALUES ($1, CURRENT_DATE - 2, clock_timestamp() - interval '30 hours',
               clock_timestamp() - interval '30 hours', 'sucesso')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('ausente');
  });

  it('execucao bem-sucedida ha 2 horas mantem o watchdog em ok', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, started_at, finished_at, outcome)
       VALUES ($1, CURRENT_DATE - 1, clock_timestamp() - interval '2 hours',
               clock_timestamp() - interval '2 hours', 'sucesso')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('ok');
  });
});
