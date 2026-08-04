import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools } from './index';

// `appPool` roda como app_rw, que so tem SELECT no catalogo: uma tentativa de
// INSERT por ali morreria em 42501 antes de chegar ao indice. Para provar que
// quem barra a segunda versao corrente e o indice, escreve-se pela conexao
// administrativa — mesmo padrao de roles.int.test.ts e tx.int.test.ts.
let admin: Pool;

describe('ref.record_template', () => {
  beforeAll(() => { admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 }); });
  afterAll(async () => { await admin.end(); await closePools(); });

  it('permite duas versoes do mesmo code e identifica a corrente', async () => {
    const { rows } = await appPool().query<{ code: string; version: number; is_current: boolean }>(
      `SELECT code, version, is_current FROM ref.record_template
        WHERE code = 'consulta_geral' ORDER BY version`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
  });

  it('impede duas versoes correntes do mesmo code', async () => {
    await expect(
      admin.query(
        `INSERT INTO ref.record_template (id, code, version, name, specialty, is_current, spec)
         VALUES (gen_random_uuid(), 'consulta_geral', 99, 'Duplicata', NULL, true, '{}'::jsonb)`,
      ),
    ).rejects.toThrow(/ux_record_template_current/);
  });

  it('traz o modelo de consulta geral com as secoes na ordem clinica', async () => {
    const { rows } = await appPool().query<{ sections: unknown }>(
      `SELECT spec -> 'sections' AS sections FROM ref.record_template
        WHERE code = 'consulta_geral' AND is_current`,
    );
    const nomes = (rows[0]?.sections as { code: string }[]).map((s) => s.code);
    expect(nomes).toEqual([
      'queixa', 'hma', 'antecedentes', 'sinais_vitais', 'exame_fisico',
      'hipoteses', 'conduta',
    ]);
  });
});
