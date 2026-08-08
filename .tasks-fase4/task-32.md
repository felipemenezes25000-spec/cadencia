### Task 32: Handler reprojectGuiaOnAmend — amend com lote enviado cria pendencia

**Arquivos**

- Modificar: `packages/tiss/src/reproject-guia.int.test.ts`

**Passos**

- [ ] Adicionar o teste que exercita o cenario de lote ja enviado em `packages/tiss/src/reproject-guia.int.test.ts`. O teste cria um lote com status `enviado`, associa a guia ao lote e entao faz a retificacao — o handler deve criar uma pendencia em `tiss.guia_pendencia` em vez de reprojetar.

```typescript
// ADICIONAR ao final de packages/tiss/src/reproject-guia.int.test.ts,
// apos o bloco describe('reprojectGuiaOnAmend — sem lote'):

describe('reprojectGuiaOnAmend — com lote enviado', () => {
  it('retificacao com guia em lote enviado cria pendencia em vez de reprojetar', async () => {
    // Novo tenant para teste isolado
    const s3 = await semearTiss();
    const actor3: Actor = {
      kind: 'user', tenantId: s3.tenantId, userId: s3.userId,
      clinicId: s3.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar a guia original
    const projecao = await withTenantTx(actor3, async (tx) => {
      return projectGuiaConsulta(tx, s3.encounterId, s3.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia projetada
    const guia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s3.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote com status 'enviado' e associar a guia.
    // Usa admin porque precisa de acesso irrestrito para montar cenario.
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'enviado', '4.01', 1, 25000, $4)`,
        [s3.tenantId, loteId, s3.operadoraId, s3.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s3.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar o atendimento
    const retificacao = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia ja enviada em lote',
            p_incompleto => false)`,
        [s3.encounterId, 'cc'.repeat(32), s3.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor3, async (tx) => {
      return reprojectGuiaOnAmend(tx, s3.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('pendencia_created');
      if (resultado.value.action === 'pendencia_created') {
        expect(resultado.value.guiaId).toBe(guia!.id);
        expect(resultado.value.pendenciaId).toBeDefined();
      }
    }

    // 6) Verificar que a guia original continua live=true (NAO foi marcada false)
    const guiaDepois = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaDepois?.live).toBe(true);

    // 7) Verificar que a pendencia foi criada corretamente
    const pendencia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string; encounter_version_id: string;
        tipo: string; resolved_at: string | null;
      }>(
        `SELECT guia_id, encounter_version_id, tipo, resolved_at
           FROM tiss.guia_pendencia
          WHERE guia_id = $1
            AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(pendencia).toBeDefined();
    expect(pendencia?.guia_id).toBe(guia!.id);
    expect(pendencia?.encounter_version_id).toBe(retificacao!.version_id);
    expect(pendencia?.tipo).toBe('reprojecao_pos_envio');
    expect(pendencia?.resolved_at).toBeNull();
  });

  it('retificacao com guia em lote rascunho (nao enviado) reprojeta normalmente', async () => {
    // Novo tenant
    const s4 = await semearTiss();
    const actor4: Actor = {
      kind: 'user', tenantId: s4.tenantId, userId: s4.userId,
      clinicId: s4.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar guia
    const projecao = await withTenantTx(actor4, async (tx) => {
      return projectGuiaConsulta(tx, s4.encounterId, s4.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar guia
    const guia = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote RASCUNHO (nao enviado) e associar a guia
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'rascunho', '4.01', 1, 25000, $4)`,
        [s4.tenantId, loteId, s4.operadoraId, s4.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s4.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar
    const retificacao = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia em lote rascunho — reprojeta',
            p_incompleto => false)`,
        [s4.encounterId, 'dd'.repeat(32), s4.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Handler deve REPROJETAR (lote rascunho = nao enviado)
    const resultado = await withTenantTx(actor4, async (tx) => {
      return reprojectGuiaOnAmend(tx, s4.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 6) Guia antiga marcada live=false
    const guiaAntigaDepois = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 7) Nova guia viva vinculada a nova versao
    const guiaNova = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{
        id: string; encounter_version_id: string;
      }>(
        `SELECT id, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.encounter_version_id).toBe(retificacao!.version_id);

    // 8) Nenhuma pendencia criada
    const pendencias = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.guia_pendencia
          WHERE guia_id = $1 AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows;
    });
    expect(pendencias).toHaveLength(0);
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
cd packages/tiss && pnpm vitest run src/reproject-guia.int.test.ts
# Esperado: 6 testes, 0 falhas
# - outbox ENCOUNTER_AMENDED na retificacao (2 testes)
# - reprojectGuiaOnAmend sem lote (2 testes)
# - reprojectGuiaOnAmend com lote enviado (2 testes)
```

- [ ] Rodar o typecheck completo:

```bash
pnpm typecheck
# Esperado: exit 0 — nenhum erro de tipo
```

- [ ] Rodar os invariantes:

```bash
pnpm db:invariants
# Esperado: todos passam — nenhuma ocorrencia de now()/current_date no schema tiss,
# RLS forcada em tiss.guia_pendencia, FK composta presente
```

- [ ] Commitar:

```bash
git add packages/tiss/src/reproject-guia.int.test.ts
git commit -m "test(tiss): add integration tests for reprojecao with sent batch creating pendencia"
```