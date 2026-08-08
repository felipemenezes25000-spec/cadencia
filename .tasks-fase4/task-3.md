### Task 3: Migration 0112 — tiss.paciente_convenio (vinculo paciente x operadora)

**Arquivos**
- Criar: `packages/db/migrations/0112_tiss_paciente_convenio.sql`
- Modificar: `packages/db/privileges.json`
- Teste: suite de isolamento existente cobre automaticamente via descoberta de catalogo

**Passos**

- [ ] Criar o arquivo de migration `packages/db/migrations/0112_tiss_paciente_convenio.sql` com o conteudo completo:

```sql
-- 0112_tiss_paciente_convenio.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 Fase 4: vinculo paciente x operadora (carteirinha do convenio).
-- Um paciente pode ter mais de um convenio: cada carteirinha e uma linha.
-- numero_carteira e o campo que preenche encounter_guia_consulta.numero_carteira.
-- Nenhuma ocorrencia de now() ou current_date no schema tiss — invariante de CI.

CREATE TABLE tiss.paciente_convenio (
  tenant_id         uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                uuid NOT NULL,
  patient_id        uuid NOT NULL,
  operadora_id      uuid NOT NULL,
  numero_carteira   varchar(20) NOT NULL,
  validade          date,
  nome_plano        text COLLATE "pt-BR-x-icu",
  tipo_beneficiario char(1) NOT NULL DEFAULT 'T'
    CHECK (tipo_beneficiario IN ('T','D')),
  titular_nome      text COLLATE "pt-BR-x-icu",
  titular_carteira  varchar(20),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by        uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, numero_carteira),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, operadora_id) REFERENCES tiss.operadora(tenant_id, id),
  -- Dependente deve ter dados do titular
  CHECK (tipo_beneficiario = 'T' OR titular_nome IS NOT NULL)
);
ALTER TABLE tiss.paciente_convenio OWNER TO app_owner;

CREATE INDEX ix_pac_conv_patient
  ON tiss.paciente_convenio (tenant_id, patient_id) WHERE active;

CREATE INDEX ix_pac_conv_operadora
  ON tiss.paciente_convenio (tenant_id, operadora_id) WHERE active;

GRANT SELECT, INSERT, UPDATE ON tiss.paciente_convenio TO app_rw;
GRANT SELECT ON tiss.paciente_convenio TO jobs;

ALTER TABLE tiss.paciente_convenio ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.paciente_convenio FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.paciente_convenio AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_read ON tiss.paciente_convenio AS PERMISSIVE FOR SELECT TO jobs
  USING (true);
```

- [ ] Rodar a migration no banco de desenvolvimento:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: migration 0112 aplicada com sucesso.

- [ ] Adicionar os GRANTs ao `packages/db/privileges.json`. Acrescentar a entrada `"tiss.paciente_convenio"` apos `"tiss.contrato"`:

```jsonc
  "tiss.paciente_convenio": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "jobs": [
        "SELECT"
      ]
    }
  }
```

- [ ] Rodar os invariantes para confirmar que a tabela esta em conformidade:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:inv
```

Saida esperada: todos os invariantes passam.

- [ ] Commitar:

```
feat(db): add tiss.paciente_convenio table (migration 0112)
```

---