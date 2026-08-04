import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient } from './harness';

const T = {
  tenantA: '01930000-0000-7000-8000-00000000f301',
  tenantB: '01930000-0000-7000-8000-00000000f302',
  joana: '01930000-0000-7000-8000-00000000f303',
  recemNascido: '01930000-0000-7000-8000-00000000f304',
  outroSemDoc: '01930000-0000-7000-8000-00000000f305',
  marcosNoB: '01930000-0000-7000-8000-00000000f306',
  pid1: '01930000-0000-7000-8000-00000000f307',
  pid2: '01930000-0000-7000-8000-00000000f308',
  pid3: '01930000-0000-7000-8000-00000000f309',
  pid4: '01930000-0000-7000-8000-00000000f30a',
};

const CPF = '52998224725';

const CENARIO = `
  INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
    ($1, 'aurora-f3', 'Clinica Aurora Ltda', '12ABC345678901'),
    ($2, 'boreal-f3', 'Clinica Boreal Ltda', '98XYZ765432109')`;

describe('clin.patient e clin.patient_identifier', () => {
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
      await admin.query(CENARIO, [T.tenantA, T.tenantB]);
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('recem-nascido entra sem data de nascimento e com cadastro preliminar', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, sex_at_birth)
         VALUES ($1, $2, 'RN de Joana Ferreira', 'F')`,
        [T.tenantA, T.recemNascido],
      );
      const { rows } = await c.query<{
        birth_date: string | null;
        cadastro_status: string;
      }>(
        'SELECT birth_date, cadastro_status FROM clin.patient WHERE id = $1',
        [T.recemNascido],
      );
      expect(rows[0]!.birth_date).toBeNull();
      expect(rows[0]!.cadastro_status).toBe('preliminar');
    });
  });

  it('dois pacientes SEM_DOCUMENTO convivem: o indice de unicidade os ignora', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $2, 'RN de Joana Ferreira'),
           ($1, $3, 'Homem nao identificado - triagem')`,
        [T.tenantA, T.recemNascido, T.outroSemDoc],
      );
      await c.query(
        `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
           ($1, $2, $4, 'SEM_DOCUMENTO', 'sem documento apresentado'),
           ($1, $3, $5, 'SEM_DOCUMENTO', 'sem documento apresentado')`,
        [T.tenantA, T.pid1, T.pid2, T.recemNascido, T.outroSemDoc],
      );
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient_identifier
          WHERE tenant_id = $1 AND kind = 'SEM_DOCUMENTO'`,
        [T.tenantA],
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('o mesmo CPF nao pode ser cadastrado duas vezes na mesma clinica', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
             ($1, $2, 'Joana Ferreira da Silva'),
             ($1, $3, 'Joana F. da Silva')`,
          [T.tenantA, T.joana, T.outroSemDoc],
        );
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
             ($1, $2, $4, 'CPF', $6),
             ($1, $3, $5, 'CPF', $6)`,
          [T.tenantA, T.pid1, T.pid2, T.joana, T.outroSemDoc, CPF],
        );
      }),
    );
    expect(erro.code).toBe('23505');
  });

  it('o mesmo CPF existe em clinicas diferentes sem conflito: unicidade e por tenant', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $3, 'Joana Ferreira da Silva'),
           ($2, $4, 'Joana Ferreira da Silva')`,
        [T.tenantA, T.tenantB, T.joana, T.marcosNoB],
      );
      await c.query(
        `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
           ($1, $3, $5, 'CPF', $7),
           ($2, $4, $6, 'CPF', $7)`,
        [T.tenantA, T.tenantB, T.pid3, T.pid4, T.joana, T.marcosNoB, CPF],
      );
      // Filtra pelos tenants DESTE teste: o seed global grava o mesmo CPF em dois
      // outros tenants, e uma contagem sem filtro passaria a devolver 4.
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient_identifier
          WHERE value = $1 AND tenant_id IN ($2, $3)`,
        [CPF, T.tenantA, T.tenantB],
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('o nome social lidera a busca, sem acento e em caixa baixa (Decreto 8.727/2016)', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, nome_social)
         VALUES ($1, $2, 'João Ferreira da Conceição', 'Joana Ferreira da Conceição')`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ search_name: string }>(
        'SELECT search_name FROM clin.patient WHERE id = $1',
        [T.joana],
      );
      expect(rows[0]!.search_name).toBe('joana ferreira da conceicao');
    });
  });

  it('sem nome social, a busca usa o nome civil sem acento, til nem cedilha', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name)
         VALUES ($1, $2, 'Antônio José Gonçalves de Assunção')`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ search_name: string }>(
        'SELECT search_name FROM clin.patient WHERE id = $1',
        [T.joana],
      );
      expect(rows[0]!.search_name).toBe('antonio jose goncalves de assuncao');
    });
  });

  it('recusa cadastro_status fora de preliminar/completo', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
           VALUES ($1, $2, 'Fulano', 'rascunho')`,
          [T.tenantA, T.joana],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('recusa tipo de identificador fora do catalogo', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES ($1, $2, 'Fulano')`,
          [T.tenantA, T.joana],
        );
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, $2, $3, 'TITULO_ELEITOR', '123')`,
          [T.tenantA, T.pid1, T.joana],
        );
      }),
    );
    expect(erro.code).toBe('23514');
  });

  it('guarda a recusa de IA no nivel do titular (CFM 2.454/2026)', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, ai_refused_at)
         VALUES ($1, $2, 'Joana Ferreira da Silva', clock_timestamp())`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient
          WHERE id = $1 AND ai_refused_at IS NOT NULL`,
        [T.joana],
      );
      expect(rows[0]!.n).toBe(1);
    });
  });

  it('unificacao marca o duplicado e nao troca o dado de nenhuma das duas linhas', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $2, 'Joana Ferreira da Silva'),
           ($1, $3, 'Joana F. da Silva')`,
        [T.tenantA, T.joana, T.outroSemDoc],
      );
      await c.query(
        'UPDATE clin.patient SET merged_into_id = $1 WHERE id = $2',
        [T.joana, T.outroSemDoc],
      );
      const { rows } = await c.query<{
        id: string;
        full_name: string;
        merged_into_id: string | null;
      }>(
        `SELECT id, full_name, merged_into_id FROM clin.patient
          WHERE tenant_id = $1 ORDER BY full_name`,
        [T.tenantA],
      );
      // O duplicado aponta para o sobrevivente e MANTEM o proprio nome; o sobrevivente
      // nao ganha ponteiro nenhum. Decisao irreversivel n. 9: unificar nunca reescreve
      // o conteudo de uma linha com o conteudo da outra.
      expect(rows).toEqual([
        { id: T.outroSemDoc, full_name: 'Joana F. da Silva', merged_into_id: T.joana },
        { id: T.joana, full_name: 'Joana Ferreira da Silva', merged_into_id: null },
      ]);
    });
  });

  it('o indice de busca e GIN liderado por tenant_id, senao uma clinica paga o crescimento das outras', async () => {
    const { rows } = await admin.query<{ metodo: string; primeira: string }>(
      `SELECT am.amname AS metodo,
              (SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) AS primeira
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_am am ON am.oid = ic.relam
        WHERE ic.relname = 'ix_patient_busca'`,
    );
    expect(rows[0]).toEqual({ metodo: 'gin', primeira: 'tenant_id' });
  });

  it('o indice de digitos tambem e liderado por tenant_id', async () => {
    const { rows } = await admin.query<{ primeira: string }>(
      `SELECT (SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) AS primeira
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE ic.relname = 'ix_patient_digits'`,
    );
    expect(rows[0]!.primeira).toBe('tenant_id');
  });
});
