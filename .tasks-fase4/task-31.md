### Task 31: Handler reprojectGuiaOnAmend — amend sem lote reprojeta a guia

**Arquivos**

- Criar: `packages/tiss/src/reproject-guia.ts`
- Modificar: `packages/tiss/src/index.ts`
- Modificar: `packages/tiss/src/reproject-guia.int.test.ts`
- Modificar: `apps/worker/src/jobs/outbox-dispatcher.ts`

**Passos**

- [ ] Adicionar o teste que falha em `packages/tiss/src/reproject-guia.int.test.ts`: retificacao sem lote reprojeta a guia (marca a antiga como `live=false` e cria nova guia vinculada a nova versao).

```typescript
// ADICIONAR ao final de packages/tiss/src/reproject-guia.int.test.ts,
// apos o bloco describe existente:

import { reprojectGuiaOnAmend } from './reproject-guia';
import { projectGuiaConsulta } from './project-guia';

describe('reprojectGuiaOnAmend — sem lote', () => {
  it('retificacao sem lote reprojeta: guia antiga live=false, nova guia criada', async () => {
    // 1) Projetar a guia original (usando o projectGuiaConsulta do bloco 04)
    const projecao = await withTenantTx(actor, async (tx) => {
      return projectGuiaConsulta(tx, s.encounterId, s.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia original
    const guiaOriginal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string; live: boolean }>(
        `SELECT id, live FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaOriginal).toBeDefined();
    expect(guiaOriginal?.live).toBe(true);

    // 3) Fazer a retificacao (ja feita no teste anterior — version_no=2 ja existe).
    // Buscar o version_id da retificacao
    const retificacaoVersion = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM clin.encounter_version
          WHERE encounter_id = $1 AND version_no = 2`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(retificacaoVersion).toBeDefined();

    // 4) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor, async (tx) => {
      return reprojectGuiaOnAmend(tx, s.encounterId, retificacaoVersion!.id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 5) Verificar que a guia antiga ficou live=false
    const guiaAntigaDepois = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guiaOriginal!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 6) Verificar que existe uma nova guia live=true vinculada a versao da retificacao
    const guiaNova = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string; live: boolean; encounter_version_id: string;
      }>(
        `SELECT id, live, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.live).toBe(true);
    expect(guiaNova?.encounter_version_id).toBe(retificacaoVersion!.id);
    expect(guiaNova?.id).not.toBe(guiaOriginal!.id);
  });

  it('retificacao sem guia existente retorna no_guia', async () => {
    // Criar um atendimento sem guia projetada e retificar
    const s2 = await semearTiss();
    const actor2: Actor = {
      kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
      clinicId: s2.clinicId, requestId: uuidv7(),
    };

    // Retificar (criar versao 2)
    const retificacao = await withTenantTx(actor2, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de diagnostico sem guia associada',
            p_incompleto => false)`,
        [s2.encounterId, 'bb'.repeat(32), s2.versionId],
      );
      return rows[0];
    });

    // Chamar o handler — nao deve haver guia para reprojetar
    const resultado = await withTenantTx(actor2, async (tx) => {
      return reprojectGuiaOnAmend(tx, s2.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('no_guia');
    }
  });
});
```

- [ ] Rodar o teste e confirmar a falha:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: falha — modulo './reproject-guia' nao existe
```

- [ ] Implementar o handler `packages/tiss/src/reproject-guia.ts`:

```typescript
// packages/tiss/src/reproject-guia.ts
import type { TxClient } from '@cadencia/db';
import type { Result } from '@cadencia/kernel';
import { ok, err } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export type ReprojectAction =
  | { action: 'reprojected'; oldGuiaId: string; newGuiaId: string }
  | { action: 'pendencia_created'; pendenciaId: string; guiaId: string }
  | { action: 'no_guia'; reason: string };

export type ReprojectError = {
  code: 'PROJECTION_FAILED';
  message: string;
};

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Regra de reprojecao apos retificacao ou adendo (design S3.9):
 *
 * 1. Busca a guia VIVA do atendimento.
 * 2. Se nao existe guia → retorna no_guia (atendimento particular ou guia
 *    nunca foi projetada).
 * 3. Verifica se a guia pertence a um lote JA ENVIADO:
 *    - Se pertence a lote enviado (status IN ('enviado','retornado')) →
 *      cria pendencia em tiss.guia_pendencia (tipo='reprojecao_pos_envio').
 *    - Se NAO pertence a lote enviado (nenhum lote, ou lote rascunho/pronto) →
 *      marca a guia antiga como live=false e projeta nova guia da nova versao.
 */
export async function reprojectGuiaOnAmend(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ReprojectAction, ReprojectError>> {
  // 1) Buscar a guia viva do atendimento
  const { rows: guias } = await tx.query<{ id: string }>(
    `SELECT g.id
       FROM tiss.encounter_guia_consulta g
      WHERE g.encounter_id = $1
        AND g.live = true`,
    [encounterId],
  );

  if (guias.length === 0) {
    return ok({ action: 'no_guia' as const, reason: 'nenhuma guia viva para este atendimento' });
  }

  const guiaId = guias[0]!.id;

  // 2) Verificar se a guia pertence a um lote ja enviado.
  // tiss.lote_guia e tiss.lote sao criados pelo bloco 06 (migrations 0119-0121).
  // A query usa LEFT JOIN para funcionar mesmo se nenhum lote existir.
  const { rows: loteRows } = await tx.query<{ lote_status: string | null }>(
    `SELECT l.status AS lote_status
       FROM tiss.lote_guia lg
       JOIN tiss.lote l ON (l.tenant_id, l.id) = (lg.tenant_id, lg.lote_id)
      WHERE lg.guia_id = $1
        AND l.status NOT IN ('cancelado')
      ORDER BY l.created_at DESC
      LIMIT 1`,
    [guiaId],
  );

  const loteEnviado = loteRows.length > 0
    && loteRows[0]!.lote_status !== null
    && ['enviado', 'retornado'].includes(loteRows[0]!.lote_status);

  // 3a) Lote ja enviado → criar pendencia
  if (loteEnviado) {
    const { rows: pendencia } = await tx.query<{ id: string }>(
      `INSERT INTO tiss.guia_pendencia
         (tenant_id, id, guia_id, encounter_version_id, tipo)
       VALUES (
         (SELECT tenant_id FROM tiss.encounter_guia_consulta WHERE id = $1),
         gen_random_uuid(), $1, $2, 'reprojecao_pos_envio'
       )
       RETURNING id`,
      [guiaId, encounterVersionId],
    );
    return ok({
      action: 'pendencia_created' as const,
      pendenciaId: pendencia[0]!.id,
      guiaId,
    });
  }

  // 3b) Sem lote enviado → reprojetar
  // Marcar a guia antiga como live=false
  await tx.query(
    `UPDATE tiss.encounter_guia_consulta SET live = false WHERE id = $1`,
    [guiaId],
  );

  // Projetar nova guia da nova versao
  const projecao = await projectGuiaConsulta(tx, encounterId, encounterVersionId);
  if (!projecao.ok) {
    return err({
      code: 'PROJECTION_FAILED' as const,
      message: `falha ao projetar nova guia: ${String(projecao.error)}`,
    });
  }

  // Buscar o id da nova guia criada
  const { rows: novaGuia } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.encounter_guia_consulta
      WHERE encounter_id = $1 AND live = true`,
    [encounterId],
  );

  return ok({
    action: 'reprojected' as const,
    oldGuiaId: guiaId,
    newGuiaId: novaGuia[0]!.id,
  });
}
```

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar o handler:

```typescript
// packages/tiss/src/index.ts
export { reprojectGuiaOnAmend, type ReprojectAction, type ReprojectError } from './reproject-guia';
```

- [ ] Adicionar o roteamento de `ENCOUNTER_AMENDED` no outbox dispatcher. Modificar `apps/worker/src/jobs/outbox-dispatcher.ts`:

```typescript
// Em apps/worker/src/jobs/outbox-dispatcher.ts, na funcao resolveQueue,
// ADICIONAR antes do comentario "// Eventos financeiros":

  // Eventos TISS
  if (eventType === 'ENCOUNTER_AMENDED') return 'tiss.encounter_amended';
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: todos os testes passam — retificacao sem lote reprojeta, sem guia retorna no_guia

cd apps/worker && pnpm vitest run src/jobs/outbox-dispatcher
# Esperado: dispatcher testa passam (se existentes)
```

- [ ] Commitar:

```bash
git add packages/tiss/src/reproject-guia.ts \
       packages/tiss/src/index.ts \
       packages/tiss/src/reproject-guia.int.test.ts \
       apps/worker/src/jobs/outbox-dispatcher.ts
git commit -m "feat(tiss): add reprojectGuiaOnAmend handler and outbox routing for ENCOUNTER_AMENDED"
```

---