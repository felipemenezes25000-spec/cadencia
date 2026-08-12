import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DATABASE_URL_ADMIN, não DATABASE_URL: o papel `api` só passa a existir na
// migration 0001, e este teste roda antes de qualquer migration.
const DATABASE_URL_ADMIN =
  process.env['DATABASE_URL_ADMIN'] ?? 'postgres://postgres@localhost:5433/cadencia';
const client = new Client({ connectionString: DATABASE_URL_ADMIN });

beforeAll(async () => { await client.connect(); });
afterAll(async () => { await client.end(); });

async function scalar(sql: string): Promise<string> {
  const result = await client.query<{ v: string }>(sql);
  return String(result.rows[0]?.v);
}

// O Actions usa um service container PostgreSQL puro; estas garantias pertencem
// ao docker-compose local e são cobertas somente quando ele é o alvo do teste.
const describeCompose = process.env['CI'] ? describe.skip : describe;

describeCompose('cluster local de desenvolvimento', () => {
  it('roda PostgreSQL 18 ou superior', async () => {
    const version = Number(await scalar("SELECT current_setting('server_version_num') AS v"));
    expect(version).toBeGreaterThanOrEqual(180000);
  });

  it('roda em UTC: horario de Brasilia entra e volta convertido, e nenhuma data do sistema depende do fuso da maquina', async () => {
    expect(await scalar("SELECT current_setting('TimeZone') AS v")).toBe('UTC');
    expect(await scalar("SELECT ('2026-08-03 00:00:00-03'::timestamptz)::text AS v"))
      .toBe('2026-08-03 03:00:00+00');
  });

  it('tem as seis extensoes da secao 2.3 que a imagem oficial do PostgreSQL 18 fornece', async () => {
    const result = await client.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const installed = result.rows.map((row) => row.extname);
    for (const extension of ['pgcrypto', 'btree_gist', 'btree_gin', 'pg_trgm', 'unaccent', 'citext']) {
      expect(installed, `extensao ${extension} ausente`).toContain(extension);
    }
  });

  it('nao tem pg_partman disponivel na imagem, e a ausencia e uma decisao registrada, nao um esquecimento', async () => {
    // pg_partman é a SÉTIMA extensão da seção 2.3 e NÃO acompanha a imagem oficial
    // (não é contrib). A Fase 0 cria as partições com DDL declarativa nativa, escrita
    // a mão na migration; a manutenção automática por pg_partman entra junto com a
    // imagem própria.
    //
    // Consulta pg_available_extensions (o que a IMAGEM oferece), não pg_extension
    // (o que está INSTALADO): CREATE EXTENSION pg_partman é fisicamente impossível
    // sem os arquivos da extensão na imagem, então um teste contra pg_extension
    // nunca falharia pelo motivo que declara. Este teste falha no dia em que alguém
    // trocar postgres:18 por uma imagem própria que traga pg_partman — que é quando
    // o dev diverge de produção e a decisão precisa ser revisitada conscientemente.
    const result = await client.query<{ name: string }>(
      "SELECT name FROM pg_available_extensions WHERE name = 'pg_partman'",
    );
    expect(result.rows).toHaveLength(0);
  });

  it('aceita indice GIN liderado por tenant_id — e exatamente isso que btree_gin habilita', async () => {
    await client.query('DROP TABLE IF EXISTS gin_probe');
    await client.query('CREATE TABLE gin_probe (tenant_id uuid NOT NULL, search_name text NOT NULL)');
    try {
      await client.query('CREATE INDEX ix_gin_probe ON gin_probe USING gin (tenant_id, search_name gin_trgm_ops)');
      const result = await client.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_gin_probe'",
      );
      expect(result.rows[0]?.indexdef).toContain('USING gin (tenant_id, search_name gin_trgm_ops)');
    } finally {
      await client.query('DROP TABLE IF EXISTS gin_probe');
    }
  });

  it('pg_stat_statements esta pre-carregado (shared_preload_libraries), nao so instalado', async () => {
    // CREATE EXTENSION pg_stat_statements sem shared_preload_libraries cria a view
    // vazia, silenciosamente, sem erro. Este teste garante que a config exigida no
    // command do docker-compose.yml continua de pé, e não só a extensão instalada.
    const preloaded = await scalar("SELECT current_setting('shared_preload_libraries') AS v");
    expect(preloaded.split(',').map((s) => s.trim())).toContain('pg_stat_statements');
  });

  it('remove acento na busca (unaccent) e compara nome sem diferenciar caixa (citext)', async () => {
    expect(await scalar("SELECT unaccent('Coração') AS v")).toBe('Coracao');
    expect(await scalar("SELECT ('Ana'::citext = 'ana'::citext) AS v")).toBe('true');
  });
});
