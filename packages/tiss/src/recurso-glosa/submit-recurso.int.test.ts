// packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { markRecursoReady, submitRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('submitRecurso', () => {
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

  it('envia recurso pronto com fake transport e transita para enviado', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // Cria e marca pronto
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0]!, justificativa: 'Necessario', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao formal' WHERE id = $1`,
        [recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(ready.ok).toBe(true);

    // Submete
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    expect(submit.value.recursoId).toBe(recursoId);
    expect(submit.value.storageKey).toBeTruthy();

    // Verifica estado no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; xml_storage_key: string | null; sent_at: string | null }>(
        `SELECT status, xml_storage_key, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('enviado');
    expect(rows[0]!.xml_storage_key).toBeTruthy();
    expect(rows[0]!.sent_at).toBeTruthy();

    // Verifica que o fake transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
  });

  it('timeout no transport transita para indeterminado — NUNCA retry', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1]!, justificativa: 'Procedimento indicado', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao timeout' WHERE id = $1`,
        [recursoId],
      ),
    );
    await withTenantTx(actor, (tx) => markRecursoReady(tx, recursoId));

    // Submete — timeout
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transport_indeterminado');

    // Verifica estado no banco: INDETERMINADO, nao enviado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('indeterminado');

    // Transport NAO recebeu nada (timeout simulado antes do efeito)
    expect(transport.submittedRecursos).toHaveLength(0);
  });

  it('recusa submeter recurso que nao esta pronto', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2]!, justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Nao marca pronto — status e rascunho
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, create.value.recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transicao_invalida');
  });
});
