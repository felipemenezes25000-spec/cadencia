import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

// Tenant NOVO a cada execução, e não uma constante.
//
// Este teste prova que audit.event é append-only — o que significa que ele não
// pode limpar o que escreve: o próprio trigger que ele verifica recusa o DELETE
// do afterAll. Com tenant_id fixo, a linha da execução anterior sobrevive, a
// contagem cresce a cada rodada (1, 2, 3...) e o teste passa exatamente UMA vez,
// num banco recém-criado, falhando para sempre depois.
//
// A saída não é limpar, e sim isolar: cada rodada escreve sob um tenant que só
// ela conhece. As linhas antigas continuam lá, como devem, e não interferem.
const TENANT = randomUUID();

describe('audit.event e append-only por trigger, nao por convencao', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
    await owner.query(
      `INSERT INTO audit.event
         (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
       VALUES ($1, 'system', 'SEAL_RUN', 'audit', 'seal', 'sucesso', '{}'::jsonb)`,
      [TENANT],
    );
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('UPDATE levanta excecao mesmo para o superusuario', async () => {
    await expect(
      root.query(`UPDATE audit.event SET outcome = 'sucesso' WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('append-only'),
    });
  });

  it('DELETE levanta excecao mesmo para o superusuario', async () => {
    await expect(
      root.query(`DELETE FROM audit.event WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('append-only'),
    });
  });

  it('a linha continua la depois das duas tentativas', async () => {
    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event WHERE tenant_id = $1`,
      [TENANT],
    );
    expect(Number(res.rows[0]?.n)).toBe(1);
  });

  it('a mensagem da excecao nomeia a operacao recusada', async () => {
    await expect(
      root.query(`DELETE FROM audit.event WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({ message: expect.stringContaining('DELETE') });
  });

  it('o trigger existe no pai e cobre UPDATE e DELETE', async () => {
    const res = await root.query<{ tgname: string; def: string }>(
      `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname = 'event' AND NOT t.tgisinternal`,
    );
    expect(res.rows[0]?.tgname).toBe('no_mutate');
    // pg_get_triggerdef normaliza a ordem dos eventos: a migration escreve
    // `BEFORE UPDATE OR DELETE` e o catálogo devolve `BEFORE DELETE OR UPDATE`.
    expect(res.rows[0]?.def).toContain('BEFORE DELETE OR UPDATE');
  });
});
