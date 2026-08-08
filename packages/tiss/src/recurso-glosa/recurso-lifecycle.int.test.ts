// packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('markRecursoReady', () => {
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

  it('transiciona recurso de rascunho para pronto com justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0]!, justificativa: 'Motivo 1', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [create.value.recursoId, 'Todos os procedimentos foram realizados conforme protocolo clinico.'],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.recursoId).toBe(create.value.recursoId);
    expect(ready.value.itemCount).toBe(1);
    expect(ready.value.totalRecursadoCents).toBe(1000);

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [create.value.recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('pronto');
  });

  it('recusa marcar pronto sem justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1]!, justificativa: 'Motivo 2', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // NAO preenche justificativa_geral
    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('justificativa_geral_ausente');
  });

  it('recusa marcar pronto recurso sem itens', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2]!, justificativa: 'Motivo 3', valorRecursadoCents: 3000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Remove o unico item
    await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[2]!),
    );

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral' WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('sem_itens');
  });

  it('recusa marcar pronto recurso que ja esta pronto', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[3]!, justificativa: 'Motivo R', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral R', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('transicao_invalida');
  });
});
