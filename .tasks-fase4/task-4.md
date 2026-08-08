### Task 4: Seed de isolamento — operadora, contrato e paciente_convenio nos dois tenants

**Arquivos**
- Modificar: `packages/db/test/iso/fixtures.ts`
- Modificar: `packages/db/test/iso/seed.ts`
- Teste: `packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts` (ja existente, descobre tabelas automaticamente)

**Passos**

- [ ] Adicionar os fixtures em `packages/db/test/iso/fixtures.ts`, antes da linha `export const REQUEST_ID`:

```typescript
/** Operadora de plano de saude: uma em cada tenant. */
export const OPERADORA_A = '01930000-0000-7000-8000-000000000f01';
export const OPERADORA_B = '01930000-0000-7000-8000-000000000f02';

/** Contrato operadora x prestador: um em cada tenant. */
export const CONTRATO_A = '01930000-0000-7000-8000-000000000f03';
export const CONTRATO_B = '01930000-0000-7000-8000-000000000f04';

/** Vinculo paciente x convenio (carteirinha): um em cada tenant. */
export const PACIENTE_CONVENIO_A = '01930000-0000-7000-8000-000000000f05';
export const PACIENTE_CONVENIO_B = '01930000-0000-7000-8000-000000000f06';
```

- [ ] Adicionar as insercoes no final da funcao `seedDoisTenants` em `packages/db/test/iso/seed.ts`, antes do `}` final:

```typescript
  // tiss.operadora nasceu na Task 1 da Fase 4: cadastro da operadora de plano de
  // saude por tenant. Como toda tabela multi-tenant, precisa de linha do tenant B,
  // senao o teste meta ("o seed realmente criou linha do tenant B em toda tabela
  // multi-tenant") reprova e o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.operadora
       (tenant_id, id, registro_ans, razao_social, nome_fantasia, cnpj, created_by) VALUES
       ($1, $3, '326305', 'Operadora Meridiano Saude Ltda', 'Meridiano Saude',
        '11ABC22233DE44', $5),
       ($2, $4, '412589', 'Cooperativa Norte Saude', 'Norte Saude',
        '55XYZ66677DE88', $6)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.contrato nasceu na Task 2 da Fase 4: vinculo operadora x prestador.
  // Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO tiss.contrato
       (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora,
        vigencia_inicio, created_by) VALUES
       ($1, $3, $5, $7, '900123', DATE '2026-01-01', $9),
       ($2, $4, $6, $8, '800456', DATE '2026-01-01', $10)`,
    [F.TENANT_A, F.TENANT_B, F.CONTRATO_A, F.CONTRATO_B,
     F.OPERADORA_A, F.OPERADORA_B,
     F.CLINIC_A_SP, F.CLINIC_B_RIO_BRANCO,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.paciente_convenio nasceu na Task 3 da Fase 4: vinculo paciente x operadora
  // (carteirinha). Como toda tabela multi-tenant, precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO tiss.paciente_convenio
       (tenant_id, id, patient_id, operadora_id, numero_carteira,
        validade, nome_plano, created_by) VALUES
       ($1, $3, $5, $7, '00998877665544', DATE '2027-12-31',
        'Meridiano Essencial', $9),
       ($2, $4, $6, $8, '11223344556677', DATE '2028-06-30',
        'Norte Basico', $10)`,
    [F.TENANT_A, F.TENANT_B, F.PACIENTE_CONVENIO_A, F.PACIENTE_CONVENIO_B,
     F.PATIENT_A_JOANA, F.PATIENT_B_MARCOS,
     F.OPERADORA_A, F.OPERADORA_B,
     F.USER_A_ANA, F.USER_B_DIEGO],
  );
```

- [ ] Rodar a suite de isolamento completa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:iso
```

Saida esperada: todos os testes passam, incluindo:
- "descobre pelo menos as cinco tabelas multi-tenant da Fase 0" (agora descobre tambem tiss.operadora, tiss.contrato, tiss.paciente_convenio)
- "o seed realmente criou linha do tenant B em toda tabela multi-tenant" (verifica que tiss.operadora, tiss.contrato e tiss.paciente_convenio tem linha do tenant B)
- "T1 — o tenant A nao le nenhuma linha do tenant B, tabela a tabela" (verifica isolamento em todas as novas tabelas)

- [ ] Commitar:

```
test(db): add tiss operadora, contrato and paciente_convenio to isolation seed
```

---