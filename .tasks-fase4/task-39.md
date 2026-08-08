### Task 39: funcoes de ciclo de vida do lote — marcar pronto, enviar, retornar, cancelar

**Arquivos**

- Criar `packages/tiss/src/lote-lifecycle.ts`
- Criar `packages/tiss/src/lote-lifecycle.int.test.ts`
- Modificar `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar `packages/tiss/src/lote-lifecycle.ts`:

```typescript
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type LoteLifecycleFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_vazio' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'protocolo_obrigatorio' }
  | { kind: 'lote_ja_enviado' };

export interface LoteReadyResult {
  readonly loteId: string;
  readonly guiaCount: number;
  readonly totalValueCents: number;
}

export interface LoteSentResult {
  readonly loteId: string;
  readonly protocoloOperadora: string;
  readonly sentAt: string;
}

export interface LoteReturnedResult {
  readonly loteId: string;
}

export interface LoteCancelledResult {
  readonly loteId: string;
  readonly guiasLiberadas: number;
}

/**
 * Marca o lote como pronto para envio. Valida que o lote tem ao menos uma guia.
 * Transicao permitida: rascunho -> pronto.
 */
export async function markLoteReady(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteReadyResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'pronto' });
  }
  if (lote.guia_count === 0) {
    return err({ kind: 'lote_vazio' });
  }

  await tx.query(
    `UPDATE tiss.lote SET status = 'pronto' WHERE id = $1`,
    [loteId],
  );

  return ok({
    loteId: lote.id,
    guiaCount: lote.guia_count,
    totalValueCents: Number(lote.total_value_cents),
  });
}

/**
 * Marca o lote como enviado. Grava o protocolo da operadora e a data de envio.
 * Transicao permitida: pronto -> enviado.
 * xml_storage_key e xml_hash_md5 devem ter sido gravados antes (pelo bloco de XML).
 */
export async function markLoteSent(
  tx: TxClient,
  i: {
    loteId: string;
    protocoloOperadora: string;
    xmlStorageKey: string;
    xmlHashMd5: string;
  },
): Promise<Result<LoteSentResult, LoteLifecycleFailure>> {
  if (!i.protocoloOperadora) {
    return err({ kind: 'protocolo_obrigatorio' });
  }

  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'pronto') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'enviado' });
  }

  await tx.query(
    `UPDATE tiss.lote
        SET status = 'enviado',
            protocolo_operadora = $2,
            xml_storage_key = $3,
            xml_hash_md5 = $4,
            sent_at = clock_timestamp()
      WHERE id = $1`,
    [i.loteId, i.protocoloOperadora, i.xmlStorageKey, i.xmlHashMd5],
  );

  // Retorna a data de envio gravada pelo banco
  const { rows: sentRows } = await tx.query<{ sent_at: string }>(
    `SELECT sent_at FROM tiss.lote WHERE id = $1`,
    [i.loteId],
  );

  return ok({
    loteId: lote.id,
    protocoloOperadora: i.protocoloOperadora,
    sentAt: String(sentRows[0]!.sent_at),
  });
}

/**
 * Marca o lote como retornado pela operadora (demonstrativo recebido).
 * Transicao permitida: enviado -> retornado.
 */
export async function receiveLoteReturn(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteReturnedResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status !== 'enviado') {
    return err({ kind: 'transicao_invalida', de: lote.status, para: 'retornado' });
  }

  await tx.query(
    `UPDATE tiss.lote SET status = 'retornado' WHERE id = $1`,
    [loteId],
  );

  return ok({ loteId: lote.id });
}

/**
 * Cancela o lote e libera suas guias para inclusao em outro lote.
 * So e permitido se o lote NAO foi enviado (rascunho ou pronto).
 * As linhas de lote_guia sao removidas para liberar o indice unico.
 */
export async function cancelLote(
  tx: TxClient,
  loteId: string,
): Promise<Result<LoteCancelledResult, LoteLifecycleFailure>> {
  const { rows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [loteId],
  );
  if (rows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = rows[0]!;
  if (lote.status === 'enviado' || lote.status === 'retornado') {
    return err({ kind: 'lote_ja_enviado' });
  }
  if (lote.status === 'cancelado') {
    return err({ kind: 'transicao_invalida', de: 'cancelado', para: 'cancelado' });
  }

  // Remove os vinculos de guia para liberar o indice unico
  const { rowCount } = await tx.query(
    `DELETE FROM tiss.lote_guia WHERE lote_id = $1`,
    [loteId],
  );

  // Marca como cancelado e zera contadores
  await tx.query(
    `UPDATE tiss.lote
        SET status = 'cancelado', guia_count = 0, total_value_cents = 0
      WHERE id = $1`,
    [loteId],
  );

  return ok({
    loteId: lote.id,
    guiasLiberadas: rowCount ?? 0,
  });
}
```

- [ ] Criar o teste `packages/tiss/src/lote-lifecycle.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent, receiveLoteReturn, cancelLote } from './lote-lifecycle';

