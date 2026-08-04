import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';
import { SecurityAuditChannel } from '../src/security';

// Tenant NOVO a cada execucao, pela mesma razao ja documentada em
// channel-b.int.test.ts: audit.event e append-only e nenhum afterAll consegue
// limpar o que este teste grava — o trigger no_mutate recusa o DELETE. Com
// tenant fixo, os eventos da rodada anterior sobrevivem, `contarLeituras`
// devolve 4 em vez de 1 e as marcas de audit.read_dedup ainda estao dentro da
// janela de 5 minutos: a suite passa exatamente UMA vez, num banco recem-criado
// (verificado — na segunda rodada 4 dos 8 testes falham). A saida nao e limpar,
// e sim isolar: cada rodada conta sob um tenant que so ela conhece, e a chave de
// audit.read_dedup comeca por tenant_id, entao a deduplicacao tambem nasce limpa.
const TENANT = randomUUID();
const MEDICO = '0192f8a0-0000-7000-8000-000000000501';
const OUTRO_MEDICO = '0192f8a0-0000-7000-8000-000000000502';
const PACIENTE = '0192f8a0-0000-7000-8000-000000000511';
const OUTRO_PACIENTE = '0192f8a0-0000-7000-8000-000000000512';

function urlDaAplicacao(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente: rode `cp .env.example .env` e `pnpm db:up`');
  return url;
}

async function contarLeituras(root: Client, paciente: string, usuario: string): Promise<number> {
  const res = await root.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit.event
      WHERE tenant_id = $1 AND event_type = 'PATIENT_RECORD_READ'
        AND entity_id = $2 AND actor_user_id = $3`,
    [TENANT, paciente, usuario],
  );
  return Number(res.rows[0]?.n);
}

describe('auditoria de leitura: um evento por (usuario, paciente, caso de uso) em 5 minutos', () => {
  let root: Client;
  let app: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
    app = await connectAs('app_rw');
  });

  afterAll(async () => {
    await app.end();
    await root.end();
  });

  it('50 leituras do mesmo paciente na mesma janela geram 1 evento, nao 50', async () => {
    for (let i = 0; i < 50; i += 1) {
      await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
        'emr.open_record',
        PACIENTE,
        TENANT,
        MEDICO,
      ]);
    }

    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(1);
  });

  it('a primeira chamada devolve o id do evento e as seguintes devolvem NULL', async () => {
    const primeira = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.print_record', PACIENTE, TENANT, MEDICO],
    );
    const segunda = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.print_record', PACIENTE, TENANT, MEDICO],
    );

    expect(primeira.rows[0]?.id).not.toBeNull();
    expect(segunda.rows[0]?.id).toBeNull();
  });

  it('outro caso de uso do mesmo paciente e outro evento', async () => {
    const antes = await contarLeituras(root, PACIENTE, MEDICO);
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.export_record',
      PACIENTE,
      TENANT,
      MEDICO,
    ]);
    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(antes + 1);
  });

  it('outro usuario lendo o mesmo paciente gera evento proprio', async () => {
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.open_record',
      PACIENTE,
      TENANT,
      OUTRO_MEDICO,
    ]);
    expect(await contarLeituras(root, PACIENTE, OUTRO_MEDICO)).toBe(1);
  });

  it('outro paciente do mesmo usuario gera evento proprio', async () => {
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.open_record',
      OUTRO_PACIENTE,
      TENANT,
      MEDICO,
    ]);
    expect(await contarLeituras(root, OUTRO_PACIENTE, MEDICO)).toBe(1);
  });

  it('passados os 5 minutos da janela, a leitura volta a gerar evento', async () => {
    const antes = await contarLeituras(root, PACIENTE, MEDICO);

    // Envelhece a marca da deduplicacao em 6 minutos: e o equivalente
    // deterministico de esperar a janela expirar.
    const marca = await root.query(
      `UPDATE audit.read_dedup
          SET last_logged_at = last_logged_at - interval '6 minutes'
        WHERE tenant_id = $1 AND actor_user_id = $2 AND entity_id = $3
          AND use_case = 'emr.open_record'`,
      [TENANT, MEDICO, PACIENTE],
    );
    // Garante que o teste esta de fato envelhecendo a marca certa, e nao
    // passando por acidente porque o UPDATE nao pegou nenhuma linha.
    expect(marca.rowCount).toBe(1);

    const res = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.open_record', PACIENTE, TENANT, MEDICO],
    );

    expect(res.rows[0]?.id).not.toBeNull();
    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(antes + 1);
  });

  it('a tabela de deduplicacao nao e visivel para a aplicacao', async () => {
    const res = await root.query<{ sel: boolean; ins: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.read_dedup', 'SELECT') AS sel,
              has_table_privilege('app_rw', 'audit.read_dedup', 'INSERT') AS ins`,
    );
    expect(res.rows[0]).toEqual({ sel: false, ins: false });
  });

  it('o canal B expoe recordRead e distingue gravado de deduplicado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadencia-read-'));
    const channel = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath: join(dir, 'buffer.ndjson'),
    });
    try {
      const primeira = await channel.recordRead({
        useCase: 'emr.timeline',
        patientId: OUTRO_PACIENTE,
        tenantId: TENANT,
        actorUserId: OUTRO_MEDICO,
      });
      const segunda = await channel.recordRead({
        useCase: 'emr.timeline',
        patientId: OUTRO_PACIENTE,
        tenantId: TENANT,
        actorUserId: OUTRO_MEDICO,
      });
      expect([primeira, segunda]).toEqual(['gravado', 'deduplicado']);
    } finally {
      await channel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
