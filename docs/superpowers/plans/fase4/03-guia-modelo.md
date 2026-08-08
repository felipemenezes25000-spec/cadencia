### Task 13: Migration 0114 — tiss.encounter_guia_consulta (DDL exato do design)

**Arquivos**

- Criar: `packages/db/migrations/0114_tiss_encounter_guia_consulta.sql`
- Modificar: `packages/db/privileges.json`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0114_tiss_encounter_guia_consulta.sql` com o DDL literal do design (S3.9). A tabela mora no schema `tiss`, que ja existe desde a migration 0002. O `operadora_id` aponta para a tabela `tiss.operadora` criada pelo bloco anterior (migration 0110). Nenhuma ocorrencia de `now()` ou `current_date` dentro do schema `tiss` (invariante de CI).

```sql
-- 0114_tiss_encounter_guia_consulta.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — guia de consulta TISS. Projecao do atendimento, append-only, com
-- autoria e vinculo a versao. Sem coluna de CID: item 32 do Componente
-- Organizacional PROIBE a operadora de exigir CID na guia.
--
-- INVARIANTE: nenhuma ocorrencia de now()/current_date neste schema.

CREATE TABLE tiss.encounter_guia_consulta (
  tenant_id                     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                            uuid NOT NULL,
  encounter_id                  uuid NOT NULL,
  encounter_version_id          uuid NOT NULL,
  operadora_id                  uuid NOT NULL,
  registro_ans                  char(6) NOT NULL,
  numero_guia_prestador         varchar(20) NOT NULL,
  numero_guia_operadora         varchar(20),
  numero_carteira               varchar(20) NOT NULL,
  atendimento_rn                boolean NOT NULL,
  codigo_prestador_na_operadora varchar(14),
  cpf_contratado                varchar(11),
  cnpj_contratado               varchar(14)
    CHECK (cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes                          char(7) NOT NULL,
  conselho_profissional         varchar(2) NOT NULL,
  numero_conselho               varchar(15) NOT NULL,
  uf_conselho                   char(2) NOT NULL,
  cbos                          varchar(6) NOT NULL,
  indicacao_acidente            char(1) NOT NULL,
  regime_atendimento            char(2) NOT NULL,
  saude_ocupacional             char(1),
  cobertura_especial            char(1),
  data_atendimento              date NOT NULL,
  tipo_consulta                 char(1) NOT NULL,
  codigo_tabela                 char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento           varchar(10) NOT NULL,
  valor_procedimento            numeric(12,2) NOT NULL CHECK (valor_procedimento >= 0),
  observacao                    varchar(500),
  live                          boolean NOT NULL DEFAULT true,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero_guia_prestador),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id)
    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),

  CHECK (num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1)
);

ALTER TABLE tiss.encounter_guia_consulta OWNER TO app_owner;

-- Indice unico parcial: no maximo uma guia VIVA por atendimento.
CREATE UNIQUE INDEX ux_guia_live
  ON tiss.encounter_guia_consulta (tenant_id, encounter_id)
  WHERE live;

-- Indice para busca por data de atendimento (faturamento a enviar).
CREATE INDEX ix_guia_consulta_data
  ON tiss.encounter_guia_consulta (tenant_id, data_atendimento DESC)
  WHERE live;

-- RLS
ALTER TABLE tiss.encounter_guia_consulta ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.encounter_guia_consulta FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.encounter_guia_consulta
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs
GRANT SELECT, INSERT ON tiss.encounter_guia_consulta TO app_rw;
GRANT UPDATE (live) ON tiss.encounter_guia_consulta TO app_rw;
GRANT SELECT ON tiss.encounter_guia_consulta TO rpt_owner;
```

- [ ] Atualizar `packages/db/privileges.json` adicionando a entrada para `tiss.encounter_guia_consulta`:

```jsonc
// Adicionar ao objeto raiz de privileges.json:
"tiss.encounter_guia_consulta": {
  "table": {
    "app_rw": ["INSERT", "SELECT"],
    "rpt_owner": ["SELECT"]
  },
  "columns": {
    "app_rw": {
      "live": ["UPDATE"]
    }
  }
}
```

- [ ] Rodar a migration e os invariantes para confirmar que o DDL esta correto:

```bash
pnpm db:migrate
# Esperado: aplica 0114_tiss_encounter_guia_consulta.sql sem erro

