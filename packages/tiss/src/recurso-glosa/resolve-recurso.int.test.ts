// packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { resolveRecurso } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('resolveRecurso', () => {
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

  async function criarRecursoEnviado(glosaIds: string[]): Promise<string> {
    const itens = glosaIds.map((id, idx) => ({
      glosaId: id,
      justificativa: `Motivo ${idx + 1}`,
      valorRecursadoCents: (idx + 1) * 1000,
    }));

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens,
      }),
    );
    if (!create.ok) throw new Error(`Falha ao criar recurso: ${create.error.kind}`);
    const recursoId = create.value.recursoId;

    // Marca pronto e enviado diretamente (para simplificar o teste)
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa
            SET justificativa_geral = 'Contestacao',
                status = 'enviado'::tiss.recurso_glosa_status,
                sent_at = clock_timestamp()
          WHERE id = $1`,
        [recursoId],
      ),
    );

    return recursoId;
  }

  it('resolve recurso como deferido — todos os itens deferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0]!]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[0]!, resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('deferido');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(0);

    // Verifica no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; resolved_at: string | null }>(
        `SELECT status, resolved_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('deferido');
    expect(rows[0]!.resolved_at).toBeTruthy();

    // Verifica resultado do item
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ resultado: string }>(
        `SELECT resultado FROM tiss.recurso_glosa_item WHERE recurso_id = $1`,
        [recursoId],
      ),
    );
    expect(itemRows[0]!.resultado).toBe('deferido');
  });

  it('resolve recurso como indeferido — todos os itens indeferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[1]!]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'indeferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[1]!, resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('indeferido');
    expect(resolve.value.itensDeferidos).toBe(0);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('resolve recurso como parcial — mix de deferido e indeferido', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[3]!, s.glosaIds[4]!]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[3]!, resultado: 'deferido' },
          { glosaId: s.glosaIds[4]!, resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('parcial');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('recusa resolver recurso que nao esta enviado', async () => {
    // Cria recurso em rascunho (nao enviado)
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[5]!, justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, create.value.recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[5]!, resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('transicao_invalida');
  });

  it('recusa resolver com item que nao pertence ao recurso', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[6]!]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[7]!, resultado: 'deferido' }, // nao esta neste recurso
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('item_nao_encontrado');
  });
});
