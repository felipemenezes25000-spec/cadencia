import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { resolveCid10At, loadCid10Competencia, parseCid10Csv } from './cid10';

// Cenário: a CID-10 é recarregada em 2025 e a descrição de J45 muda. Um
// atendimento de 2024 tem que continuar resolvendo a descrição de 2024.
beforeAll(async () => {
  await jobsPool().query(`DELETE FROM ref.cid10_term WHERE codigo IN ('J45','I10','A00')`);
  await loadCid10Competencia(jobsPool(), {
    competencia: '200801',
    vigenciaFrom: '2008-01-01',
    vigenciaTo: '2025-01-01',
    rows: [
      { codigo: 'J45', descricao: 'Asma', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ],
  });
  await loadCid10Competencia(jobsPool(), {
    competencia: '202501',
    vigenciaFrom: '2025-01-01',
    vigenciaTo: null,
    rows: [
      { codigo: 'J45', descricao: 'Asma (revisao 2025)', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ],
  });
});

describe('CID-10 versionada por data', () => {
  it('ATENDIMENTO DE 2024 RESOLVE PELA VIGENCIA DE 2024, nao pela de hoje', async () => {
    const passado = await resolveCid10At(appPool(), 'J45', '2024-08-03');
    const hoje = await resolveCid10At(appPool(), 'J45', '2026-08-03');
    expect(passado.ok).toBe(true);
    expect(hoje.ok).toBe(true);
    if (!passado.ok || !hoje.ok) return;
    expect(passado.value.display).toBe('Asma');
    expect(hoje.value.display).toBe('Asma (revisao 2025)');
    expect(passado.value.terminologyVersion).toBe('200801');
    expect(hoje.value.terminologyVersion).toBe('202501');
  });

  it('codigo que nao existia na data do atendimento nao e inventado', async () => {
    await loadCid10Competencia(jobsPool(), {
      competencia: '202501',
      vigenciaFrom: '2025-01-01',
      vigenciaTo: null,
      rows: [{ codigo: 'A00', descricao: 'Colera', capitulo: 1 }],
    });
    const r = await resolveCid10At(appPool(), 'A00', '2024-08-03');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_inexistente_na_data');
  });

  it('a data do limite superior e exclusiva: 2025-01-01 ja e a vigencia nova', async () => {
    const vespera = await resolveCid10At(appPool(), 'J45', '2024-12-31');
    const virada = await resolveCid10At(appPool(), 'J45', '2025-01-01');
    expect(vespera.ok && vespera.value.display).toBe('Asma');
    expect(virada.ok && virada.value.display).toBe('Asma (revisao 2025)');
  });

  it('carregar competencia com vigencia sobreposta e impossivel: o banco recusa', async () => {
    await expect(
      loadCid10Competencia(jobsPool(), {
        competencia: '202403',
        vigenciaFrom: '2024-01-01', // invade a faixa 2008-2025 de J45
        vigenciaTo: '2026-01-01',
        rows: [{ codigo: 'J45', descricao: 'Asma (carga errada)', capitulo: 10 }],
      }),
    ).rejects.toMatchObject({ code: '23P01' }); // exclusion_violation
  });

  it('a funcao SQL ref.cid10_at devolve o mesmo termo que a funcao TS', async () => {
    const { rows } = await appPool().query(
      `SELECT descricao, competencia FROM ref.cid10_at($1, $2::date)`,
      ['J45', '2024-08-03'],
    );
    expect(rows[0].descricao).toBe('Asma');
    expect(rows[0].competencia).toBe('200801');
  });

  it('parseCid10Csv le o formato distribuido pelo DATASUS', () => {
    const csv = [
      'codigo;descricao;capitulo',
      'J45;Asma;10',
      'I10;Hipertensao essencial (primaria);9',
      '',
    ].join('\n');
    expect(parseCid10Csv(csv)).toEqual([
      { codigo: 'J45', descricao: 'Asma', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ]);
  });
});
