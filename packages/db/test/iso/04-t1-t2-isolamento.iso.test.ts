import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

interface Tabela {
  nsp: string;
  rel: string;
}

describe('T1 e T2 — isolamento de leitura e de escrita entre tenants', () => {
  let admin: Client;
  let api: Client;
  let tabelas: Tabela[];

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));

    // T1 nao usa lista manual: as tabelas sao DESCOBERTAS do catalogo do Postgres.
    // Uma tabela nova criada em Fase 1 sem isolamento reprova aqui sozinha.
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app','clin','fin','tiss','audit')
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
    );
    tabelas = rows;
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('descobre pelo menos as cinco tabelas multi-tenant da Fase 0', () => {
    const nomes = tabelas.map((t) => `${t.nsp}.${t.rel}`);
    expect(nomes).toEqual(
      expect.arrayContaining([
        'app.clinic',
        'app.membership',
        'app.professional',
        'clin.patient',
        'clin.patient_identifier',
      ]),
    );
  });

  it('o seed realmente criou linha do tenant B em toda tabela multi-tenant, senao T1 passaria a toa', async () => {
    for (const { nsp, rel } of tabelas) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${nsp}"."${rel}" WHERE tenant_id = $1`,
        [F.TENANT_B],
      );
      expect(rows[0]!.n, `${nsp}.${rel} nao tem linha do tenant B no seed`)
        .toBeGreaterThan(0);
    }
  });

  it('T1 — o tenant A nao le nenhuma linha do tenant B, tabela a tabela', async () => {
    await comoAtor(api, ANA, async (c) => {
      for (const { nsp, rel } of tabelas) {
        const { rows } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${nsp}"."${rel}" WHERE tenant_id = $1`,
          [F.TENANT_B],
        );
        expect(rows[0]!.n, `${nsp}.${rel} VAZOU linha do tenant B`).toBe(0);
      }
    });
  });

  it('T1 — e continua lendo normalmente as linhas do proprio tenant', async () => {
    await comoAtor(api, ANA, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient',
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('T1 — app.tenant tambem isola, apesar de a coluna de tenant chamar-se id', async () => {
    await comoAtor(api, ANA, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM app.tenant');
      expect(rows.map((r) => r.id)).toEqual([F.TENANT_A]);
    });
  });

  it('T2 — INSERT carimbado com o tenant_id de outra clinica e recusado', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name)
           VALUES ($1, $2, 'Paciente plantado no tenant alheio')`,
          [F.TENANT_B, '01930000-0000-7000-8000-00000000f401'],
        ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('row-level security policy');
  });

  it('T2 — INSERT sem informar tenant_id herda o tenant do contexto, nunca o do payload', async () => {
    await comoAtor(api, ANA, async (c) => {
      await c.query(
        `INSERT INTO clin.patient (id, full_name) VALUES ($1, 'Paciente novo da Aurora')`,
        ['01930000-0000-7000-8000-00000000f402'],
      );
      const { rows } = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM clin.patient WHERE id = $1',
        ['01930000-0000-7000-8000-00000000f402'],
      );
      expect(rows[0]!.tenant_id).toBe(F.TENANT_A);
    });
  });

  it('a aplicacao nao e dona de nenhuma relacao, logo nao consegue desligar a RLS', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname IN ('app','clin','id') AND r.rolname = 'api'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('toda tabela multi-tenant tem RLS habilitada, FORCADA e pelo menos uma policy', async () => {
    for (const { nsp, rel } of tabelas) {
      const { rows } = await admin.query<{
        rls: boolean;
        force: boolean;
        policies: number;
      }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2`,
        [nsp, rel],
      );
      expect(rows[0], `${nsp}.${rel} sem RLS forcada ou sem policy`).toMatchObject({
        rls: true,
        force: true,
      });
      expect(rows[0]!.policies).toBeGreaterThanOrEqual(1);
    }
  });
});
