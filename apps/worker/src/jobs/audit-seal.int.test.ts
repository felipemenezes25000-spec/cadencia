import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { selarTrilha, vigiarSelo } from './audit-seal';

afterAll(async () => { await closePools(); });

/**
 * Tenant proprio por teste. O worker nao importa o test-support da api — sao
 * irmaos em L3 e import entre irmaos e proibido (§2.2 regra 2).
 */
async function semearTenant(): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    await admin.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Selo Test', '88888888000188')`,
      [tenantId, `selo-${tenantId.replace(/-/g, '').slice(0, 16)}`]);
    await admin.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Selo', '2077511', 'America/Sao_Paulo')`,
      [tenantId, clinicId]);
  } finally {
    await admin.end();
  }
  return { tenantId, clinicId };
}

/**
 * Gera uma linha de trilha real, chamando `audit.log` — nao inserindo na tabela.
 *
 * Vai pela conexao ADMIN e nao pelo pool de `jobs`: `audit.log` e concedida a
 * app_rw, e nao a jobs. E correto que seja assim — o papel dos jobs LE a trilha
 * para selar, nunca escreve nela.
 */
async function gerarEvento(tenantId: string, clinicId: string): Promise<void> {
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.clinic_id', $2, TRUE),
              set_config('app.user_id', '', TRUE),
              set_config('app.actor_kind', 'system', TRUE),
              set_config('app.request_id', '', TRUE)`,
      [tenantId, clinicId]);
    await c.query(
      `SELECT audit.log('SEAL_TEST_PROBE','ref','action',NULL,'sucesso','{}'::jsonb,$1)`,
      [clinicId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
}

describe('selo diario da trilha', () => {
  it('sela o dia de cada tenant que teve movimento e registra a execucao', async () => {
    const s = await semearTenant();
    await gerarEvento(s.tenantId, s.clinicId);

    const hoje = new Date().toISOString().slice(0, 10);
    const r = await selarTrilha({ dia: hoje });

    expect(r.tenantsSelados).toBeGreaterThan(0);
    expect(r.falhas).toBe(0);

    const { rows: selo } = await jobsPool().query<{
      row_count: string; chain_hash: Buffer | null }>(
      `SELECT row_count, chain_hash FROM audit.seal
        WHERE tenant_id = $1 AND seal_date = $2::date`, [s.tenantId, hoje]);

    expect(selo).toHaveLength(1);
    expect(Number(selo[0]?.row_count)).toBeGreaterThan(0);
    // O selo sem hash de cadeia nao sela nada: e o encadeamento que torna
    // impossivel remover uma linha do meio sem quebrar tudo depois dela.
    expect(selo[0]?.chain_hash).not.toBeNull();

    const { rows: execucao } = await jobsPool().query<{ outcome: string }>(
      `SELECT outcome FROM audit.seal_run
        WHERE tenant_id = $1 AND seal_date = $2::date
        ORDER BY started_at DESC LIMIT 1`, [s.tenantId, hoje]);
    expect(execucao[0]?.outcome).toBe('sucesso');
  });

  it('selar duas vezes o mesmo dia nao duplica o selo', async () => {
    const s = await semearTenant();
    await gerarEvento(s.tenantId, s.clinicId);
    const hoje = new Date().toISOString().slice(0, 10);

    const primeira = await selarTrilha({ dia: hoje });
    const segunda = await selarTrilha({ dia: hoje });

    // A segunda passada nao sela ninguem e nao reprova nada: o dia ja esta
    // selado, e reexecutar precisa ser inofensivo para o job poder ser
    // reenfileirado sem medo.
    expect(primeira.tenantsSelados).toBeGreaterThan(0);
    expect(segunda.tenantsSelados).toBe(0);
    expect(segunda.falhas).toBe(0);

    const { rows } = await jobsPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.seal
        WHERE tenant_id = $1 AND seal_date = $2::date`, [s.tenantId, hoje]);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('o vigia denuncia ausencia de execucao — nao silencio', async () => {
    // Dead man's switch (§9): job que para nao faz barulho sozinho. O vigia
    // existe para transformar AUSENCIA em alarme, que e o modo de falha que
    // mata a garantia sem ninguem perceber.
    const recente = await vigiarSelo({ atrasoMaximo: '48 hours' });
    expect(recente.status).toBe('ok');

    const impaciente = await vigiarSelo({ atrasoMaximo: '1 microsecond' });
    expect(impaciente.status).not.toBe('ok');
    expect(impaciente.atrasado).toBe(true);
  });
});
