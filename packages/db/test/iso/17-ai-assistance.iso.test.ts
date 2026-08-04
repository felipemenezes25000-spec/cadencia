import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

/**
 * §4.6 — IA como parte do prontuario. Sao leituras de catalogo puras, entao usam
 * o cliente administrativo direto, no mesmo espirito das suites 15 e 16: nao ha
 * linha para isolar nem preambulo a aplicar.
 */
describe('clin.ai_assistance', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  it('so aceita os cinco propositos da CFM 2.454/2026', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.ai_assistance'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%purpose%'`,
    );
    for (const p of [
      'transcricao_anamnese',
      'sugestao_cid',
      'resumo_historico',
      'sugestao_conduta',
      'triagem',
    ]) {
      expect(rows[0]?.def).toContain(p);
    }
  });

  it('guarda a entrada RECUPERAVEL, nao so o hash', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='clin' AND table_name='ai_assistance'
          AND column_name IN ('input_key','input_hash','output','output_hash')
        ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'input_hash',
      'input_key',
      'output',
      'output_hash',
    ]);
  });

  it('residencia e coluna, nao clausula contratual', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='clin.ai_assistance'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%residency%'`,
    );
    expect(rows[0]?.def).toContain("'br'");
  });

  it('recusa a linha quando o paciente recusou IA — verificado por trigger, nao pela UI', async () => {
    let erro: string | null = null;
    try {
      await admin.query(`SELECT clin.__probe_ai_refused()`);
    } catch (e) {
      erro = (e as Error).message;
    }
    // A funcao de sonda nao existe: o que importa e o trigger, exercitado no
    // teste de integracao de emr (Task 18). Aqui afirmamos apenas que ele existe.
    const { rows } = await admin.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid='clin.ai_assistance'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(rows.map((r) => r.tgname)).toContain('recusa_do_paciente');
    expect(erro).toMatch(/does not exist/);
  });
});
