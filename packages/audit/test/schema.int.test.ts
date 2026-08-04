import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

const TENANT_A = '0192f8a0-0000-7000-8000-00000000000a';
const ENCOUNTER = '0192f8a0-0000-7000-8000-0000000000e1';

async function insertEvent(
  owner: Client,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const row = {
    tenant_id: TENANT_A,
    actor_kind: 'user',
    event_type: 'ENCOUNTER_FINALIZE',
    entity_schema: 'clin',
    entity_table: 'encounter_version',
    entity_id: ENCOUNTER,
    outcome: 'sucesso',
    meta: JSON.stringify({ version_no: 1, kind: 'original' }),
    ...overrides,
  };
  await owner.query(
    `INSERT INTO audit.event
       (tenant_id, actor_kind, event_type, entity_schema, entity_table,
        entity_id, outcome, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      row.tenant_id,
      row.actor_kind,
      row.event_type,
      row.entity_schema,
      row.entity_table,
      row.entity_id,
      row.outcome,
      row.meta,
    ],
  );
}

describe('audit.event: a trilha registra que algo aconteceu, nunca o que foi escrito', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('a migration da auditoria depende de app_owner ser membro de audit_owner', async () => {
    const res = await root.query<{ ok: boolean }>(
      `SELECT pg_has_role('app_owner', 'audit_owner', 'MEMBER') AS ok`,
    );
    expect(res.rows[0]?.ok).toBe(true);
  });

  it('aceita evento cujo meta so tem chaves da whitelist', async () => {
    await insertEvent(owner, {
      meta: JSON.stringify({ version_no: 3, kind: 'retificacao', use_case: 'emr.amend' }),
    });

    const res = await root.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE tenant_id = $1 AND meta ? 'use_case'`,
      [TENANT_A],
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('recusa evento cujo meta traz o nome do paciente (chave fora da whitelist)', async () => {
    await expect(
      insertEvent(owner, {
        meta: JSON.stringify({ patient_name: 'Maria das Dores da Silva' }),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('recusa evento cujo meta traz conteudo clinico', async () => {
    await expect(
      insertEvent(owner, {
        meta: JSON.stringify({ queixa_principal: 'cefaleia ha 3 dias', cid: 'J45' }),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('recusa meta que nao seja objeto json', async () => {
    await expect(
      insertEvent(owner, { meta: JSON.stringify(['J45', 'I10']) }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('entity_id e uuid: nao aceita texto clinico como identificador de entidade', async () => {
    await expect(
      insertEvent(owner, { entity_id: 'Hipertensao arterial essencial' }),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('tentativa sem contexto tambem e evento: tenant_id aceita NULL', async () => {
    await insertEvent(owner, {
      tenant_id: null,
      actor_kind: 'anon',
      event_type: 'SESSION_LOGIN',
      entity_schema: 'id',
      entity_table: 'user',
      entity_id: null,
      outcome: 'negado',
      meta: JSON.stringify({ reason: 'tenant_ausente' }),
    });

    const res = await root.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE tenant_id IS NULL AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('a tabela e particionada por occurred_at e tem particao para hoje', async () => {
    const res = await root.query<{ strategy: string; parts: string }>(
      `SELECT p.partstrat AS strategy,
              (SELECT count(*) FROM pg_inherits i WHERE i.inhparent = c.oid)::text AS parts
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_partitioned_table p ON p.partrelid = c.oid
        WHERE n.nspname = 'audit' AND c.relname = 'event'`,
    );
    expect(res.rows[0]?.strategy).toBe('r');
    expect(Number(res.rows[0]?.parts)).toBeGreaterThanOrEqual(6);
  });
});
