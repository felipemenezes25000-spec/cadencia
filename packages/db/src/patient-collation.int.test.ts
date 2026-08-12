import { afterAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

describe('ordenacao de nome de paciente', () => {
  afterAll(async () => { await closePools(); });

  it('a coluna de exibicao ordena em portugues, nao em bytes', async () => {
    const { rows } = await appPool().query<{ n: string }>(
      `SELECT n FROM (VALUES ('Ana'),('Bruno'),('Zeca'),('Álvaro'),('Ângela'))
         AS t(n) ORDER BY n COLLATE "pt-BR-x-icu"`);
    expect(rows.map((r) => r.n)).toEqual(['Álvaro', 'Ana', 'Ângela', 'Bruno', 'Zeca']);
  });

  it('clin.patient.display_name existe, e gerada e carrega a collation', async () => {
    const { rows } = await appPool().query<{ collname: string; is_generated: string }>(
      `SELECT co.collname, c.is_generated
         FROM information_schema.columns c
         JOIN pg_attribute a ON a.attname = c.column_name
          AND a.attrelid = 'clin.patient'::regclass
         LEFT JOIN pg_collation co ON co.oid = a.attcollation
        WHERE c.table_schema='clin' AND c.table_name='patient' AND c.column_name='display_name'`);
    expect(rows[0]?.collname).toBe('pt-BR-x-icu');
    expect(rows[0]?.is_generated).toBe('ALWAYS');
  });

  // pg_indexes.indexdef OMITE o "COLLATE" quando ele coincide com a collation da
  // coluna, então o texto do indexdef não prova nada. A verdade está em
  // pg_index.indcollation, que é o que o planejador de fato usa.
  it('o indice que serve a listagem carrega a MESMA collation', async () => {
    const { rows } = await appPool().query<{ attname: string; collname: string | null }>(
      `SELECT a.attname, co.collname
         FROM pg_index i
         JOIN LATERAL unnest(i.indkey, i.indcollation) WITH ORDINALITY AS k(attnum, colloid, ord)
           ON true
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         LEFT JOIN pg_collation co ON co.oid = k.colloid
        WHERE i.indexrelid = 'clin.ix_patient_ordem'::regclass
        ORDER BY k.ord`);
    expect(rows.map((r) => r.attname)).toEqual(['tenant_id', 'display_name', 'id']);
    expect(rows[1]?.collname).toBe('pt-BR-x-icu');
  });
});
