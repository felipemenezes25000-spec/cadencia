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

/**
 * A mesma Ana, carimbada com o tenant B. E o contexto que um payload adulterado
 * produziria: nao ha vinculo dela em B, entao app.is_member() devolve false e a
 * policy nao deixa passar linha nenhuma.
 */
const ANA_CARIMBADA_NO_B: IsoActor = { ...ANA, tenantId: F.TENANT_B };

const T = {
  secao: '0198f2a0-0001-7000-8000-000000000001',
  campoG1: '0198f2a0-0002-7000-8000-000000000001',
  campoG2: '0198f2a0-0002-7000-8000-000000000002',
  campoG3: '0198f2a0-0002-7000-8000-000000000003',
};

const CRIA_SECAO = `
  INSERT INTO clin.record_section (tenant_id, id, template_id, template_version, code, label, ordinal)
  VALUES ($1, $2, NULL, NULL, 'queixa', 'Queixa principal', 1)`;

const CRIA_PESO_TEXTO = `
  INSERT INTO clin.record_field (tenant_id, id, section_id, code, label, kind, ordinal, generation)
  VALUES ($1, $2, $3, 'peso', 'Peso', 'texto_curto', 1, 1)`;

describe('definicao de prontuario — secao e campo', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('cria secao e campo na geracao 1', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
      await c.query(CRIA_PESO_TEXTO, [F.TENANT_A, T.campoG1, T.secao]);
      const { rows } = await c.query<{ code: string; generation: number }>(
        `SELECT code, generation FROM clin.record_field WHERE section_id = $1`,
        [T.secao],
      );
      return rows;
    });
    expect(linhas).toEqual([{ code: 'peso', generation: 1 }]);
  });

  it('mudar o TIPO arquiva e cria geracao 2 — o gesto mais comum da tela de ajustes', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
      await c.query(CRIA_PESO_TEXTO, [F.TENANT_A, T.campoG1, T.secao]);

      await c.query(
        `UPDATE clin.record_field SET archived_at = clock_timestamp()
          WHERE tenant_id = $1 AND section_id = $2 AND code = 'peso' AND archived_at IS NULL`,
        [F.TENANT_A, T.secao],
      );
      await c.query(
        `INSERT INTO clin.record_field
           (tenant_id, id, section_id, code, label, kind, observation_code, unit,
            is_reportable, ordinal, generation)
         VALUES ($1, $2, $3, 'peso', 'Peso', 'numerico', 'PESO', 'kg', true, 1, 2)`,
        [F.TENANT_A, T.campoG2, T.secao],
      );

      const { rows } = await c.query<{ generation: number; kind: string; viva: boolean }>(
        `SELECT generation, kind, archived_at IS NULL AS viva FROM clin.record_field
          WHERE tenant_id = $1 AND section_id = $2 AND code = 'peso' ORDER BY generation`,
        [F.TENANT_A, T.secao],
      );
      return rows;
    });
    expect(linhas).toEqual([
      { generation: 1, kind: 'texto_curto', viva: false },
      { generation: 2, kind: 'numerico', viva: true },
    ]);
  });

  it('recusa DUAS geracoes vivas do mesmo code — a unicidade e parcial, nao total', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, async (c) => {
        await c.query(CRIA_SECAO, [F.TENANT_A, T.secao]);
        await c.query(CRIA_PESO_TEXTO, [F.TENANT_A, T.campoG1, T.secao]);
        await c.query(
          `INSERT INTO clin.record_field
             (tenant_id, id, section_id, code, label, kind, ordinal, generation)
           VALUES ($1, $2, $3, 'peso', 'Peso', 'texto_longo', 1, 2)`,
          [F.TENANT_A, T.campoG3, T.secao],
        );
      }),
    );
    expect(erro.code).toBe('23505');
    expect(erro.message).toMatch(/ux_record_field_viva/);
  });

  it('tenant B nao enxerga a definicao do tenant A', async () => {
    // Primeiro a leitura legitima, para o zero do tenant B nao ser zero a toa:
    // o seed tem secao e campo nos DOIS tenants.
    const doProprioTenant = await comoAtor(api, ANA, (c) =>
      c.query(`SELECT 1 FROM clin.record_field`),
    );
    expect(doProprioTenant.rowCount).toBeGreaterThan(0);

    const carimbadaNoB = await comoAtor(api, ANA_CARIMBADA_NO_B, (c) =>
      c.query(`SELECT 1 FROM clin.record_field`),
    );
    expect(carimbadaNoB.rowCount).toBe(0);
  });

  it('as duas tabelas tem RLS habilitada, FORCADA e ao menos uma policy', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'clin' AND c.relname IN ('record_section','record_field')
        ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(['record_field', 'record_section']);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} sem RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} sem FORCE`).toBe(true);
      expect(Number(row.policies), `${row.relname} sem policy`).toBeGreaterThanOrEqual(1);
    }
  });
});
