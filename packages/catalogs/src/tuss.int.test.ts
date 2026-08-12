import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { loadTussCompetencia, resolveTussAt } from './tuss';

// Tabela 22 = "Procedimentos e eventos em saúde" da ANS. Tabela 20 = diárias.
const TAB_PROCEDIMENTOS = 22;
const TAB_DIARIAS = 20;

beforeAll(async () => {
  await jobsPool().query(
    `DELETE FROM ref.tuss_term WHERE codigo IN ('10101012','10101047')`,
  );
  await loadTussCompetencia(jobsPool(), {
    competencia: '202401',
    vigenciaFrom: '2024-01-01',
    vigenciaTo: '2026-01-01',
    rows: [{
      tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
      termo: 'Consulta em consultorio (no horario normal ou preestabelecido)',
      acao: 'inclusao',
    }],
  });
  await loadTussCompetencia(jobsPool(), {
    competencia: '202601',
    vigenciaFrom: '2026-01-01',
    vigenciaTo: null,
    rows: [
      { tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
        termo: 'Consulta em consultorio', acao: 'alteracao' },
      { tabela: TAB_PROCEDIMENTOS, codigo: '10101047',
        termo: 'Teleconsulta em consultorio', acao: 'inclusao' },
    ],
  });
});

describe('TUSS versionada por data', () => {
  it('GUIA DE 2025 REAPRESENTADA EM 2026 USA O TERMO DE 2025', async () => {
    const guia2025 = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-06-10');
    const guiaHoje = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2026-06-10');
    expect(guia2025.ok).toBe(true);
    expect(guiaHoje.ok).toBe(true);
    if (!guia2025.ok || !guiaHoje.ok) return;
    expect(guia2025.value.display)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(guiaHoje.value.display).toBe('Consulta em consultorio');
    expect(guia2025.value.terminologyVersion).toBe('202401');
    expect(guiaHoje.value.terminologyVersion).toBe('202601');
  });

  it('codigo criado na competencia de 2026 nao e inventado para atendimento de 2025', async () => {
    const r = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101047', '2025-06-10');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_inexistente_na_data');
  });

  it('o limite superior e exclusivo: 2026-01-01 ja e a competencia nova', async () => {
    const vespera = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-12-31');
    const virada = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2026-01-01');
    expect(vespera.ok && vespera.value.terminologyVersion).toBe('202401');
    expect(virada.ok && virada.value.terminologyVersion).toBe('202601');
  });

  it('recarregar competencia sobre vigencia existente e impossivel: o banco recusa', async () => {
    await expect(
      loadTussCompetencia(jobsPool(), {
        competencia: '202503',
        vigenciaFrom: '2025-01-01',   // invade a faixa 2024-2026 do mesmo código
        vigenciaTo: '2027-01-01',
        rows: [{ tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
                 termo: 'Consulta (carga errada)', acao: 'alteracao' }],
      }),
    ).rejects.toMatchObject({ code: '23P01' });   // exclusion_violation
  });

  it('o mesmo codigo em tabelas diferentes da ANS nao se confunde', async () => {
    await loadTussCompetencia(jobsPool(), {
      competencia: '202401', vigenciaFrom: '2024-01-01', vigenciaTo: null,
      rows: [{ tabela: TAB_DIARIAS, codigo: '10101012',
               termo: 'Diaria de apartamento', acao: 'inclusao' }],
    });
    const proc = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-06-10');
    const diaria = await resolveTussAt(appPool(), TAB_DIARIAS, '10101012', '2025-06-10');
    expect(proc.ok && proc.value.display)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(diaria.ok && diaria.value.display).toBe('Diaria de apartamento');
  });

  it('a funcao SQL ref.tuss_at devolve o mesmo termo que a funcao TS', async () => {
    const { rows } = await appPool().query(
      `SELECT termo, competencia FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '10101012', '2025-06-10'],
    );
    expect(rows[0].termo)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(rows[0].competencia).toBe('202401');
  });
});
