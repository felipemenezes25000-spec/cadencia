// packages/tiss/src/recurso-glosa/recurso-items.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('addGlosaToRecurso e removeGlosaFromRecurso', () => {
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

  it('adiciona glosa a recurso existente em rascunho', async () => {
    // Cria recurso com 1 glosa
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
    const recursoId = create.value.recursoId;

    // Adiciona segunda glosa
    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1]!, 'Motivo 2', 2000),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.value.itemCount).toBe(2);
    expect(add.value.totalRecursadoCents).toBe(3000);
  });

  it('recusa adicionar glosa a recurso que nao esta em rascunho', async () => {
    // Cria recurso com justificativa geral e marca pronto
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
    const recursoId = create.value.recursoId;

    // Atualiza justificativa_geral e marca pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao geral', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [recursoId],
      ),
    );

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[0]!, 'Motivo extra', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('recurso_nao_rascunho');
  });

  it('recusa adicionar glosa ja vinculada ao mesmo recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[3]!, justificativa: 'Motivo A', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, create.value.recursoId, s.glosaIds[3]!, 'Duplicata', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('glosa_ja_no_recurso');
  });

  it('remove glosa de recurso em rascunho e atualiza contadores', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[4]!, justificativa: 'Motivo X', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[5]!, justificativa: 'Motivo Y', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[4]!),
    );
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(remove.value.itemCount).toBe(1);
    expect(remove.value.totalRecursadoCents).toBe(2000);
  });

  it('recusa remover glosa que nao esta no recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[6]!, justificativa: 'Motivo W', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[7]!),
    );
    expect(remove.ok).toBe(false);
    if (remove.ok) return;
    expect(remove.error.kind).toBe('vinculo_nao_encontrado');
  });
});
