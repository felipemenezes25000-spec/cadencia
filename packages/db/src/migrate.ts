import { Pool } from 'pg';
import { assertForwardOnly, readMigrationFiles } from './migration-files';
import { migrationsDir } from './paths';

// Chave arbitrária e fixa do advisory lock: dois deploys simultâneos não aplicam
// a mesma migration duas vezes.
const LOCK_KEY = 4_021_976;

export interface MigrateOptions {
  readonly connectionString?: string;
  readonly dir?: string;
}

export interface MigrateResult {
  readonly applied: string[];
}

export async function runMigrations(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL_ADMIN;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: migrations usam a conexao administrativa, nunca a do papel `api`',
    );
  }
  const dir = opts.dir ?? migrationsDir();

  const pool = new Pool({ connectionString, max: 1, application_name: 'cadencia-migrate' });
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // O lock vem ANTES do CREATE TABLE: advisory lock é de sessão e não depende da
    // tabela existir. `CREATE TABLE IF NOT EXISTS` concorrente não é atômico no
    // PostgreSQL — dois migrates partindo juntos contra um banco virgem falhariam com
    // duplicate key em pg_type_typname_nsp_index em vez do no-op silencioso.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migration (
        version     text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        duration_ms integer NOT NULL)`);

    const state = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migration',
    );
    const pending = assertForwardOnly(
      readMigrationFiles(dir),
      new Map(state.rows.map((r) => [r.version, r.checksum])),
    );

    for (const migration of pending) {
      // performance.now(), nunca o relógio de parede: duração é MEDIÇÃO, e a guarda
      // de fonte de tempo (tools/repo/time-source.ts) reprova relógio de parede em
      // packages/** — inclusive quando o nome proibido aparece só em comentário.
      const startedAt = performance.now();
      try {
        // Uma transação por arquivo: ou o arquivo inteiro entra, ou nada entra.
        // Consequência consciente: nada de CREATE INDEX CONCURRENTLY numa migration.
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.schema_migration (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [
            migration.version,
            migration.name,
            migration.checksum,
            Math.round(performance.now() - startedAt),
          ],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migration.name} falhou: ${(err as Error).message}`, {
          cause: err,
        });
      }
      applied.push(migration.name);
    }

    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}
