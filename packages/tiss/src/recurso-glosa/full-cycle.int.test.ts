// packages/tiss/src/recurso-glosa/full-cycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('ciclo completo do recurso de glosa TISS', () => {
  let s: SementeRecurso;
  let actor: Actor;
  let providerCtx: ProviderCtx;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      actorUserId: s.userId,
      requestId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('percorre o ciclo: criar -> adicionar -> remover -> marcar pronto -> submeter -> resolver parcial', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // 1. Criar recurso com 1 glosa
    const createResult = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0]!, justificativa: 'Procedimento necessario conforme protocolo', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const recursoId = createResult.value.recursoId;
    expect(createResult.value.itemCount).toBe(1);
    expect(createResult.value.totalRecursadoCents).toBe(1000);

    // 2. Adicionar segunda glosa
    const addResult = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1]!, 'Exame indicado clinicamente', 2000),
    );
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    expect(addResult.value.itemCount).toBe(2);
    expect(addResult.value.totalRecursadoCents).toBe(3000);

    // 3. Adicionar terceira glosa
    const addResult2 = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2]!, 'Retorno medicamente justificado', 3000),
    );
    expect(addResult2.ok).toBe(true);
    if (!addResult2.ok) return;
    expect(addResult2.value.itemCount).toBe(3);
    expect(addResult2.value.totalRecursadoCents).toBe(6000);

    // 4. Remover a terceira glosa (mudou de ideia)
    const removeResult = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, recursoId, s.glosaIds[2]!),
    );
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    expect(removeResult.value.itemCount).toBe(2);
    expect(removeResult.value.totalRecursadoCents).toBe(3000);

    // 5. Preencher justificativa geral e marcar pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [recursoId, 'Todos os procedimentos contestados foram clinicamente indicados e realizados conforme protocolo vigente.'],
      ),
    );

    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.itemCount).toBe(2);

    // 5b. Nao pode adicionar glosa a recurso pronto
    const addAfterReady = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2]!, 'Tarde demais', 500),
    );
    expect(addAfterReady.ok).toBe(false);
    if (addAfterReady.ok) return;
    expect(addAfterReady.error.kind).toBe('recurso_nao_rascunho');

    // 6. Submeter via fake transport
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.recursoId).toBe(recursoId);

    // Verifica que o transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe(recursoId);

    // Verifica status no banco
    const { rows: sentRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; sent_at: string | null }>(
        `SELECT status, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(sentRows[0]!.status).toBe('enviado');
    expect(sentRows[0]!.sent_at).toBeTruthy();

    // 7. Resolver como parcial (glosa 0 deferida, glosa 1 indeferida)
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[0]!, resultado: 'deferido' },
          { glosaId: s.glosaIds[1]!, resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.resultado).toBe('parcial');
    expect(resolveResult.value.itensDeferidos).toBe(1);
    expect(resolveResult.value.itensIndeferidos).toBe(1);

    // Verifica estado final no banco
    const { rows: finalRows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        status: string;
        resolved_at: string | null;
        item_count: number;
        total_recursado_cents: string;
      }>(
        `SELECT status, resolved_at, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(finalRows[0]!.status).toBe('parcial');
    expect(finalRows[0]!.resolved_at).toBeTruthy();
    expect(finalRows[0]!.item_count).toBe(2);
    expect(Number(finalRows[0]!.total_recursado_cents)).toBe(3000);

    // Verifica resultado individual dos itens
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ glosa_id: string; resultado: string }>(
        `SELECT glosa_id, resultado FROM tiss.recurso_glosa_item
          WHERE recurso_id = $1 ORDER BY glosa_id`,
        [recursoId],
      ),
    );
    expect(itemRows).toHaveLength(2);
    const resultadoMap = new Map(itemRows.map(r => [r.glosa_id, r.resultado]));
    expect(resultadoMap.get(s.glosaIds[0]!)).toBe('deferido');
    expect(resultadoMap.get(s.glosaIds[1]!)).toBe('indeferido');
  });
});
