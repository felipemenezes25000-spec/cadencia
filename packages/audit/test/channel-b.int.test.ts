import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';
import { logDomainEvent } from '../src/domain';
import { SecurityAuditChannel } from '../src/security';

// Tenant NOVO a cada execucao, pela mesma razao ja documentada em
// no-mutate.int.test.ts: audit.event e append-only, entao nenhum afterAll
// consegue limpar o que este teste grava — o trigger no_mutate recusa o DELETE.
// Com tenant_id constante, a negacao da rodada anterior sobrevive, a contagem
// cresce (1, 2, 3...) e as assercoes de igualdade abaixo passam exatamente UMA
// vez, num banco recem-criado, falhando para sempre depois.
//
// A saida nao e limpar, e sim isolar: cada rodada conta sob um tenant que so ela
// conhece. As linhas antigas continuam la, como a norma exige, sem interferir.
const TENANT = randomUUID();
const USER = '0192f8a0-0000-7000-8000-000000000401';
const PATIENT = '0192f8a0-0000-7000-8000-000000000402';

/** DATABASE_URL e o papel `api`, NOINHERIT: e o mesmo caminho de producao. */
function urlDaAplicacao(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente: rode `cp .env.example .env` e `pnpm db:up`');
  return url;
}

describe('Canal B: o evento de acesso negado sobrevive ao rollback do negocio', () => {
  let root: Client;
  let dir: string;
  let channel: SecurityAuditChannel;

  beforeAll(async () => {
    root = await connectSuperuser();
    dir = mkdtempSync(join(tmpdir(), 'cadencia-audit-'));
    channel = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath: join(dir, 'security-audit.ndjson'),
    });
  });

  afterAll(async () => {
    await channel.close();
    await root.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a negacao gravada pelo canal B sobrevive ao ROLLBACK da transacao de negocio', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'user' });

      // Canal A, na MESMA transacao que vai abortar.
      await logDomainEvent(app, {
        eventType: 'ENCOUNTER_FINALIZE',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: PATIENT,
        meta: { version_no: 1, kind: 'original' },
      });

      // Canal B, em conexao propria, fora da transacao.
      const resultado = await channel.record({
        eventType: 'RECORD_ACCESS_DENIED',
        outcome: 'negado',
        entitySchema: 'clin',
        entityTable: 'encounter',
        entityId: PATIENT,
        tenantId: TENANT,
        actorUserId: USER,
        actorKind: 'user',
        meta: { reason: 'sem_compartilhamento', route: '/v1/atendimentos/:id' },
      });
      expect(resultado).toBe('gravado');

      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    const negados = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'RECORD_ACCESS_DENIED'`,
      [TENANT],
    );
    const dominio = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'ENCOUNTER_FINALIZE'`,
      [TENANT],
    );

    // A negacao — que e o que o auditor procura — ficou.
    expect(Number(negados.rows[0]?.n)).toBe(1);
    // O evento de dominio da transacao abortada, nao.
    expect(Number(dominio.rows[0]?.n)).toBe(0);
  });

  it('tentativa sem contexto de tenant tambem vira evento, com tenant_id nulo', async () => {
    const resultado = await channel.record({
      eventType: 'SESSION_LOGIN',
      outcome: 'negado',
      entitySchema: 'id',
      entityTable: 'user',
      actorKind: 'anon',
      ip: '187.60.10.7',
      meta: { reason: 'tenant_ausente', route: '/v1/sessoes' },
    });
    expect(resultado).toBe('gravado');

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id IS NULL AND event_type = 'SESSION_LOGIN' AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('quando o banco recusa, o evento vai para o buffer em disco e nao se perde', async () => {
    const bufferPath = join(dir, 'offline.ndjson');
    const offline = new SecurityAuditChannel({
      // porta 1: nao existe servidor. Simula banco indisponivel.
      connectionString: 'postgres://ninguem@127.0.0.1:1/cadencia',
      bufferPath,
    });

    const resultado = await offline.record({
      eventType: 'BREAK_GLASS_OPEN',
      outcome: 'sucesso',
      entitySchema: 'clin',
      entityTable: 'patient',
      entityId: PATIENT,
      tenantId: TENANT,
      actorUserId: USER,
      actorKind: 'user',
      meta: { reason: 'paciente_inconsciente', ticket: 'CH-2026-0001' },
    });

    expect(resultado).toBe('bufferizado');
    expect(existsSync(bufferPath)).toBe(true);

    const linhas = readFileSync(bufferPath, 'utf8').trim().split('\n');
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0] ?? '{}')).toMatchObject({
      eventType: 'BREAK_GLASS_OPEN',
      tenantId: TENANT,
    });

    await offline.close();
  });

  it('meta fora da whitelist falha alto e NAO vai parar em arquivo no disco', async () => {
    const bufferPath = join(dir, 'pii.ndjson');
    const canal = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath,
    });
    try {
      await expect(
        canal.record({
          eventType: 'RECORD_ACCESS_DENIED',
          outcome: 'negado',
          entitySchema: 'clin',
          entityTable: 'encounter',
          entityId: PATIENT,
          tenantId: TENANT,
          actorUserId: USER,
          actorKind: 'user',
          meta: { queixa_principal: 'cefaleia ha 3 dias' } as unknown as Record<string, string>,
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });

      // O ponto do teste: o conteudo clinico recusado pelo banco nao pode ter
      // sido gravado em texto claro no volume da task.
      expect(existsSync(bufferPath)).toBe(false);
    } finally {
      await canal.close();
    }
  });

  it('drain envia o buffer para o banco e esvazia o arquivo', async () => {
    const bufferPath = join(dir, 'drenar.ndjson');
    const offline = new SecurityAuditChannel({
      connectionString: 'postgres://ninguem@127.0.0.1:1/cadencia',
      bufferPath,
    });
    await offline.record({
      eventType: 'BREAK_GLASS_CLOSE',
      outcome: 'sucesso',
      entitySchema: 'clin',
      entityTable: 'patient',
      entityId: PATIENT,
      tenantId: TENANT,
      actorUserId: USER,
      actorKind: 'user',
      meta: { ticket: 'CH-2026-0001' },
    });
    await offline.close();

    const online = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath,
    });
    const drenados = await online.drain();
    await online.close();

    expect(drenados).toBe(1);
    expect(readFileSync(bufferPath, 'utf8')).toBe('');

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'BREAK_GLASS_CLOSE'`,
      [TENANT],
    );
    expect(Number(res.rows[0]?.n)).toBe(1);
  });

  it('o pool do canal B nao abre mais que 2 conexoes, nem com 6 eventos simultaneos', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        channel.record({
          eventType: 'SESSION_LOGIN',
          outcome: 'negado',
          entitySchema: 'id',
          entityTable: 'user',
          actorKind: 'anon',
          ip: '187.60.10.7',
          meta: { reason: 'senha_invalida', route: `/v1/sessoes/${i}` },
        }),
      ),
    );

    // Todos gravaram: o limite serializa, nao descarta.
    expect(resultados).toEqual(Array.from({ length: 6 }, () => 'gravado'));
    // E o teto de 2 conexoes da §2.1 vale de verdade, nao so no campo do objeto.
    expect(channel.openConnections).toBeLessThanOrEqual(2);
    expect(channel.maxConnections).toBe(2);

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id IS NULL AND event_type = 'SESSION_LOGIN' AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(6);
  });

  it('app_rw tem EXECUTE em audit.log_security e continua sem INSERT na tabela', async () => {
    const res = await root.query<{ exec: boolean; ins: boolean }>(
      `SELECT has_function_privilege('app_rw',
                'audit.log_security(text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb)',
                'EXECUTE') AS exec,
              has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins`,
    );
    expect(res.rows[0]).toEqual({ exec: true, ins: false });
  });
});
