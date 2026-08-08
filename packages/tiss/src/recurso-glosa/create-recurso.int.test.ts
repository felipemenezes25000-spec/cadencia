// packages/tiss/src/recurso-glosa/create-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('createRecursoGlosa', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria recurso em rascunho com 2 glosas vinculadas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Procedimento necessario', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[1], justificativa: 'Exame indicado clinicamente', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(2);
    expect(result.value.totalRecursadoCents).toBe(3000);
    expect(result.value.recursoId).toBeTruthy();

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; item_count: number; total_recursado_cents: string }>(
        `SELECT status, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [result.value.recursoId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('rascunho');
    expect(rows[0]!.item_count).toBe(2);
    expect(Number(rows[0]!.total_recursado_cents)).toBe(3000);
  });

  it('recusa criacao sem itens', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('sem_itens');
  });

  it('recusa glosa inexistente', async () => {
    const fakeGlosaId = uuidv7();
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: fakeGlosaId, justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('glosa_nao_encontrada');
  });
});
