import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { loadCid10Competencia, resolveCid10At } from './cid10';
import { toTermSnapshot } from './snapshot';

beforeAll(async () => {
  await jobsPool().query(`DELETE FROM ref.cid10_term WHERE codigo = 'E11'`);
  await loadCid10Competencia(jobsPool(), {
    competencia: '200801', vigenciaFrom: '2008-01-01', vigenciaTo: '2025-01-01',
    rows: [{ codigo: 'E11', descricao: 'Diabetes mellitus nao-insulino-dependente', capitulo: 4 }],
  });
});

describe('display_snapshot', () => {
  it('grava as quatro colunas juntas: sistema, codigo, descricao e competencia', async () => {
    const r = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(toTermSnapshot(r.value)).toEqual({
      value_ref_source: 'CID10',
      value_ref_code: 'E11',
      display_snapshot: 'Diabetes mellitus nao-insulino-dependente',
      terminology_version: '200801',
    });
  });

  it('MUDAR A TERMINOLOGIA DEPOIS NAO REESCREVE O PASSADO: 2024 reaberto em 2026 da o mesmo snapshot', async () => {
    const antes = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    if (!antes.ok) throw new Error('cenario invalido: E11 deveria existir em 2024');
    const gravado = toTermSnapshot(antes.value);

    await loadCid10Competencia(jobsPool(), {
      competencia: '202501', vigenciaFrom: '2025-01-01', vigenciaTo: null,
      rows: [{ codigo: 'E11', descricao: 'Diabetes mellitus tipo 2', capitulo: 4 }],
    });

    // A carga nova vale para o atendimento novo...
    const atendimentoNovo = await resolveCid10At(appPool(), 'E11', '2026-08-03');
    expect(atendimentoNovo.ok).toBe(true);
    if (!atendimentoNovo.ok) return;
    expect(toTermSnapshot(atendimentoNovo.value)).toEqual({
      value_ref_source: 'CID10',
      value_ref_code: 'E11',
      display_snapshot: 'Diabetes mellitus tipo 2',
      terminology_version: '202501',
    });

    // ...e o atendimento de 2024, resolvido DEPOIS da carga, devolve byte a byte
    // o mesmo snapshot de antes. É isto que a impressão de 2035 tem que mostrar.
    const reaberto = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    expect(reaberto.ok).toBe(true);
    if (!reaberto.ok) return;
    expect(toTermSnapshot(reaberto.value)).toEqual(gravado);
    expect(reaberto.value.display).toBe('Diabetes mellitus nao-insulino-dependente');
    expect(reaberto.value.terminologyVersion).toBe('200801');
  });
});
