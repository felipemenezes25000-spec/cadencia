import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { CRUD_PATIENT_A, CRUD_TENANT_A } from './fixtures';
import { auditAliveViolations } from './inv09-audit-alive';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 9 — a trilha tem de estar viva, nao so existir', () => {
  it('audit.log executado de verdade insere linha em audit.event', async () => {
    const pool = catalogPool();
    const antes = await pool.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');

    // UMA conexao do comeco ao fim: o contexto e transacional (TRUE) e o INSERT
    // precisa commitar para o check enxergar o evento. Pool.query nao garante a
    // mesma conexao entre chamadas, e audit.log rodaria sem tenant nenhum.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', $1, TRUE),
                set_config('app.user_id', '', TRUE),
                set_config('app.actor_kind', 'system', TRUE),
                set_config('app.request_id', '', TRUE)`,
        [CRUD_TENANT_A],
      );
      await client.query('SELECT audit.log($1, $2, $3, $4::uuid, $5, $6::jsonb)', [
        'CONFORMANCE_PROBE',
        'clin',
        'patient',
        CRUD_PATIENT_A,
        'sucesso',
        '{}',
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const depois = await pool.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');
    expect(Number(depois.rows[0]!.total)).toBe(Number(antes.rows[0]!.total) + 1);
  });

  it('o evento gravado carrega tipo, desfecho e referencia — e nenhum conteudo clinico', async () => {
    const { rows } = await catalogPool().query<{
      event_type: string;
      outcome: string;
      entity_schema: string;
      entity_table: string;
      entity_id: string;
      meta: string;
    }>(
      `SELECT event_type, outcome, entity_schema, entity_table, entity_id::text, meta::text AS meta
         FROM audit.event WHERE event_type = 'CONFORMANCE_PROBE'
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({
      event_type: 'CONFORMANCE_PROBE',
      outcome: 'sucesso',
      entity_schema: 'clin',
      entity_table: 'patient',
      entity_id: CRUD_PATIENT_A,
      meta: '{}',
    });
  });

  it('a trilha atual nao esta vazia', async () => {
    expect(await auditAliveViolations(catalogPool())).toEqual([]);
  });

  it('reprova trilha vazia — banco com a tabela e sem evento nao prova nada em auditoria', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      // TRUNCATE e transacional e nao dispara o trigger no_mutate, que e FOR EACH ROW:
      // a trilha some so dentro desta transacao, que sempre e revertida.
      await c.query('TRUNCATE audit.event');
      return auditAliveViolations(c);
    });
    expect(violacoes).toEqual(['audit.event vazio — a trilha existe e ninguem escreve nela']);
  });

  it('reprova trilha parada ha mais tempo que o orcamento', async () => {
    const violacoes = await auditAliveViolations(catalogPool(), { maxLagMinutes: -1 });
    expect(violacoes.some((v) => v.startsWith('audit.event parado ha'))).toBe(true);
  });
});
