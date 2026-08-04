import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

/**
 * §3.6 — quatro dominios saem do EAV. Sao leituras de catalogo puras, entao usam
 * o cliente administrativo direto, no mesmo espirito da suite 15: nao ha linha
 * para isolar nem preambulo a aplicar.
 *
 * O cliente `admin` e tambem o unico que enxerga information_schema inteiro:
 * as views de privilegio so mostram grant cujo papel e habilitado para quem
 * consulta, e `app_rw` nao e membro de `clin_writer` nem de `app_owner`.
 */
const TABELAS = ['diagnosis', 'observation', 'encounter_finding', 'procedure'] as const;

describe('tabelas de primeira classe', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  it.each(TABELAS)('%s: app_rw so le; clin_writer insere e atualiza apenas live', async (t) => {
    const { rows } = await admin.query<{
      grantee: string;
      privilege_type: string;
      column_name: string | null;
    }>(
      `SELECT grantee, privilege_type, NULL::text AS column_name
         FROM information_schema.role_table_grants
        WHERE table_schema='clin' AND table_name=$1 AND grantee IN ('app_rw','clin_writer')
       UNION ALL
       SELECT grantee, privilege_type, column_name
         FROM information_schema.column_privileges
        WHERE table_schema='clin' AND table_name=$1 AND grantee='clin_writer'
          AND privilege_type='UPDATE'
        ORDER BY 1,2,3`,
      [t],
    );

    const appRw = rows.filter((r) => r.grantee === 'app_rw').map((r) => r.privilege_type);
    expect(appRw).toEqual(['SELECT']);

    const colunasUpdate = rows
      .filter((r) => r.grantee === 'clin_writer' && r.privilege_type === 'UPDATE' && r.column_name)
      .map((r) => r.column_name);
    expect(colunasUpdate).toEqual(['live']);
  });

  it.each(TABELAS)('%s: tem policy RESTRICTIVE e RLS forcada', async (t) => {
    const { rows } = await admin.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      restritivas: string;
    }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p
                WHERE p.polrelid = c.oid AND NOT p.polpermissive) AS restritivas
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='clin' AND c.relname=$1`,
      [t],
    );

    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
    expect(Number(rows[0]?.restritivas)).toBeGreaterThanOrEqual(1);
  });

  it('o indice de relatorio de diagnostico e parcial em live', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname='clin' AND indexname='ix_diag_report'`,
    );
    expect(rows[0]?.def).toContain('WHERE live');
    expect(rows[0]?.def).toContain('tenant_id, code_system, code');
  });

  it('observation guarda o codigo do catalogo global, nao texto livre', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_constraint
        WHERE conrelid='clin.observation'::regclass AND contype='f'
          AND confrelid='ref.observation_code'::regclass`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