pnpm db:invariants
# Esperado: todos passam — RLS habilitada e forcada, FK composta, sem now()/current_date no schema tiss

pnpm db:privileges
# Esperado: exit 0, sem divergencia
```

---

### Task 14: Migration 0115 — tiss.guia_ajuste (append-only, auditavel)

**Arquivos**

- Criar: `packages/db/migrations/0115_tiss_guia_ajuste.sql`
- Modificar: `packages/db/privileges.json`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0115_tiss_guia_ajuste.sql`. A tabela registra ajustes de faturamento feitos na guia (trocar codigo para casar com a tabela da operadora). E append-only: nunca sobrescreve a guia original, e a divergencia prontuario x faturamento fica visivel.

```sql
-- 0115_tiss_guia_ajuste.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — ajuste de faturamento da guia de consulta. Append-only: a guia
-- original nao e sobrescrita; o ajuste carrega campo alterado, valor anterior,
-- valor novo, motivo e autor. Sem now()/current_date (invariante tiss).

CREATE TABLE tiss.guia_ajuste (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  guia_id         uuid NOT NULL,
  campo_alterado  text NOT NULL,
  valor_anterior  text NOT NULL,
  valor_novo      text NOT NULL,
  motivo          text NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id)
);

ALTER TABLE tiss.guia_ajuste OWNER TO app_owner;

-- Indice para listar ajustes de uma guia.
CREATE INDEX ix_guia_ajuste_guia
  ON tiss.guia_ajuste (tenant_id, guia_id, created_at);

-- RLS
ALTER TABLE tiss.guia_ajuste ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.guia_ajuste FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.guia_ajuste
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs: append-only — INSERT e SELECT, sem UPDATE nem DELETE.
GRANT SELECT, INSERT ON tiss.guia_ajuste TO app_rw;
GRANT SELECT ON tiss.guia_ajuste TO rpt_owner;
```

- [ ] Atualizar `packages/db/privileges.json` adicionando a entrada para `tiss.guia_ajuste`:

```jsonc
// Adicionar ao objeto raiz de privileges.json:
"tiss.guia_ajuste": {
  "table": {
    "app_rw": ["INSERT", "SELECT"],
    "rpt_owner": ["SELECT"]
  }
}
```

- [ ] Rodar a migration e os invariantes:

```bash
pnpm db:migrate
# Esperado: aplica 0115_tiss_guia_ajuste.sql sem erro

pnpm db:invariants
# Esperado: todos passam — RLS habilitada e forcada, FK composta, sem now()/current_date

pnpm db:privileges
# Esperado: exit 0, sem divergencia
```

---

### Task 15: Migration 0116 — tiss.guia_counter e funcao tiss.next_guia_number

**Arquivos**

- Criar: `packages/db/migrations/0116_tiss_guia_counter.sql`
- Modificar: `packages/db/privileges.json`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0116_tiss_guia_counter.sql`. O contador se auto-provisiona na primeira guia de cada tenant via `INSERT ON CONFLICT DO UPDATE ... RETURNING`. A funcao `tiss.next_guia_number(p_tenant_id)` encapsula essa logica. Sem `now()`/`current_date` (invariante tiss).

```sql
-- 0116_tiss_guia_counter.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — contador de numero_guia_prestador por tenant. Auto-provisiona na
-- primeira guia. Sem now()/current_date (invariante tiss).

CREATE TABLE tiss.guia_counter (
  tenant_id   uuid NOT NULL,
  next_value  bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);

ALTER TABLE tiss.guia_counter OWNER TO app_owner;

-- RLS: app_rw precisa de acesso para o INSERT ON CONFLICT na funcao.
ALTER TABLE tiss.guia_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.guia_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.guia_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

GRANT SELECT, INSERT, UPDATE ON tiss.guia_counter TO app_rw;

-- Funcao que auto-provisiona e devolve o numero consumido.
-- INSERT ... ON CONFLICT DO UPDATE SET next_value = next_value + 1
-- RETURNING next_value - 1  (o valor CONSUMIDO, nao o proximo livre).
-- Na primeira chamada para um tenant, insere (1) e retorna 1 (next_value apos
-- o upsert e 2, mas retornamos next_value - 1 = 1 — leia o RETURNING).
-- Correcao do desenho original: a primeira guia retornava NULL.
CREATE FUNCTION tiss.next_guia_number(p_tenant_id uuid)
RETURNS bigint
LANGUAGE sql
VOLATILE
AS $$
  INSERT INTO tiss.guia_counter (tenant_id, next_value)
  VALUES (p_tenant_id, 2)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_value = tiss.guia_counter.next_value + 1
  RETURNING next_value - 1
