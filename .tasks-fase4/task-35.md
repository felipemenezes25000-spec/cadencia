### Task 35: migration 0121 — privileges.json, fixtures e seed para iso

**Arquivos**

- Modificar `packages/db/privileges.json`
- Modificar `packages/db/test/iso/fixtures.ts`
- Modificar `packages/db/test/iso/seed.ts`

**Passos**

- [ ] Adicionar ao `packages/db/privileges.json` as entradas para as tres tabelas novas. Inserir apos a ultima entrada existente do bloco anterior (ou ao final, antes do `}` de fechamento):

```jsonc
// Adicionar estas entradas ao JSON:
  "tiss.lote_number_counter": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ]
    }
  },
  "tiss.lote": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ]
    }
  },
  "tiss.lote_guia": {
    "table": {
      "app_rw": [
        "DELETE",
        "INSERT",
        "SELECT"
      ]
    }
  }
```

- [ ] Adicionar fixtures ao `packages/db/test/iso/fixtures.ts`. Inserir ANTES da linha `export const CPF_VALIDO`:

```typescript
/** Lote TISS: um lote em cada tenant, pendente de envio. */
export const LOTE_A = '01930000-0000-7000-8000-000000000f10';
export const LOTE_B = '01930000-0000-7000-8000-000000000f11';
```

- [ ] Adicionar seed ao `packages/db/test/iso/seed.ts`. Inserir ANTES do fechamento da funcao `seedDoisTenants`, logo apos o ultimo bloco de seed existente:

```typescript
  // tiss.lote_number_counter — provisiona o contador de lote por operadora.
  // A funcao tiss.next_lote_number() auto-provisiona na primeira chamada, mas
  // o seed insere diretamente para garantir que a tabela tem linhas do tenant B.
  await admin.query(
    `INSERT INTO tiss.lote_number_counter (tenant_id, operadora_id, next_value)
     VALUES ($1, $3, 2), ($2, $4, 2)`,
    [F.TENANT_A, F.TENANT_B, F.OPERADORA_A, F.OPERADORA_B],
  );

  // tiss.lote — um lote em cada tenant, com status rascunho. Como toda tabela
  // multi-tenant, precisa de linha do tenant B, senao o teste meta ("o seed
  // realmente criou linha do tenant B em toda tabela multi-tenant") reprova e
  // o T1 passaria a toa.
  await admin.query(
    `INSERT INTO tiss.lote
       (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
        guia_count, total_value_cents, created_by) VALUES
       ($1, $3, $5, '1', 'rascunho', '3.05', 1, 25000, $7),
       ($2, $4, $6, '1', 'rascunho', '3.05', 1, 30000, $8)`,
    [F.TENANT_A, F.TENANT_B, F.LOTE_A, F.LOTE_B,
     F.OPERADORA_A, F.OPERADORA_B, F.USER_A_ANA, F.USER_B_DIEGO],
  );

  // tiss.lote_guia — vincula a guia ao lote. Como toda tabela multi-tenant,
  // precisa de linha do tenant B.
  await admin.query(
    `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
     VALUES ($1, $3, $5, 1), ($2, $4, $6, 1)`,
    [F.TENANT_A, F.TENANT_B, F.LOTE_A, F.LOTE_B,
     F.GUIA_CONSULTA_A, F.GUIA_CONSULTA_B],
  );
```

- [ ] Rodar os invariantes para confirmar que os privilegios batem:

```bash
pnpm db:invariants
```

Saida esperada: todos passam, incluindo o invariante 7 (privilegios tabela a tabela).

---