import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient } from './harness';

// UUIDs proprios desta tarefa: toda insercao aqui roda dentro de BEGIN/ROLLBACK,
// mas ids distintos dos fixtures evitam qualquer acoplamento com o seed.
const T = {
  tenant1: '01930000-0000-7000-8000-00000000f101',
  tenant2: '01930000-0000-7000-8000-00000000f102',
  clinicaSp: '01930000-0000-7000-8000-00000000f103',
  clinicaManaus: '01930000-0000-7000-8000-00000000f104',
};

describe('app.tenant e app.clinic', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  async function emRollback<R>(fn: (c: Client) => Promise<R>): Promise<R> {
    await admin.query('BEGIN');
    try {
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('aceita CNPJ alfanumerico em caixa alta, como manda a IN RFB 2.229/2024', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'aurora-teste', 'Clinica Aurora Ltda', '12ABC345678901')`,
        [T.tenant1],
      );
      const { rows } = await c.query<{ cnpj: string }>(
        'SELECT cnpj FROM app.tenant WHERE id = $1',
        [T.tenant1],
      );
      expect(rows[0]!.cnpj).toBe('12ABC345678901');
    });
  });

  it('recusa CNPJ com pontuacao, como a recepcao digita', async () => {
    // A mascara que a recepcao realmente digita tem 18 caracteres e nem chega ao
    // CHECK: varchar(14) barra antes, com 22001 (string_data_right_truncation).
    const mascaraCompleta = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'pontuado', 'Clinica X', '12.345.678/0001-95')`,
          [T.tenant1],
        ),
      ),
    );
    expect(mascaraCompleta.code).toBe('22001');

    // Ja uma pontuacao que CABE nos 14 caracteres so pode ser barrada pelo
    // proprio CHECK do regex — e e isso que esta tabela promete.
    const pontuacaoQueCabe = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'pontuado', 'Clinica X', '12.345.678/01')`,
          [T.tenant1],
        ),
      ),
    );
    expect(pontuacaoQueCabe.code).toBe('23514');
  });

  it('recusa CNPJ alfanumerico em caixa baixa', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'minuscula', 'Clinica X', '12abc345678901')`,
          [T.tenant1],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('aceita retencao indefinida (NULL), porque 20 anos e o MINIMO da Lei 13.787/2018', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos)
         VALUES ($1, 'indefinida', 'Clinica Y', '12ABC345678901', NULL)`,
        [T.tenant1],
      );
      const { rows } = await c.query<{ retencao_anos: number | null }>(
        'SELECT retencao_anos FROM app.tenant WHERE id = $1',
        [T.tenant1],
      );
      expect(rows[0]!.retencao_anos).toBeNull();
    });
  });

  it('recusa retencao menor que 20 anos', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos)
           VALUES ($1, 'curta', 'Clinica Z', '12ABC345678901', 19)`,
          [T.tenant1],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('o fuso pertence a CLINICA: a mesma rede tem unidade em Sao Paulo e em Manaus', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'rede', 'Rede Aurora Ltda', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
           ($1, $2, 'Aurora Paulista', '2077485', 'America/Sao_Paulo'),
           ($1, $3, 'Aurora Manaus',   '2077493', 'America/Manaus')`,
        [T.tenant1, T.clinicaSp, T.clinicaManaus],
      );
      const { rows } = await c.query<{ id: string; timezone: string }>(
        'SELECT id, timezone FROM app.clinic WHERE tenant_id = $1 ORDER BY nome',
        [T.tenant1],
      );
      expect(rows.map((r) => r.timezone)).toEqual([
        'America/Manaus',
        'America/Sao_Paulo',
      ]);
    });
  });

  it('clinica sem fuso declarado nasce em America/Sao_Paulo', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'padrao', 'Clinica Padrao', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Unica')`,
        [T.tenant1, T.clinicaSp],
      );
      const { rows } = await c.query<{ timezone: string }>(
        'SELECT timezone FROM app.clinic WHERE id = $1',
        [T.clinicaSp],
      );
      expect(rows[0]!.timezone).toBe('America/Sao_Paulo');
    });
  });

  it('CNES fica NULO ate a clinica informar: nao existe default 9999999', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'semcnes', 'Clinica Sem CNES', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Sem CNES')`,
        [T.tenant1, T.clinicaSp],
      );
      const { rows } = await c.query<{ cnes: string | null }>(
        'SELECT cnes FROM app.clinic WHERE id = $1',
        [T.clinicaSp],
      );
      expect(rows[0]!.cnes).toBeNull();
    });
  });

  it('recusa CNES que nao seja 7 digitos', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'cnesruim', 'Clinica W', '12ABC345678901')`,
          [T.tenant1],
        );
        await c.query(
          `INSERT INTO app.clinic (tenant_id, id, nome, cnes)
           VALUES ($1, $2, 'Ruim', 'ABC1234')`,
          [T.tenant1, T.clinicaSp],
        );
      }),
    );
    expect(erro.code).toBe('23514');
  });

  it('app.clinic expoe UNIQUE (tenant_id, id), sem o qual nenhuma FK composta compila', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'app' AND t.relname = 'clinic' AND c.contype = 'u'
          -- attname e do tipo name: sem o ::text o PostgreSQL 18 nao acha
          -- operador para name[] = text[] e a consulta nem compila.
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                 FROM unnest(c.conkey) k(attnum)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
              = ARRAY['id','tenant_id']`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('clinica so existe dentro de um tenant que existe', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Orfa')`,
          [T.tenant2, T.clinicaSp],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('app.tenant e declarada tenant-root: e a unica tabela cuja coluna de tenant e o proprio id', async () => {
    const { rows } = await admin.query<{ comentario: string | null }>(
      `SELECT obj_description('app.tenant'::regclass, 'pg_class') AS comentario`,
    );
    expect(rows[0]!.comentario).toBe('tenant-root');
  });
});