interface SementeLifecycle {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  guiaId: string;
  guiaBId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLifecycle(): Promise<SementeLifecycle> {
  const s: SementeLifecycle = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(), guiaBId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Lifecycle', '33ABC44556DE77')`,
      [s.tenantId, `lc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade LC', '3334455', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin LC')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente LC', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano LC', '55XYZ000004DE04', '3.05', true)`,
      [s.tenantId, s.operadoraId]);

    // Dois encounters e duas guias para este teste
    const enc1 = uuidv7();
    const enc2 = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T14:00:00Z', DATE '2026-08-01'),
              ($1, $6, $3, $4, $5, TIMESTAMPTZ '2026-08-02T14:00:00Z', DATE '2026-08-02')`,
      [s.tenantId, enc1, s.patientId, s.professionalId, s.clinicId, enc2]);

    const ver1 = uuidv7();
    const ver2 = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $6, $7, sha256('lc1'::bytea), 'jcs-1'),
              ($1, $4, $5, 1, 'original', $6, $7, sha256('lc2'::bytea), 'jcs-1')`,
      [s.tenantId, ver1, enc1, ver2, enc2, s.userId, s.professionalId]);

    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES
         ($1, $2, $8, $10, $4, '326305', 'LC001', '00998877665544', false,
          '900123', '3334455', '06', '333444', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $6),
         ($1, $3, $9, $11, $4, '326305', 'LC002', '00998877665544', false,
          '900123', '3334455', '06', '333444', 'SP', '225125', '9', '01',
          DATE '2026-08-02', '1', '22', '10101012', 180.00, true, $6)`,
      [s.tenantId, s.guiaId, s.guiaBId, s.operadoraId,
       s.patientId, s.userId, s.professionalId,
       enc1, enc2, ver1, ver2]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

describe('ciclo de vida do lote', () => {
  let s: SementeLifecycle;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearLifecycle();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  // ── markLoteReady ───────────────────────────────────────────────────────

  it('marca lote com guias como pronto', async () => {
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: lote.value.loteId, guiaId: s.guiaId }),
    );

    const result = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, lote.value.loteId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(1);
    expect(result.value.totalValueCents).toBe(25000);
  });

  it('recusa marcar lote vazio como pronto', async () => {
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, lote.value.loteId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_vazio');
  });

  // ── markLoteSent ────────────────────────────────────────────────────────

  it('marca lote pronto como enviado com protocolo', async () => {
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: lote.value.loteId, guiaId: s.guiaBId }),
    );
    await withTenantTx(actor, (tx) =>
      markLoteReady(tx, lote.value.loteId),
    );

    const result = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId: lote.value.loteId,
        protocoloOperadora: 'PROT-2026-001',
        xmlStorageKey: 'lote/2026/08/01/abc.xml',
        xmlHashMd5: '01234567890123456789012345678901',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.protocoloOperadora).toBe('PROT-2026-001');
    expect(result.value.sentAt).toBeTruthy();
  });

  it('recusa envio de lote em rascunho (precisa estar pronto)', async () => {
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId: lote.value.loteId,
        protocoloOperadora: 'PROT',
        xmlStorageKey: 'x',
        xmlHashMd5: '01234567890123456789012345678901',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('transicao_invalida');
  });

  // ── receiveLoteReturn ───────────────────────────────────────────────────

  it('marca lote enviado como retornado', async () => {
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;
    const loteId = lote.value.loteId;

    // Precisa de guia que nao esteja em outro lote
    // Cria guias frescas para este sub-teste
    const freshGuiaId = uuidv7();
    const freshEncId = uuidv7();
    const freshVerId = uuidv7();
    const freshAdmin = new Pool({ connectionString: adminUrl(), max: 1 });
    const fc = await freshAdmin.connect();
    try {
      await fc.query('BEGIN');
      await fc.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-05T14:00:00Z', DATE '2026-08-05')`,
        [s.tenantId, freshEncId, s.patientId, s.professionalId, s.clinicId]);
      await fc.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('fresh1'::bytea), 'jcs-1')`,
        [s.tenantId, freshVerId, freshEncId, s.userId, s.professionalId]);
      await fc.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '3334455', '06', '333444', 'SP', '225125', '9', '01',
            DATE '2026-08-05', '1', '22', '10101012', 150.00, true, $7)`,
        [s.tenantId, freshGuiaId, freshEncId, freshVerId, s.operadoraId,
         `LC-${freshGuiaId.slice(0, 13)}`, s.userId]);
      await fc.query('COMMIT');
    } finally {
      fc.release();
      await freshAdmin.end();
    }

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: freshGuiaId }),
    );
    await withTenantTx(actor, (tx) => markLoteReady(tx, loteId));
    await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-RET',
        xmlStorageKey: 'lote/ret.xml',
        xmlHashMd5: 'abcdef01234567890123456789abcdef',
      }),
    );

    const result = await withTenantTx(actor, (tx) =>
      receiveLoteReturn(tx, loteId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loteId).toBe(loteId);
  });

  // ── cancelLote ──────────────────────────────────────────────────────────

  it('cancela lote rascunho e libera guias', async () => {
    const freshGuiaId = uuidv7();
    const freshEncId = uuidv7();
    const freshVerId = uuidv7();
    const freshAdmin = new Pool({ connectionString: adminUrl(), max: 1 });
    const fc = await freshAdmin.connect();
    try {
      await fc.query('BEGIN');
      await fc.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-06T14:00:00Z', DATE '2026-08-06')`,
        [s.tenantId, freshEncId, s.patientId, s.professionalId, s.clinicId]);
      await fc.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('cancelguia'::bytea), 'jcs-1')`,
        [s.tenantId, freshVerId, freshEncId, s.userId, s.professionalId]);
      await fc.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '3334455', '06', '333444', 'SP', '225125', '9', '01',
            DATE '2026-08-06', '1', '22', '10101012', 200.00, true, $7)`,
        [s.tenantId, freshGuiaId, freshEncId, freshVerId, s.operadoraId,
         `LC-${freshGuiaId.slice(0, 13)}`, s.userId]);
      await fc.query('COMMIT');
    } finally {
      fc.release();
      await freshAdmin.end();
    }

    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: lote.value.loteId, guiaId: freshGuiaId }),
    );

    const result = await withTenantTx(actor, (tx) =>
      cancelLote(tx, lote.value.loteId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiasLiberadas).toBe(1);

    // Apos cancelamento, a guia pode ser adicionada a outro lote
    const lote2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote2.ok).toBe(true);
    if (!lote2.ok) return;

    const add2 = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: lote2.value.loteId, guiaId: freshGuiaId }),
    );
    expect(add2.ok).toBe(true);
  });

  it('recusa cancelamento de lote ja enviado', async () => {
    const freshGuiaId = uuidv7();
    const freshEncId = uuidv7();
    const freshVerId = uuidv7();
    const freshAdmin = new Pool({ connectionString: adminUrl(), max: 1 });
    const fc = await freshAdmin.connect();
    try {
      await fc.query('BEGIN');
      await fc.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-07T14:00:00Z', DATE '2026-08-07')`,
        [s.tenantId, freshEncId, s.patientId, s.professionalId, s.clinicId]);
      await fc.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('cancel2'::bytea), 'jcs-1')`,
        [s.tenantId, freshVerId, freshEncId, s.userId, s.professionalId]);
      await fc.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '3334455', '06', '333444', 'SP', '225125', '9', '01',
            DATE '2026-08-07', '1', '22', '10101012', 100.00, true, $7)`,
        [s.tenantId, freshGuiaId, freshEncId, freshVerId, s.operadoraId,
         `LC-${freshGuiaId.slice(0, 13)}`, s.userId]);
      await fc.query('COMMIT');
    } finally {
      fc.release();
      await freshAdmin.end();
    }

    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: lote.value.loteId, guiaId: freshGuiaId }),
    );
    await withTenantTx(actor, (tx) =>
      markLoteReady(tx, lote.value.loteId),
    );
    await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId: lote.value.loteId,
        protocoloOperadora: 'PROT-CANCEL',
        xmlStorageKey: 'lote/cancel.xml',
        xmlHashMd5: '99999999999999999999999999999999',
      }),
    );

    const result = await withTenantTx(actor, (tx) =>
      cancelLote(tx, lote.value.loteId),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_ja_enviado');
  });
});
```

- [ ] Atualizar `packages/tiss/src/index.ts` com as exportacoes completas:

```typescript
export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
export {
  addGuiaToLote, removeGuiaFromLote,
  type AddGuiaInput, type AddedGuia, type AddGuiaFailure, type RemoveGuiaFailure,
} from './lote-guias';
export {
  markLoteReady, markLoteSent, receiveLoteReturn, cancelLote,
  type LoteLifecycleFailure, type LoteReadyResult, type LoteSentResult,
  type LoteReturnedResult, type LoteCancelledResult,
} from './lote-lifecycle';
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/lote-lifecycle.int.test.ts
```

Saida esperada: 6 testes passando.

---