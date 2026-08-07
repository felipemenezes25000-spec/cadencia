import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';
import { TENANT_SCHEMAS } from '../../src/invariants/catalog';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

describe('T3 e T4 — escrita cruzada e FK composta', () => {
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

  it('T3 — UPDATE mirando paciente de outro tenant afeta ZERO linhas', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query(
        `UPDATE clin.patient SET full_name = 'NOME SEQUESTRADO' WHERE id = $1`,
        [F.PATIENT_B_MARCOS],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('T3 — UPDATE em massa sem WHERE nao encosta em linha de outro tenant', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query(
        `UPDATE clin.patient SET cadastro_status = 'completo'`,
      );
      expect(r.rowCount).toBe(2); // exatamente os dois pacientes do tenant A
    });
  });

  it('T3 — DELETE mirando identificador de outro tenant afeta ZERO linhas', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query('DELETE FROM clin.patient_identifier WHERE id = $1', [
        F.PID_B_MARCOS_CPF,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('T3 — e a linha do outro tenant continua intacta depois das tentativas', async () => {
    const { rows } = await admin.query<{ full_name: string; ids: number }>(
      `SELECT p.full_name,
              (SELECT count(*)::int FROM clin.patient_identifier i
                WHERE i.id = $2) AS ids
         FROM clin.patient p WHERE p.id = $1`,
      [F.PATIENT_B_MARCOS, F.PID_B_MARCOS_CPF],
    );
    expect(rows[0]).toEqual({ full_name: 'Marcos Andrade Lima', ids: 1 });
  });

  it('T4 — identificador apontando para paciente de outro tenant levanta 23503, nao some da leitura', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, $2, $3, 'CPF', '11144477735')`,
          [F.TENANT_A, '01930000-0000-7000-8000-00000000f601', F.PATIENT_B_MARCOS],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
    expect(erro.message).toContain('patient_identifier');
  });

  it('T4 — compartilhamento concedido a profissional de outro tenant levanta 23503', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.record_share
             (tenant_id, id, patient_id, grantee_professional_id,
              granted_by_professional_id, reason)
           VALUES ($1, $2, $3, $4, $5, 'tentativa de vazamento entre clinicas')`,
          [
            F.TENANT_A,
            '01930000-0000-7000-8000-00000000f602',
            F.PATIENT_A_JOANA,
            F.PROF_B_DIEGO,
            F.PROF_A_ANA,
          ],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('T4 — vinculo apontando para clinica de outro tenant levanta 23503', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'profissional')`,
          [
            F.TENANT_A,
            '01930000-0000-7000-8000-00000000f603',
            F.USER_A_ANA,
            F.CLINIC_B_RIO_BRANCO,
          ],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('nenhuma FK de tabela multi-tenant e de coluna unica quando o alvo tambem e multi-tenant', async () => {
    const { rows } = await admin.query<{
      tabela: string;
      constraint: string;
      cols: string[];
    }>(
      `SELECT n.nspname || '.' || t.relname AS tabela,
              c.conname AS constraint,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = ANY ($1::text[])
          -- so tabelas multi-tenant
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = t.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
          -- so FKs cujo ALVO tambem e multi-tenant; FK para id.user ou app.tenant
          -- e legitimamente de coluna unica porque o alvo e global.
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
      [[...TENANT_SCHEMAS]],
    );

    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const fk of rows) {
      expect(
        fk.cols,
        `${fk.tabela}.${fk.constraint} nao inclui tenant_id: e por essa fresta que o bug de aplicacao vira vazamento`,
      ).toContain('tenant_id');
      expect(fk.cols.length, `${fk.tabela}.${fk.constraint} e de coluna unica`)
        .toBeGreaterThanOrEqual(2);
    }
  });
});