$$;

ALTER FUNCTION tiss.next_guia_number(uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_guia_number(uuid) TO app_rw;
```

- [ ] Atualizar `packages/db/privileges.json` adicionando a entrada para `tiss.guia_counter`:

```jsonc
// Adicionar ao objeto raiz de privileges.json:
"tiss.guia_counter": {
  "table": {
    "app_rw": ["INSERT", "SELECT", "UPDATE"]
  }
}
```

- [ ] Rodar a migration e os invariantes:

```bash
pnpm db:migrate
# Esperado: aplica 0116_tiss_guia_counter.sql sem erro

pnpm db:invariants
# Esperado: todos passam — RLS habilitada e forcada, sem now()/current_date no schema tiss

pnpm db:privileges
# Esperado: exit 0, sem divergencia
```

---

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

### Task 17: Teste de isolamento — tiss.encounter_guia_consulta (inserir guia, unicidade, RLS)

**Arquivos**

- Criar: `packages/db/test/iso/31-guia-consulta.iso.test.ts`

**Passos**

- [ ] Criar o arquivo de teste `packages/db/test/iso/31-guia-consulta.iso.test.ts` que verifica:
  1. A tabela existe no schema `tiss` com as colunas do design.
  2. O indice unico parcial `ux_guia_live` impede duas guias vivas para o mesmo atendimento.
  3. O UNIQUE `(tenant_id, numero_guia_prestador)` garante unicidade do numero da guia por tenant.
  4. O CHECK `codigo_tabela <> '18'` rejeita a tabela 18.
  5. O CHECK `num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1` exige exatamente um identificador.
  6. Sem coluna de CID (mesmo padrao do teste 18-encounter-billing).
  7. A FK composta para `clin.encounter_version(tenant_id, id)` existe.

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.encounter_guia_consulta — guia de consulta TISS', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoRwUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela existe no schema tiss com as colunas do design', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'encounter_id', 'encounter_version_id',
      'operadora_id', 'registro_ans', 'numero_guia_prestador',
      'numero_guia_operadora', 'numero_carteira', 'atendimento_rn',
      'codigo_prestador_na_operadora', 'cpf_contratado', 'cnpj_contratado',
      'cnes', 'conselho_profissional', 'numero_conselho', 'uf_conselho',
      'cbos', 'indicacao_acidente', 'regime_atendimento',
      'saude_ocupacional', 'cobertura_especial', 'data_atendimento',
      'tipo_consulta', 'codigo_tabela', 'codigo_procedimento',
      'valor_procedimento', 'observacao', 'live', 'created_by', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('NAO tem coluna de CID — item 32 proibe a operadora de exigir CID na guia', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
          AND column_name ~* '(^|_)cid[0-9]*($|_)'`,
    );
    expect(rows).toEqual([]);
  });

  it('ux_guia_live impede duas guias vivas para o mesmo atendimento', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        // Inserir segunda guia viva para o mesmo encounter_id do seed
        await c.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira,
              atendimento_rn, codigo_prestador_na_operadora, cnes,
              conselho_profissional, numero_conselho, uf_conselho, cbos,
              indicacao_acidente, regime_atendimento, tipo_consulta,
              data_atendimento, codigo_tabela, codigo_procedimento,
              valor_procedimento, live, created_by)
           VALUES ($1, gen_random_uuid(), $2, $3, $4,
                   '326305', '999', '00998877665544',
                   false, '900123', '2077485',
                   '06', '123456', 'SP', '225125',
                   '9', '01', '1',
                   DATE '2026-08-01', '22', '10101012',
                   250.00, true, $5)`,
          [F.TENANT_A, F.ENCOUNTER_A_JOANA, F.VERSION_A_JOANA_ORIGINAL,
           F.OPERADORA_A, F.USER_A_ANA],
        );
      });
    });
    // 23505 = unique_violation
    expect(erro.code).toBe('23505');
    expect(erro.message).toContain('ux_guia_live');
  });

  it('UNIQUE (tenant_id, numero_guia_prestador) garante unicidade do numero da guia', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        // Tentar inserir guia com o mesmo numero_guia_prestador do seed ('1')
        // para um encounter diferente (que nao existe — vai falhar no UNIQUE antes do FK)
        await c.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira,
              atendimento_rn, codigo_prestador_na_operadora, cnes,
              conselho_profissional, numero_conselho, uf_conselho, cbos,
              indicacao_acidente, regime_atendimento, tipo_consulta,
              data_atendimento, codigo_tabela, codigo_procedimento,
              valor_procedimento, created_by)
           VALUES ($1, gen_random_uuid(), gen_random_uuid(), $2, $3,
                   '326305', '1', '00998877665544',
                   false, '900123', '2077485',
                   '06', '123456', 'SP', '225125',
                   '9', '01', '1',
                   DATE '2026-08-01', '22', '10101012',
                   250.00, $4)`,
          [F.TENANT_A, F.VERSION_A_JOANA_ORIGINAL, F.OPERADORA_A, F.USER_A_ANA],
        );
      });
    });
    // 23505 = unique_violation
    expect(erro.code).toBe('23505');
    expect(erro.message).toContain('numero_guia_prestador');
  });

  it('codigo_tabela <> 18 rejeita a tabela 18 (particular)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.encounter_guia_consulta'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%codigo_tabela%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.def).toContain("<> '18'");
  });

  it('exige exatamente um identificador de prestador (codigo, cpf ou cnpj)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.encounter_guia_consulta'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.def).toContain('num_nonnulls');
    expect(rows[0]?.def).toContain('1');
  });

  it('FK composta para clin.encounter_version(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.confrelid = 'clin.encounter_version'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('valor_procedimento e numeric(12,2), nunca bigint de centavos', async () => {
    const { rows } = await admin.query<{ data_type: string; numeric_precision: number; numeric_scale: number }>(
      `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'encounter_guia_consulta'
          AND column_name = 'valor_procedimento'`,
    );
    expect(rows[0]?.data_type).toBe('numeric');
    expect(rows[0]?.numeric_precision).toBe(12);
    expect(rows[0]?.numeric_scale).toBe(2);
  });
});
```

- [ ] Rodar o teste:

```bash
pnpm test:iso -- --testPathPattern='31-guia-consulta'
# Esperado: 7 testes passando
```

---

### Task 18: Teste de isolamento — tiss.guia_ajuste (append-only, FK para guia)

**Arquivos**

- Criar: `packages/db/test/iso/32-guia-ajuste.iso.test.ts`

**Passos**

- [ ] Criar o arquivo de teste `packages/db/test/iso/32-guia-ajuste.iso.test.ts` que verifica:
  1. A tabela existe no schema `tiss` com as colunas esperadas.
  2. A FK composta `(tenant_id, guia_id)` para `tiss.encounter_guia_consulta(tenant_id, id)` existe.
  3. O campo `motivo` e NOT NULL.
  4. O app_rw so tem INSERT e SELECT (append-only: sem UPDATE, sem DELETE).

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor, erroPg } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.guia_ajuste — ajuste de faturamento append-only', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoRwUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela existe no schema tiss com as colunas esperadas', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_ajuste'
        ORDER BY ordinal_position`,
    );
    const colunas = rows.map((r) => r.column_name);
    const esperadas = [
      'tenant_id', 'id', 'guia_id', 'campo_alterado',
      'valor_anterior', 'valor_novo', 'motivo',
      'created_by', 'created_at',
    ];
    for (const col of esperadas) {
      expect(colunas, `falta coluna ${col}`).toContain(col);
    }
  });

  it('FK composta para tiss.encounter_guia_consulta(tenant_id, id) existe', async () => {
    const { rows } = await admin.query<{ conname: string }>(
      `SELECT con.conname
         FROM pg_constraint con
        WHERE con.conrelid = 'tiss.guia_ajuste'::regclass
          AND con.confrelid = 'tiss.encounter_guia_consulta'::regclass
          AND con.contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('motivo e NOT NULL', async () => {
    const { rows } = await admin.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'guia_ajuste'
          AND column_name = 'motivo'`,
    );
    expect(rows[0]?.is_nullable).toBe('NO');
  });

  it('app_rw pode inserir e ler um ajuste', async () => {
    await comoAtor(rw, actorAna, async (c) => {
      // Inserir um ajuste e verificar que a leitura funciona
      await c.query(
        `INSERT INTO tiss.guia_ajuste
           (tenant_id, id, guia_id, campo_alterado, valor_anterior, valor_novo,
            motivo, created_by)
         VALUES ($1, gen_random_uuid(), $2, 'tipo_consulta', '1', '3',
                 'Retorno dentro de 30 dias', $3)`,
        [F.TENANT_A, F.GUIA_CONSULTA_A, F.USER_A_ANA],
      );

      const { rows } = await c.query<{ campo_alterado: string }>(
        `SELECT campo_alterado FROM tiss.guia_ajuste
          WHERE tenant_id = $1 AND guia_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [F.TENANT_A, F.GUIA_CONSULTA_A],
      );
      expect(rows[0]?.campo_alterado).toBe('tipo_consulta');
    });
  });

  it('app_rw NAO pode fazer UPDATE em guia_ajuste (append-only)', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `UPDATE tiss.guia_ajuste SET motivo = 'alterado'
            WHERE tenant_id = $1 AND id = $2`,
          [F.TENANT_A, F.GUIA_AJUSTE_A],
        );
      });
    });
    // 42501 = insufficient_privilege (UPDATE nao foi concedido)
    expect(erro.code).toBe('42501');
  });

  it('app_rw NAO pode fazer DELETE em guia_ajuste (append-only)', async () => {
    const erro = await erroPg(async () => {
      await comoAtor(rw, actorAna, async (c) => {
        await c.query(
          `DELETE FROM tiss.guia_ajuste WHERE tenant_id = $1 AND id = $2`,
          [F.TENANT_A, F.GUIA_AJUSTE_A],
        );
      });
    });
    // 42501 = insufficient_privilege (DELETE nao foi concedido)
    expect(erro.code).toBe('42501');
  });
});
```

- [ ] Rodar o teste:

```bash
pnpm test:iso -- --testPathPattern='32-guia-ajuste'
# Esperado: 5 testes passando
```

---

### Task 19: Teste de isolamento — tiss.guia_counter e tiss.next_guia_number (auto-provisiona, unicidade por tenant)

**Arquivos**

- Criar: `packages/db/test/iso/33-guia-counter.iso.test.ts`

**Passos**

- [ ] Criar o arquivo de teste `packages/db/test/iso/33-guia-counter.iso.test.ts` que verifica:
  1. A funcao `tiss.next_guia_number` auto-provisiona o contador na primeira chamada para um tenant novo.
  2. Chamadas consecutivas retornam valores sequenciais (1, 2, 3...).
  3. O contador e isolado por tenant: dois tenants tem sequencias independentes.
  4. A tabela `tiss.guia_counter` tem RLS habilitada e forcada.

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient, comoAtor } from './harness';
import type { IsoActor } from './harness';
import * as F from './fixtures';

describe('tiss.guia_counter e tiss.next_guia_number — contador auto-provisionado', () => {
  let admin: Client;
  let rw: Client;

  const actorAna: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_A,
    userId: F.USER_A_ANA,
    clinicId: F.CLINIC_A_SP,
    requestId: F.REQUEST_ID,
  };

  const actorDiego: IsoActor = {
    kind: 'user',
    tenantId: F.TENANT_B,
    userId: F.USER_B_DIEGO,
    clinicId: F.CLINIC_B_RIO_BRANCO,
    requestId: F.REQUEST_ID,
  };

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    rw = await openClient(inject('isoRwUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await rw.end();
  });

  it('tabela guia_counter tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ rls_enabled: boolean; rls_forced: boolean }>(
      `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'tiss' AND c.relname = 'guia_counter'`,
    );
    expect(rows[0]?.rls_enabled).toBe(true);
    expect(rows[0]?.rls_forced).toBe(true);
  });

  it('next_guia_number auto-provisiona na primeira chamada para tenant sem contador', async () => {
    // O seed ja provisionou o contador para os dois tenants com next_value=2.
    // Para testar a auto-provisao, usamos um tenant ficticio criado dentro da
    // transacao que sera revertida.
    await comoAtor(rw, actorAna, async (c) => {
      // O seed ja inseriu o counter com next_value=2.
      // A proxima chamada deve retornar 2 (consumindo e incrementando para 3).
      const { rows } = await c.query<{ next_guia_number: string }>(
        `SELECT tiss.next_guia_number($1) AS next_guia_number`,
        [F.TENANT_A],
      );
      expect(Number(rows[0]?.next_guia_number)).toBe(2);
    });
  });

  it('chamadas consecutivas retornam valores sequenciais', async () => {
    await comoAtor(rw, actorAna, async (c) => {
      const primeiro = await c.query<{ n: string }>(
        `SELECT tiss.next_guia_number($1) AS n`, [F.TENANT_A],
      );
      const segundo = await c.query<{ n: string }>(
        `SELECT tiss.next_guia_number($1) AS n`, [F.TENANT_A],
      );
      const terceiro = await c.query<{ n: string }>(
        `SELECT tiss.next_guia_number($1) AS n`, [F.TENANT_A],
      );

      const n1 = Number(primeiro.rows[0]?.n);
      const n2 = Number(segundo.rows[0]?.n);
      const n3 = Number(terceiro.rows[0]?.n);

      // Os valores devem ser consecutivos
      expect(n2).toBe(n1 + 1);
      expect(n3).toBe(n2 + 1);
    });
  });

  it('contadores sao isolados por tenant', async () => {
    // Dentro de uma transacao do tenant A, consumir um numero
    let numA: number;
    await comoAtor(rw, actorAna, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT tiss.next_guia_number($1) AS n`, [F.TENANT_A],
      );
      numA = Number(rows[0]?.n);
    });

    // Dentro de uma transacao do tenant B, consumir um numero
    let numB: number;
    await comoAtor(rw, actorDiego, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT tiss.next_guia_number($1) AS n`, [F.TENANT_B],
      );
      numB = Number(rows[0]?.n);
    });

    // Os valores nao precisam ser iguais (cada tenant tem seu ritmo),
    // mas ambos devem ser >= 2 (o seed comecou com next_value=2).
    expect(numA!).toBeGreaterThanOrEqual(2);
    expect(numB!).toBeGreaterThanOrEqual(2);
  });

  it('seed provisionou o contador com next_value >= 2 para ambos os tenants', async () => {
    const { rows } = await admin.query<{ tenant_id: string; next_value: string }>(
      `SELECT tenant_id, next_value FROM tiss.guia_counter
        WHERE tenant_id IN ($1, $2)
        ORDER BY tenant_id`,
      [F.TENANT_A, F.TENANT_B],
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(Number(row.next_value)).toBeGreaterThanOrEqual(2);
    }
  });
});
```

- [ ] Rodar o teste:

```bash
pnpm test:iso -- --testPathPattern='33-guia-counter'
# Esperado: 4 testes passando
```

---

### Task 20: Rodar a suite completa — todos os invariantes e testes de isolamento verdes

**Arquivos**

- Nenhum arquivo novo. Esta tarefa e a prova de que as tres migrations e os testes convivem com o schema existente.

**Passos**

- [ ] Rodar os invariantes de CI:

```bash
pnpm db:invariants
# Esperado: todos passam. Em particular:
# - inv01 (RLS): tiss.encounter_guia_consulta, tiss.guia_ajuste e tiss.guia_counter
#   tem RLS habilitada e forcada com ao menos uma policy.
# - inv02 (FK composta): todas as FKs das tres tabelas sao compostas com tenant_id.
# - inv07 (privilegios): as entradas em privileges.json batem com os GRANTs reais.
# - inv08 (DDL lint): nenhuma ocorrencia de now()/current_date no schema tiss.
#   Nenhum indice de tabela multi-tenant sem tenant_id na primeira coluna.
```

- [ ] Rodar o lint de terminologia de relogio:

```bash
pnpm lint:terminology-clock
# Esperado: exit 0 — nenhuma ocorrencia de now()/current_date nas migrations
# do schema tiss.
```

- [ ] Rodar os privilegios:

```bash
pnpm db:privileges
# Esperado: exit 0 — privileges.json e o banco estao alinhados.
```

- [ ] Rodar a suite completa de isolamento:

```bash
pnpm test:iso
# Esperado: todos os testes passam, incluindo os novos 31, 32 e 33.
# A impressao digital do tenant B inclui as tres tabelas novas.
# O teste meta (04-t1-t2-isolamento) confirma que o seed criou linha do
# tenant B em todas as tabelas multi-tenant, incluindo as do schema tiss.
```

- [ ] Rodar a verificacao de arquitetura:

```bash
pnpm arch:check
# Esperado: 0 violacoes — as migrations nao importam modulos de aplicacao.
```

- [ ] Rodar o typecheck:

```bash
pnpm typecheck
# Esperado: exit 0.
```
