### Task 34: migration 0120 — tabela lote_guia (juncao many-to-many com ordem)

**Arquivos**

- Criar `packages/db/migrations/0120_tiss_lote_guia.sql`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0120_tiss_lote_guia.sql`:

```sql
-- 0120_tiss_lote_guia.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Juncao entre lote e guia de consulta. Cada guia aparece no maximo em UM lote
-- nao-cancelado: o indice parcial ux_guia_em_lote_ativo impede duplicacao.
-- sequencial_item define a ordem da guia dentro do lote (item no XML).
--
-- Nenhuma ocorrencia de now() ou current_date neste schema (invariante de CI).

CREATE TABLE tiss.lote_guia (
  tenant_id        uuid NOT NULL DEFAULT app.require_tenant_id(),
  lote_id          uuid NOT NULL,
  guia_id          uuid NOT NULL,
  sequencial_item  smallint NOT NULL CHECK (sequencial_item >= 1),
  PRIMARY KEY (tenant_id, lote_id, guia_id),
  UNIQUE (tenant_id, lote_id, sequencial_item),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, lote_id)
    REFERENCES tiss.lote(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id)
);
ALTER TABLE tiss.lote_guia OWNER TO app_owner;
GRANT SELECT, INSERT, DELETE ON tiss.lote_guia TO app_rw;

-- Uma guia so pode pertencer a UM lote nao-cancelado. A verificacao de status
-- do lote exige subconsulta no indice, o que nao e possivel. Em vez disso, o
-- indice parcial cobre TODOS os lote_guia; ao cancelar um lote, as linhas de
-- lote_guia sao removidas (DELETE). Isso garante unicidade no indice sem
-- precisar de trigger ou subconsulta.
--
-- ALTERNATIVA ADOTADA: indice unico incondicional na guia. A remocao das
-- linhas de lote_guia ao cancelar o lote libera a guia para ser adicionada
-- a outro lote.
CREATE UNIQUE INDEX ux_guia_em_lote_unico
  ON tiss.lote_guia (tenant_id, guia_id);

CREATE INDEX ix_lote_guia_lote
  ON tiss.lote_guia (tenant_id, lote_id);

ALTER TABLE tiss.lote_guia ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote_guia FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote_guia
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: linha terminando em `0120_tiss_lote_guia.sql`.

- [ ] Verificar que os invariantes continuam verdes:

```bash
pnpm db:invariants
```

Saida esperada: todos passam.

---