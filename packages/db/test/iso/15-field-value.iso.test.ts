import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

/**
 * §3.5 e §10 item 15 — a tabela de valores nasce particionada. Sao leituras de
 * catalogo puras, entao usam o cliente administrativo direto: nao ha linha para
 * isolar nem preambulo a aplicar.
 */
describe('clin.encounter_field_value', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  it('e particionada por RANGE (finalized_at) desde o dia 1', async () => {
    const { rows } = await admin.query<{ strategy: string }>(
      `SELECT partstrat AS strategy FROM pg_partitioned_table
        WHERE partrelid = 'clin.encounter_field_value'::regclass`,
    );
    expect(rows[0]?.strategy).toBe('r');
  });

  it('a unicidade inclui ordinal — multipla escolha vira N linhas', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_field_value'::regclass AND contype = 'u'`,
    );
    expect(rows.map((r) => r.def)).toContain(
      'UNIQUE (finalized_at, version_id, field_id, section_instance, ordinal)',
    );
  });

  it('exige exatamente UM slot preenchido, salvo linha expurgada', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_field_value'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'`,
    );
    expect(rows[0]?.def).toContain('purged_at IS NOT NULL');
    expect(rows[0]?.def).toContain('num_nonnulls');
  });

  it('cada particao herda RLS habilitada, FORCADA e as policies do pai', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      n: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS n
         FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'clin.encounter_field_value'::regclass AND c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} sem RLS`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} sem FORCE`).toBe(true);
      expect(Number(r.n), `${r.relname} sem policy`).toBeGreaterThanOrEqual(1);
    }
  });
});
