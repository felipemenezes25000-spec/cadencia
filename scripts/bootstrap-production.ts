import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../packages/db/src/migrate';
import { syncActionCatalog } from '../tools/sync-action-catalog';
import { installJobSchema } from '../apps/worker/src/pgboss-bootstrap';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`variável de ambiente ausente: ${name}`);
  return value;
}

function databaseUrl(user: string, password: string): string {
  const url = new URL('postgres://localhost');
  url.username = user;
  url.password = password;
  url.hostname = process.env['DB_HOST'] ?? 'db';
  url.port = process.env['DB_PORT'] ?? '5432';
  url.pathname = `/${process.env['DB_NAME'] ?? 'cadencia'}`;
  return url.toString();
}

async function rolePassword(client: PoolClient, role: 'api' | 'jobs', password: string) {
  const { rows } = await client.query<{ sql: string }>(
    `SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
    [role, password],
  );
  await client.query(rows[0]!.sql);
}

async function databasePrivilege(client: PoolClient, command: 'GRANT' | 'REVOKE') {
  const { rows } = await client.query<{ sql: string }>(
    `SELECT format($1 || ' CREATE ON DATABASE %I ' ||
                   CASE WHEN $1 = 'GRANT' THEN 'TO' ELSE 'FROM' END || ' jobs',
                   current_database()) AS sql`,
    [command],
  );
  await client.query(rows[0]!.sql);
}

async function allowExistingJobSchema(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ present: boolean }>(
    `SELECT to_regnamespace('pgboss') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) return;
  const { rows: ownership } = await client.query<{ sql: string }>(
    `SELECT CASE c.relkind
              WHEN 'S' THEN format('ALTER SEQUENCE %I.%I OWNER TO jobs', n.nspname, c.relname)
              ELSE format('ALTER TABLE %I.%I OWNER TO jobs', n.nspname, c.relname)
            END AS sql
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p', 'S')`,
  );
  for (const item of ownership) await client.query(item.sql);
  await client.query('ALTER SCHEMA pgboss OWNER TO jobs');
  await client.query('GRANT USAGE, CREATE ON SCHEMA pgboss TO jobs');
  await client.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgboss TO jobs');
  await client.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgboss TO jobs');
  await client.query('GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pgboss TO jobs');
}

async function main(): Promise<void> {
  const postgresPassword = required('POSTGRES_PASSWORD');
  const apiPassword = required('API_PASSWORD');
  const jobsPassword = required('JOBS_PASSWORD');
  const adminUrl = databaseUrl('postgres', postgresPassword);
  const jobsUrl = databaseUrl('jobs', jobsPassword);

  await runMigrations({ connectionString: adminUrl });

  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const client = await admin.connect();
  let createGranted = false;
  try {
    await client.query('BEGIN');
    await rolePassword(client, 'api', apiPassword);
    await rolePassword(client, 'jobs', jobsPassword);
    const actions = await syncActionCatalog(client);
    await databasePrivilege(client, 'GRANT');
    createGranted = true;
    await allowExistingJobSchema(client);
    await client.query('COMMIT');

    // Só o bootstrap migra o schema interno do pg-boss. O worker roda depois
    // com `migrate:false` e sem CREATE no banco durante toda a sua vida útil.
    await installJobSchema(jobsUrl, jobsPassword);
    process.stdout.write(`bootstrap concluído: ${actions} ações sincronizadas\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (createGranted) await databasePrivilege(client, 'REVOKE').catch(() => undefined);
    client.release();
    await admin.end();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
