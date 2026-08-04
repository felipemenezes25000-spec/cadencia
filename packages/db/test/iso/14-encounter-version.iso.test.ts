import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, semContexto } from './harness';
import * as F from './fixtures';

/**
 * §3.5 — a versao e a unidade assinavel do registro clinico, e a imutabilidade
 * dela nao e convencao: e permissao (app_rw sem INSERT) mais trigger (UPDATE e
 * DELETE negados ate para o superusuario).
 *
 * O cliente `admin` aqui e o superusuario do container: e ele que prova o "para
 * QUALQUER papel", porque REVOKE nao o detem e RLS FORCE tambem nao.
 */
describe('clin.encounter_version — imutabilidade por permissao', () => {
  let api: Client;
  let admin: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await api.end();
    await admin.end();
  });

  it('app_rw NAO tem INSERT: escrita clinica so por SECURITY DEFINER', async () => {
    const { rows } = await api.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'clin' AND table_name = 'encounter_version'
          AND grantee = 'app_rw'
        ORDER BY privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT']);
  });

  it('UPDATE e DELETE sao barrados pelo trigger, para QUALQUER papel', async () => {
    const erros = await semContexto(admin, async (c) => {
      const out: Record<string, string | null> = {};
      for (const [verbo, sql] of [
        ['update', `UPDATE clin.encounter_version SET justificativa = 'x'`],
        ['delete', `DELETE FROM clin.encounter_version`],
      ] as const) {
        await c.query('SAVEPOINT tentativa');
        try {
          await c.query(sql);
          out[verbo] = null;
        } catch (e) {
          out[verbo] = (e as Error).message;
        }
        await c.query('ROLLBACK TO SAVEPOINT tentativa');
      }
      return out;
    });

    expect(erros.update).toMatch(/append-only|deny_mutation/i);
    expect(erros.delete).toMatch(/append-only|deny_mutation/i);
  });

  it('version_no 1 obriga kind = original', async () => {
    const erro = await semContexto(admin, async (c) => {
      try {
        await c.query(
          `INSERT INTO clin.encounter_version
             (tenant_id, id, encounter_id, version_no, kind, author_user_id,
              author_professional_id, content_hash, serializer_version)
           VALUES ($1, gen_random_uuid(), gen_random_uuid(), 1, 'adendo',
                   gen_random_uuid(), gen_random_uuid(),
                   decode(repeat('00', 32), 'hex'), 'jcs-1')`,
          [F.TENANT_A],
        );
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(erro).toMatch(/encounter_version_check|violates check constraint/);
  });

  it('supersedes_version_id e UNICO: "superada" e derivavel, nunca coluna atualizada', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_constraint
        WHERE conrelid = 'clin.encounter_version'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (supersedes_version_id)'`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('content_hash tem exatamente 32 bytes', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'clin.encounter_version'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%octet_length(content_hash)%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.def).toContain('octet_length(content_hash) = 32');
  });
});
