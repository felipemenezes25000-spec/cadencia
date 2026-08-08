### Task 16: Seed — linhas de tiss.encounter_guia_consulta, guia_ajuste, guia_counter nos dois tenants

**Arquivos**

- Modificar: `packages/db/test/iso/fixtures.ts`
- Modificar: `packages/db/test/iso/seed.ts`

**Passos**

- [ ] Adicionar os novos identificadores fixos em `packages/db/test/iso/fixtures.ts`. Seguir o padrao UUIDv7 com prefixo `01930000-0000-7000-8000-` e sufixos unicos que ainda nao foram usados (ultimo usado: `f5`).

```typescript
// Adicionar ao final de packages/db/test/iso/fixtures.ts, ANTES do ultimo export:

/** Operadora cadastrada no tenant: uma em cada tenant (criada pelo bloco 01). */
export const OPERADORA_A = '01930000-0000-7000-8000-000000000f01';
export const OPERADORA_B = '01930000-0000-7000-8000-000000000f02';

/** Guia de consulta TISS: uma em cada tenant. */
export const GUIA_CONSULTA_A = '01930000-0000-7000-8000-0000000000f8';
export const GUIA_CONSULTA_B = '01930000-0000-7000-8000-0000000000f9';

/** Ajuste de faturamento: um em cada tenant. */
export const GUIA_AJUSTE_A = '01930000-0000-7000-8000-0000000000fa';
export const GUIA_AJUSTE_B = '01930000-0000-7000-8000-0000000000fb';
```

- [ ] Adicionar as linhas de seed em `packages/db/test/iso/seed.ts`, ao final da funcao `seedDoisTenants`, antes do fechamento da funcao. A operadora precisa existir antes da guia; como o bloco anterior (02) cria `tiss.operadora`, o seed insere direto como superusuario. O seed tambem provisiona o guia_counter para que o T1 e a impressao digital tenham o que comparar.

```typescript
  // tiss.operadora nasceu na Fase 4 (bloco 01, migration 0110): cadastro da
  // operadora de saude. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senao o teste meta ("o seed realmente criou linha do tenant B em
  // toda tabela multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.operadora (tenant_id, id, registro_ans, razao_social, cnpj, active)
     VALUES
       ($1, $3, '326305', 'Operadora Meridiano Saude', '98ABC765432109', true),
       ($2, $4, '412309', 'Operadora Boreal Saude',    '12XYZ345678901', true)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B],
  );

  // tiss.encounter_guia_consulta nasceu na Fase 4 (bloco 03, migration 0114):
  // guia de consulta TISS como projecao do atendimento. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senao o teste meta reprova e o
  // T1 passaria a toa. A insercao vai como superusuario.
  //
  // Os campos do prestador (cnes, conselho, numero, uf, cbos) vem do
  // PROFISSIONAL e da CLINICA do atendimento, nunca repetidos como literal.
  // data_atendimento vem de e.occurred_date. numero_guia_prestador usa um
  // literal porque o seed nao passa pela funcao de contador.
  await admin.query(
    `INSERT INTO tiss.encounter_guia_consulta
       (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
        registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
        codigo_prestador_na_operadora, cnes, conselho_profissional,
        numero_conselho, uf_conselho, cbos, indicacao_acidente,
        regime_atendimento, tipo_consulta, data_atendimento,
        codigo_tabela, codigo_procedimento, valor_procedimento,
        created_by)
     SELECT $1::uuid, $3::uuid, e.id, $5::uuid, $7::uuid,
            '326305', '1', '00998877665544', false,
            '900123', c.cnes, p.conselho_profissional, p.numero_conselho,
            p.uf_conselho, p.cbos, '9', '01', '1', e.occurred_date,
            '22', '10101012', 250.00, $9::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $11::uuid
     UNION ALL
     SELECT $2::uuid, $4::uuid, e.id, $6::uuid, $8::uuid,
            '412309', '1', '00112233445566', false,
            '800456', c.cnes, p.conselho_profissional, p.numero_conselho,
            p.uf_conselho, p.cbos, '9', '01', '2', e.occurred_date,
            '22', '10101012', 300.00, $10::uuid
       FROM clin.encounter e
       JOIN app.clinic c       ON (c.tenant_id, c.id) = (e.tenant_id, e.clinic_id)
       JOIN app.professional p ON (p.tenant_id, p.id) = (e.tenant_id, e.professional_id)
      WHERE e.id = $12::uuid`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.VERSION_A_JOANA_ORIGINAL, F.VERSION_B_MARCOS_ORIGINAL,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO,
     F.ENCOUNTER_A_JOANA, F.ENCOUNTER_B_MARCOS],
  );

  // tiss.guia_ajuste nasceu na Fase 4 (bloco 03, migration 0115): ajuste de
  // faturamento append-only. Como toda tabela multi-tenant, precisa de linha do
  // tenant B, senao o teste meta reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.guia_ajuste
       (tenant_id, id, guia_id, campo_alterado, valor_anterior, valor_novo,
        motivo, created_by)
     VALUES
       ($1, $3, $5, 'codigo_procedimento', '10101012', '10101039',
        'Operadora usa tabela propria', $7),
       ($2, $4, $6, 'valor_procedimento', '300.00', '280.00',
        'Reajuste contratual vigente', $8)`,
    [F.TENANT_A, F.TENANT_B,
     F.GUIA_AJUSTE_A, F.GUIA_AJUSTE_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.guia_counter nasceu na Fase 4 (bloco 03, migration 0116): contador de
  // numero_guia_prestador por tenant. O seed provisiona com next_value = 2
  // porque a guia do seed consumiu o numero 1.
  await admin.query(
    `INSERT INTO tiss.guia_counter (tenant_id, next_value) VALUES
       ($1, 2),
       ($2, 2)`,
    [F.TENANT_A, F.TENANT_B],
  );
```

- [ ] Rodar os testes de isolamento para confirmar que o seed funciona:

```bash
pnpm test:iso
# Esperado: todos os testes existentes continuam passando. A impressao digital
# do tenant B agora inclui as tres tabelas novas do schema tiss.
```

---