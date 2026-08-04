import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './invariants/catalog';
import { verifyRestore } from './verify-restore';
import type { CheckResult } from './verify-restore';

const TENANT = '01930000-0000-7000-8000-0000000ce001';

afterAll(async () => {
  await closeCatalogPool();
});

function check(resultados: readonly CheckResult[], nome: string): CheckResult {
  const achado = resultados.find((r) => r.name === nome);
  expect(achado, `check ${nome} nao foi executado`).toBeDefined();
  return achado!;
}

describe('verify-restore — restauracao so vale se for verificada', () => {
  it('confirma que os oito schemas do desenho vieram inteiros', async () => {
    const resultados = await verifyRestore(catalogPool());
    const schemas = check(resultados, 'schemas-presentes');
    expect(schemas.ok).toBe(true);
    expect(schemas.skipped).toBe(false);
  });

  it('aprova quando a trilha tem evento — e o estado esperado de um banco restaurado de verdade', async () => {
    const resultados = await verifyRestore(catalogPool());
    const trilha = check(resultados, 'trilha-nao-vazia');
    expect(trilha.skipped).toBe(false);
    expect(trilha.ok).toBe(true);
    expect(trilha.detail).toMatch(/^[1-9]\d* evento\(s\) em audit\.event$/);
  });

  it('reprova trilha vazia — banco restaurado sem trilha nao prova nada em auditoria', async () => {
    const resultados = await inRollbackTx(async (c) => {
      // TRUNCATE e transacional e nao dispara o trigger de linha `no_mutate`:
      // a trilha some so dentro desta transacao, que sempre e revertida.
      await c.query('TRUNCATE audit.event');
      return verifyRestore(c);
    });
    const trilha = check(resultados, 'trilha-nao-vazia');
    expect(trilha.skipped).toBe(false);
    expect(trilha.ok).toBe(false);
    expect(trilha.detail).toBe('0 evento(s) em audit.event');
  });

  it('aprova cadeia de selo encadeada corretamente', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query(
        `INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id, row_count,
                                 chain_hash, prev_chain_hash, snapshot_xmin)
              VALUES ($1, DATE '2026-08-01', 1, 10, 10, '\\x01'::bytea, NULL,          1),
                     ($1, DATE '2026-08-02', 11, 20, 10, '\\x02'::bytea, '\\x01'::bytea, 2)`,
        [TENANT],
      );
      return verifyRestore(c);
    });
    expect(check(resultados, 'cadeia-de-selo').ok).toBe(true);
  });

  it('reprova cadeia de selo rompida — e a unica prova de que a trilha nao foi adulterada', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query(
        `INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id,row_count,
                                 chain_hash, prev_chain_hash, snapshot_xmin)
              VALUES ($1, DATE '2026-08-01', 1, 10, 10, '\\x01'::bytea, NULL,          1),
                     ($1, DATE '2026-08-02', 11, 20, 10, '\\x02'::bytea, '\\xff'::bytea, 2)`,
        [TENANT],
      );
      return verifyRestore(c);
    });
    const cadeia = check(resultados, 'cadeia-de-selo');
    expect(cadeia.ok).toBe(false);
    expect(cadeia.detail).toContain('2026-08-02');
  });

  it('pula em silencio o que ainda nao existe nesta fase, e diz que pulou', async () => {
    const resultados = await verifyRestore(catalogPool());
    const versoes = check(resultados, 'cadeia-de-versao-clinica');
    expect(versoes.skipped).toBe(true);
    expect(versoes.detail).toContain('clin.encounter_version');
  });
});
