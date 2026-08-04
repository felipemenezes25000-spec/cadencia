import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';
import { logDomainEvent } from '../src/domain';

// Os quatro UUIDs sao DISTINTOS de proposito: se `audit.log` trocar duas colunas
// de lugar, o teste do mapeamento abaixo tem que ficar vermelho.
const TENANT = '0192f8a0-0000-7000-8000-00000000030a';
const USER = '0192f8a0-0000-7000-8000-000000000301';
const VERSION = '0192f8a0-0000-7000-8000-000000000302';
const REQUEST = '0192f8a0-0000-7000-8000-000000000303';

async function countEvents(root: Client, eventType: string): Promise<number> {
  const res = await root.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit.event
      WHERE tenant_id = $1 AND event_type = $2`,
    [TENANT, eventType],
  );
  return Number(res.rows[0]?.n);
}

describe('Canal A: o evento de dominio so e verdade se a escrita commitou', () => {
  let root: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
  });

  afterAll(async () => {
    await root.end();
  });

  it('grava o evento na mesma transacao do negocio e ele sobrevive ao commit', async () => {
    // A trilha e append-only: nenhuma execucao consegue limpar o que a anterior
    // gravou. Por isso a assercao e sobre o id recem-gerado, e nao sobre "a
    // unica linha da tabela" — senao o teste so ficaria verde em banco novo.
    let eventId = 0n;
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, {
        tenantId: TENANT,
        userId: USER,
        actorKind: 'system',
        requestId: REQUEST,
      });
      eventId = await logDomainEvent(app, {
        eventType: 'ENCOUNTER_FINALIZE',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: VERSION,
        meta: { version_no: 1, kind: 'original' },
      });
      expect(eventId).toBeGreaterThan(0n);
      await app.query('COMMIT');
    } finally {
      await app.end();
    }

    const res = await root.query<{
      tenant_id: string;
      entity_id: string;
      actor_user_id: string;
      outcome: string;
      request_id: string;
      entity_schema: string;
      entity_table: string;
      meta: Record<string, unknown>;
    }>(
      `SELECT tenant_id, entity_id, actor_user_id, outcome, request_id,
              entity_schema, entity_table, meta
         FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'ENCOUNTER_FINALIZE'
          AND id = $2::bigint`,
      [TENANT, String(eventId)],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toEqual({
      tenant_id: TENANT,
      entity_id: VERSION,
      actor_user_id: USER,
      request_id: REQUEST,
      outcome: 'sucesso',
      entity_schema: 'clin',
      entity_table: 'encounter_version',
      meta: { version_no: 1, kind: 'original' },
    });
  });

  it('o evento de dominio desaparece se a transacao de negocio faz rollback', async () => {
    const antes = await countEvents(root, 'ENCOUNTER_AMEND');

    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'system' });
      await logDomainEvent(app, {
        eventType: 'ENCOUNTER_AMEND',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: VERSION,
        meta: { version_no: 2, kind: 'retificacao' },
      });
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    // Trilha que afirma uma retificacao que nao aconteceu e prova documental
    // de um fato falso: pior que nao ter trilha.
    expect(await countEvents(root, 'ENCOUNTER_AMEND')).toBe(antes);
  });

  it('o ator de sistema (worker, sem user_id) grava sem estourar em uuid vazio', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, actorKind: 'system' });
      await logDomainEvent(app, {
        eventType: 'TISS_BATCH_SUBMIT',
        entitySchema: 'tiss',
        entityTable: 'lote',
        meta: { batch_id: 'lote-2026-08', record_count: 42 },
      });
      await app.query('COMMIT');
    } finally {
      await app.end();
    }

    const res = await root.query<{ actor_user_id: string | null; actor_kind: string }>(
      `SELECT actor_user_id, actor_kind FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'TISS_BATCH_SUBMIT'`,
      [TENANT],
    );
    expect(res.rows[0]).toEqual({ actor_user_id: null, actor_kind: 'system' });
  });

  it('a whitelist de meta vale tambem pelo Canal A', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'system' });
      await expect(
        logDomainEvent(app, {
          eventType: 'ENCOUNTER_FINALIZE',
          entitySchema: 'clin',
          entityTable: 'encounter_version',
          entityId: VERSION,
          meta: { diagnostico: 'I10' } as unknown as Record<string, string>,
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  });

  it('app_rw tem EXECUTE em audit.log e continua sem INSERT na tabela', async () => {
    const res = await root.query<{ exec: boolean; ins: boolean; writer: boolean }>(
      `SELECT has_function_privilege('app_rw',
                'audit.log(text,text,text,uuid,text,jsonb,uuid)', 'EXECUTE') AS exec,
              has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins,
              has_schema_privilege('clin_writer', 'audit', 'USAGE') AS writer`,
    );
    // Sem `writer`, clin.finalize_encounter (que roda como clin_writer) morre com
    // 42501 "permission denied for schema audit" no primeiro deploy — o EXECUTE
    // concedido abaixo seria inutil.
    expect(res.rows[0]).toEqual({ exec: true, ins: false, writer: true });
  });
});
