### Task 1: Migration 0110 — tiss.operadora (cadastro da operadora de plano de saude)

**Arquivos**
- Criar: `packages/db/migrations/0110_tiss_operadora.sql`
- Modificar: `packages/db/privileges.json`
- Teste: suite de isolamento existente (`packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts`) cobre automaticamente via descoberta de catalogo

**Passos**

- [ ] Criar o arquivo de migration `packages/db/migrations/0110_tiss_operadora.sql` com o conteudo completo:

```sql
-- 0110_tiss_operadora.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 Fase 4: operadora de plano de saude por tenant.
-- Registro ANS e char(6) com CHECK de 6 digitos. CNPJ alfanumerico (IN RFB 2.229/2024).
-- Nenhuma ocorrencia de now() ou current_date no schema tiss — invariante de CI.

CREATE TABLE tiss.operadora (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  registro_ans    char(6) NOT NULL CHECK (registro_ans ~ '^[0-9]{6}$'),
  razao_social    text NOT NULL COLLATE "pt-BR-x-icu",
  nome_fantasia   text COLLATE "pt-BR-x-icu",
  cnpj            varchar(14) NOT NULL
    CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  telefone        text,
  email           text,
  portal_url      text,
  portal_login    text,
  portal_obs      text,
  tiss_version    varchar(5) NOT NULL DEFAULT '3.05',
  transport_mode  text NOT NULL DEFAULT 'arquivo'
    CHECK (transport_mode IN ('arquivo','webservice')),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by      uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, registro_ans),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);
ALTER TABLE tiss.operadora OWNER TO app_owner;

CREATE INDEX ix_operadora_nome
  ON tiss.operadora (tenant_id, razao_social COLLATE "pt-BR-x-icu")
  WHERE active;

GRANT SELECT, INSERT, UPDATE ON tiss.operadora TO app_rw;
GRANT SELECT ON tiss.operadora TO jobs;

ALTER TABLE tiss.operadora ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.operadora FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.operadora AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_read ON tiss.operadora AS PERMISSIVE FOR SELECT TO jobs
  USING (true);
```

- [ ] Rodar a migration no banco de desenvolvimento:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: migration 0110 aplicada com sucesso.

- [ ] Adicionar os GRANTs ao `packages/db/privileges.json`. Acrescentar a entrada `"tiss.operadora"` apos a ultima entrada existente (antes do `}` final):

```jsonc
  "tiss.operadora": {
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

- [ ] Rodar os invariantes para confirmar que a tabela esta em conformidade com RLS, FK composta e privileges:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm test:inv
```

Saida esperada: todos os invariantes passam (incluindo inv01-rls, inv02-fk, inv07-privileges).

- [ ] Commitar:

```
feat(db): add tiss.operadora table (migration 0110)
```

---

### Task 2: Migration 0111 — tiss.contrato (vinculo operadora x prestador)

**Arquivos**
- Criar: `packages/db/migrations/0111_tiss_contrato.sql`
- Modificar: `packages/db/privileges.json`
- Teste: suite de isolamento existente cobre automaticamente via descoberta de catalogo

**Passos**

- [ ] Criar o arquivo de migration `packages/db/migrations/0111_tiss_contrato.sql` com o conteudo completo:

```sql
-- 0111_tiss_contrato.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 Fase 4: contrato do prestador com uma operadora.
-- Cada contrato representa o vinculo de uma clinica com uma operadora: o codigo
-- do prestador na operadora, o tipo de acomodacao, abrangencia, vigencia e
-- referencia de tabela de precos acordada (que pode divergir da TUSS publica).
-- Nenhuma ocorrencia de now() ou current_date no schema tiss — invariante de CI.

CREATE TABLE tiss.contrato (
  tenant_id                     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                            uuid NOT NULL,
  operadora_id                  uuid NOT NULL,
  clinic_id                     uuid NOT NULL,
  codigo_prestador_na_operadora varchar(14) NOT NULL,
  tipo_acomodacao               char(1) NOT NULL DEFAULT '1'
    CHECK (tipo_acomodacao IN ('1','2','3')),
  abrangencia                   text NOT NULL DEFAULT 'nacional'
    CHECK (abrangencia IN ('nacional','estadual','grupo_estadual','municipal')),
  vigencia_inicio               date NOT NULL,
  vigencia_fim                  date,
  tabela_precos_ref             text,
  observacao                    text,
  active                        boolean NOT NULL DEFAULT true,
  created_at                    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  created_by                    uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, clinic_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id) REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id)    REFERENCES app.clinic(tenant_id, id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
ALTER TABLE tiss.contrato OWNER TO app_owner;

CREATE INDEX ix_contrato_operadora
  ON tiss.contrato (tenant_id, operadora_id) WHERE active;

CREATE INDEX ix_contrato_clinic
  ON tiss.contrato (tenant_id, clinic_id) WHERE active;

GRANT SELECT, INSERT, UPDATE ON tiss.contrato TO app_rw;
GRANT SELECT ON tiss.contrato TO jobs;

ALTER TABLE tiss.contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.contrato FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.contrato AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_read ON tiss.contrato AS PERMISSIVE FOR SELECT TO jobs
  USING (true);
```

- [ ] Rodar a migration no banco de desenvolvimento:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: migration 0111 aplicada com sucesso.

- [ ] Adicionar os GRANTs ao `packages/db/privileges.json`. Acrescentar a entrada `"tiss.contrato"` apos `"tiss.operadora"`:

```jsonc
  "tiss.contrato": {
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
feat(db): add tiss.contrato table (migration 0111)
```

---

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

### Task 5: CRUD de operadora no packages/tiss

**Arquivos**
- Criar: `packages/tiss/src/operadora.ts`
- Criar: `packages/tiss/src/operadora.int.test.ts`
- Modificar: `packages/tiss/src/index.ts`
- Modificar: `packages/tiss/package.json`

**Passos**

- [ ] Adicionar as dependencias no `packages/tiss/package.json`:

```json
{
  "name": "@cadencia/tiss",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/kernel": "workspace:*",
    "@cadencia/db": "workspace:*"
  },
  "devDependencies": {
    "pg": "^8.16.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] Escrever o teste que falha em `packages/tiss/src/operadora.int.test.ts`:

```typescript
// packages/tiss/src/operadora.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createOperadora, updateOperadora, deactivateOperadora, listOperadoras,
  type CreateOperadoraInput,
} from './operadora';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss Operadora', '77ABC88901DE55')`,
      [s.tenantId, `to-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss', '7777777', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createOperadora — cria operadora de convenio', () => {
  it('cria operadora com todos os campos obrigatorios', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Operadora Meridiano Saude Ltda',
      nomeFantasia: 'Meridiano Saude',
      cnpj: '11ABC22233DE44',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.registroAns).toBe('326305');
    expect(r.value.razaoSocial).toBe('Operadora Meridiano Saude Ltda');
    expect(r.value.cnpj).toBe('11ABC22233DE44');
    expect(r.value.active).toBe(true);
  });

  it('recusa registro ANS duplicado no mesmo tenant', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Outra Operadora',
      cnpj: '99XYZ00011DE22',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_duplicado');
  });

  it('recusa CNPJ com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '999999',
      razaoSocial: 'Operadora Invalida',
      cnpj: '12345678901234',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('cnpj_invalido');
  });

  it('recusa registro ANS com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: 'ABCDEF',
      razaoSocial: 'Operadora ANS Invalida',
      cnpj: '33ABC44455DE66',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_invalido');
  });
});

describe('updateOperadora — atualiza operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '111111',
        razaoSocial: 'Para Atualizar',
        cnpj: '44ABC55566DE77',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('atualiza nome fantasia e telefone', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, {
        id: operadoraId,
        nomeFantasia: 'Novo Nome Fantasia',
        telefone: '11999998888',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nomeFantasia).toBe('Novo Nome Fantasia');
    expect(r.value.telefone).toBe('11999998888');
  });

  it('retorna erro para operadora inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, { id: uuidv7(), razaoSocial: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('operadora_nao_encontrada');
  });
});

describe('deactivateOperadora — desativa operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '222222',
        razaoSocial: 'Para Desativar',
        cnpj: '55ABC66677DE88',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('desativa operadora ativa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar operadora ja desativada', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativada');
  });
});

describe('listOperadoras — lista operadoras do tenant', () => {
  it('lista somente ativas por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });

  it('lista todas incluindo desativadas', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx, false));
    const inativos = lista.filter((a) => !a.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./operadora` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/operadora.int.test.ts 2>&1 | head -30
```

Saida esperada: erro de importacao — modulo `./operadora` nao encontrado.

- [ ] Implementar `packages/tiss/src/operadora.ts`:

```typescript
// packages/tiss/src/operadora.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type OperadoraFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'registro_ans_duplicado' }
  | { kind: 'registro_ans_invalido' }
  | { kind: 'cnpj_invalido' }
  | { kind: 'ja_desativada' };

export interface CreateOperadoraInput {
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string;
  readonly cnpj: string;
  readonly telefone?: string;
  readonly email?: string;
  readonly portalUrl?: string;
  readonly portalLogin?: string;
  readonly portalObs?: string;
}

export interface OperadoraRow {
  readonly id: string;
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly cnpj: string;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly portalUrl: string | null;
  readonly portalLogin: string | null;
  readonly portalObs: string | null;
  readonly active: boolean;
}

export interface UpdateOperadoraInput {
  readonly id: string;
  readonly razaoSocial?: string;
  readonly nomeFantasia?: string | null;
  readonly telefone?: string | null;
  readonly email?: string | null;
  readonly portalUrl?: string | null;
  readonly portalLogin?: string | null;
  readonly portalObs?: string | null;
}

// ---------------------------------------------------------------------------
// Validacao
// ---------------------------------------------------------------------------

const ANS_RE = /^[0-9]{6}$/;
const CNPJ_RE = /^[A-Z0-9]{12}[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createOperadora(
  tx: TxClient,
  i: CreateOperadoraInput,
  createdBy: string,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  if (!ANS_RE.test(i.registroAns)) {
    return err({ kind: 'registro_ans_invalido' });
  }
  if (!CNPJ_RE.test(i.cnpj)) {
    return err({ kind: 'cnpj_invalido' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, nome_fantasia, cnpj,
          telefone, email, portal_url, portal_login, portal_obs, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11)`,
      [id, i.registroAns, i.razaoSocial, i.nomeFantasia ?? null, i.cnpj,
       i.telefone ?? null, i.email ?? null, i.portalUrl ?? null,
       i.portalLogin ?? null, i.portalObs ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('registro_ans')) {
      return err({ kind: 'registro_ans_duplicado' });
    }
    throw e;
  }

  return ok({
    id, registroAns: i.registroAns,
    razaoSocial: i.razaoSocial,
    nomeFantasia: i.nomeFantasia ?? null,
    cnpj: i.cnpj,
    telefone: i.telefone ?? null,
    email: i.email ?? null,
    portalUrl: i.portalUrl ?? null,
    portalLogin: i.portalLogin ?? null,
    portalObs: i.portalObs ?? null,
    active: true,
  });
}

export async function updateOperadora(
  tx: TxClient,
  i: UpdateOperadoraInput,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });

  const razaoSocial = i.razaoSocial ?? existing.razao_social;
  const nomeFantasia = i.nomeFantasia !== undefined ? i.nomeFantasia : existing.nome_fantasia;
  const telefone = i.telefone !== undefined ? i.telefone : existing.telefone;
  const email = i.email !== undefined ? i.email : existing.email;
  const portalUrl = i.portalUrl !== undefined ? i.portalUrl : existing.portal_url;
  const portalLogin = i.portalLogin !== undefined ? i.portalLogin : existing.portal_login;
  const portalObs = i.portalObs !== undefined ? i.portalObs : existing.portal_obs;

  await tx.query(
    `UPDATE tiss.operadora
        SET razao_social = $2, nome_fantasia = $3,
            telefone = $4, email = $5, portal_url = $6,
            portal_login = $7, portal_obs = $8
      WHERE id = $1`,
    [i.id, razaoSocial, nomeFantasia, telefone, email,
     portalUrl, portalLogin, portalObs]);

  return ok({
    id: existing.id, registroAns: existing.registro_ans,
    razaoSocial, nomeFantasia, cnpj: existing.cnpj,
    telefone, email, portalUrl, portalLogin, portalObs,
    active: existing.active,
  });
}

export async function deactivateOperadora(
  tx: TxClient,
  operadoraId: string,
): Promise<Result<{ id: string }, OperadoraFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.operadora WHERE id = $1`, [operadoraId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });
  if (!existing.active) return err({ kind: 'ja_desativada' });

  await tx.query(
    `UPDATE tiss.operadora SET active = false WHERE id = $1`,
    [operadoraId]);

  return ok({ id: operadoraId });
}

export async function listOperadoras(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<OperadoraRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora
      WHERE 1=1 ${whereActive}
      ORDER BY razao_social COLLATE "pt-BR-x-icu"`);
  return rows.map((r) => ({
    id: r.id, registroAns: r.registro_ans,
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia,
    cnpj: r.cnpj,
    telefone: r.telefone, email: r.email,
    portalUrl: r.portal_url, portalLogin: r.portal_login,
    portalObs: r.portal_obs,
    active: r.active,
  }));
}
```

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar o modulo:

```typescript
export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';
```

- [ ] Rodar o teste e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/operadora.int.test.ts
```

Saida esperada: todos os testes de operadora passam.

- [ ] Commitar:

```
feat(tiss): add operadora CRUD with integration tests
```

---

### Task 6: CRUD de contrato e paciente_convenio no packages/tiss

**Arquivos**
- Criar: `packages/tiss/src/contrato.ts`
- Criar: `packages/tiss/src/contrato.int.test.ts`
- Criar: `packages/tiss/src/paciente-convenio.ts`
- Criar: `packages/tiss/src/paciente-convenio.int.test.ts`
- Criar: `packages/tiss/src/test-support.ts`
- Modificar: `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar o helper de seed em `packages/tiss/src/test-support.ts`:

```typescript
// packages/tiss/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeTiss {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearTiss(): Promise<SementeTiss> {
  const s: SementeTiss = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss Contrato', '66ABC77801DE99')`,
      [s.tenantId, `tc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss Contrato', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss Contrato')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '555555', 'Operadora Seed', '88ABC99900DE11', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
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
```

- [ ] Escrever o teste que falha em `packages/tiss/src/contrato.int.test.ts`:

```typescript
// packages/tiss/src/contrato.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearTiss, type SementeTiss } from './test-support';
import {
  createContrato, updateContrato, deactivateContrato, listContratos,
  type CreateContratoInput,
} from './contrato';

let s: SementeTiss;
let actor: Actor;

beforeAll(async () => {
  s = await semearTiss();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createContrato — cria contrato operadora x prestador', () => {
  it('cria contrato com todos os campos', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '900123',
      vigenciaInicio: '2026-01-01',
      tabelaPrecosRef: 'TUSS 2026.01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.codigoPrestadorNaOperadora).toBe('900123');
    expect(r.value.vigenciaInicio).toBe('2026-01-01');
    expect(r.value.active).toBe(true);
  });

  it('recusa contrato duplicado para mesma operadora e clinica', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '900999',
      vigenciaInicio: '2026-06-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('contrato_duplicado');
  });

  it('recusa contrato com operadora inexistente', async () => {
    const input: CreateContratoInput = {
      operadoraId: uuidv7(),
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '800456',
      vigenciaInicio: '2026-01-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('operadora_nao_encontrada');
  });

  it('recusa vigencia_fim anterior a vigencia_inicio', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '700789',
      vigenciaInicio: '2026-06-01',
      vigenciaFim: '2026-01-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('vigencia_invalida');
  });
});

describe('updateContrato — atualiza contrato', () => {
  let contratoId = '';

  beforeAll(async () => {
    // Criar nova operadora para ter contrato unico
    const opId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '666666', 'Op Para Contrato Update', '22ABC33344DE55', $2)`,
        [opId, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, {
        operadoraId: opId,
        clinicId: s.clinicId,
        codigoPrestadorNaOperadora: '600111',
        vigenciaInicio: '2026-01-01',
      }, s.userId));
    if (r.ok) contratoId = r.value.id;
  });

  it('atualiza tabela de precos e observacao', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateContrato(tx, {
        id: contratoId,
        tabelaPrecosRef: 'TUSS 2026.07',
        observacao: 'Tabela negociada com desconto',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tabelaPrecosRef).toBe('TUSS 2026.07');
    expect(r.value.observacao).toBe('Tabela negociada com desconto');
  });

  it('retorna erro para contrato inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateContrato(tx, { id: uuidv7(), observacao: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('contrato_nao_encontrado');
  });
});

describe('deactivateContrato — desativa contrato', () => {
  let contratoId = '';

  beforeAll(async () => {
    const opId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '777777', 'Op Para Contrato Deactivate', '33ABC44455DE66', $2)`,
        [opId, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, {
        operadoraId: opId,
        clinicId: s.clinicId,
        codigoPrestadorNaOperadora: '500222',
        vigenciaInicio: '2026-01-01',
      }, s.userId));
    if (r.ok) contratoId = r.value.id;
  });

  it('desativa contrato ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateContrato(tx, contratoId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar contrato ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateContrato(tx, contratoId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listContratos — lista contratos do tenant', () => {
  it('lista somente ativos por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listContratos(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./contrato` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/contrato.int.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./contrato` nao encontrado.

- [ ] Implementar `packages/tiss/src/contrato.ts`:

```typescript
// packages/tiss/src/contrato.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ContratoFailure =
  | { kind: 'contrato_nao_encontrado' }
  | { kind: 'contrato_duplicado' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'clinica_nao_encontrada' }
  | { kind: 'vigencia_invalida' }
  | { kind: 'ja_desativado' };

export interface CreateContratoInput {
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string;
  readonly tabelaPrecosRef?: string;
  readonly observacao?: string;
}

export interface ContratoRow {
  readonly id: string;
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao: string;
  readonly abrangencia: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly tabelaPrecosRef: string | null;
  readonly observacao: string | null;
  readonly active: boolean;
}

export interface UpdateContratoInput {
  readonly id: string;
  readonly codigoPrestadorNaOperadora?: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaFim?: string | null;
  readonly tabelaPrecosRef?: string | null;
  readonly observacao?: string | null;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createContrato(
  tx: TxClient,
  i: CreateContratoInput,
  createdBy: string,
): Promise<Result<ContratoRow, ContratoFailure>> {
  if (i.vigenciaFim !== undefined && i.vigenciaFim < i.vigenciaInicio) {
    return err({ kind: 'vigencia_invalida' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora,
          tipo_acomodacao, abrangencia, vigencia_inicio, vigencia_fim,
          tabela_precos_ref, observacao, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5, $6, $7::date, $8::date,
               $9, $10, $11)`,
      [id, i.operadoraId, i.clinicId, i.codigoPrestadorNaOperadora,
       i.tipoAcomodacao ?? '1', i.abrangencia ?? 'nacional',
       i.vigenciaInicio, i.vigenciaFim ?? null,
       i.tabelaPrecosRef ?? null, i.observacao ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('operadora_id')) {
      return err({ kind: 'contrato_duplicado' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('clinic')) {
        return err({ kind: 'clinica_nao_encontrada' });
      }
    }
    throw e;
  }

  return ok({
    id,
    operadoraId: i.operadoraId,
    clinicId: i.clinicId,
    codigoPrestadorNaOperadora: i.codigoPrestadorNaOperadora,
    tipoAcomodacao: i.tipoAcomodacao ?? '1',
    abrangencia: i.abrangencia ?? 'nacional',
    vigenciaInicio: i.vigenciaInicio,
    vigenciaFim: i.vigenciaFim ?? null,
    tabelaPrecosRef: i.tabelaPrecosRef ?? null,
    observacao: i.observacao ?? null,
    active: true,
  });
}

export async function updateContrato(
  tx: TxClient,
  i: UpdateContratoInput,
): Promise<Result<ContratoRow, ContratoFailure>> {
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT id::text, operadora_id::text, clinic_id::text,
            codigo_prestador_na_operadora, tipo_acomodacao, abrangencia,
            vigencia_inicio::text, vigencia_fim::text,
            tabela_precos_ref, observacao, active
       FROM tiss.contrato WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });

  const codigoPrestadorNaOperadora = i.codigoPrestadorNaOperadora ?? existing.codigo_prestador_na_operadora;
  const tipoAcomodacao = i.tipoAcomodacao ?? existing.tipo_acomodacao;
  const abrangencia = i.abrangencia ?? existing.abrangencia;
  const vigenciaFim = i.vigenciaFim !== undefined ? i.vigenciaFim : existing.vigencia_fim;
  const tabelaPrecosRef = i.tabelaPrecosRef !== undefined ? i.tabelaPrecosRef : existing.tabela_precos_ref;
  const observacao = i.observacao !== undefined ? i.observacao : existing.observacao;

  await tx.query(
    `UPDATE tiss.contrato
        SET codigo_prestador_na_operadora = $2,
            tipo_acomodacao = $3, abrangencia = $4,
            vigencia_fim = $5::date, tabela_precos_ref = $6,
            observacao = $7
      WHERE id = $1`,
    [i.id, codigoPrestadorNaOperadora, tipoAcomodacao, abrangencia,
     vigenciaFim, tabelaPrecosRef, observacao]);

  return ok({
    id: existing.id,
    operadoraId: existing.operadora_id,
    clinicId: existing.clinic_id,
    codigoPrestadorNaOperadora,
    tipoAcomodacao,
    abrangencia,
    vigenciaInicio: existing.vigencia_inicio,
    vigenciaFim,
    tabelaPrecosRef,
    observacao,
    active: existing.active,
  });
}

export async function deactivateContrato(
  tx: TxClient,
  contratoId: string,
): Promise<Result<{ id: string }, ContratoFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.contrato WHERE id = $1`, [contratoId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.contrato SET active = false WHERE id = $1`,
    [contratoId]);

  return ok({ id: contratoId });
}

export async function listContratos(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<ContratoRow[]> {
  const whereActive = onlyActive ? 'AND c.active = true' : '';
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT c.id::text, c.operadora_id::text, c.clinic_id::text,
            c.codigo_prestador_na_operadora, c.tipo_acomodacao, c.abrangencia,
            c.vigencia_inicio::text, c.vigencia_fim::text,
            c.tabela_precos_ref, c.observacao, c.active
       FROM tiss.contrato c
      WHERE 1=1 ${whereActive}
      ORDER BY c.created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    operadoraId: r.operadora_id,
    clinicId: r.clinic_id,
    codigoPrestadorNaOperadora: r.codigo_prestador_na_operadora,
    tipoAcomodacao: r.tipo_acomodacao,
    abrangencia: r.abrangencia,
    vigenciaInicio: r.vigencia_inicio,
    vigenciaFim: r.vigencia_fim,
    tabelaPrecosRef: r.tabela_precos_ref,
    observacao: r.observacao,
    active: r.active,
  }));
}
```

- [ ] Rodar o teste de contrato e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/contrato.int.test.ts
```

Saida esperada: todos os testes de contrato passam.

- [ ] Escrever o teste que falha em `packages/tiss/src/paciente-convenio.int.test.ts`:

```typescript
// packages/tiss/src/paciente-convenio.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createPacienteConvenio, updatePacienteConvenio,
  deactivatePacienteConvenio, listPacienteConvenios,
  type CreatePacienteConvenioInput,
} from './paciente-convenio';

interface SementePC {
  tenantId: string; clinicId: string; userId: string;
  operadoraId: string; patientId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearPC(): Promise<SementePC> {
  const s: SementePC = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), patientId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss PacConv', '88ABC99012DE33')`,
      [s.tenantId, `pc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss PacConv', '8888888', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin PacConv')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '888888', 'Operadora PacConv', '99ABC00011DE22', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Convenio Teste', 'completo')`,
      [s.tenantId, s.patientId]);
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

let s: SementePC;
let actor: Actor;

beforeAll(async () => {
  s = await semearPC();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createPacienteConvenio — vincula paciente a operadora', () => {
  it('cria vinculo titular com todos os campos', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
      validade: '2027-12-31',
      nomePlano: 'Plano Essencial',
      tipoBeneficiario: 'T',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.numeroCarteira).toBe('00112233445566');
    expect(r.value.tipoBeneficiario).toBe('T');
    expect(r.value.active).toBe(true);
  });

  it('cria vinculo dependente com dados do titular', async () => {
    const patientDep = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dependente Teste', 'completo')`,
        [patientDep]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep,
      operadoraId: s.operadoraId,
      numeroCarteira: '99887766554433',
      tipoBeneficiario: 'D',
      titularNome: 'Paciente Convenio Teste',
      titularCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tipoBeneficiario).toBe('D');
    expect(r.value.titularNome).toBe('Paciente Convenio Teste');
  });

  it('recusa dependente sem nome do titular', async () => {
    const patientDep2 = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dep Sem Titular', 'completo')`,
        [patientDep2]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep2,
      operadoraId: s.operadoraId,
      numeroCarteira: '77665544332211',
      tipoBeneficiario: 'D',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dependente_sem_titular');
  });

  it('recusa carteirinha duplicada na mesma operadora', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('carteira_duplicada');
  });
});

describe('updatePacienteConvenio — atualiza vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientUpd = uuidv7();
    const opUpd = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Update Conv', 'completo')`,
        [patientUpd]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '999999', 'Op Para Update Conv', '11ABC22233DE99', $2)`,
        [opUpd, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientUpd,
        operadoraId: opUpd,
        numeroCarteira: '55443322110099',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('atualiza validade e nome do plano', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, {
        id: pcId,
        validade: '2028-06-30',
        nomePlano: 'Plano Premium',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.validade).toBe('2028-06-30');
    expect(r.value.nomePlano).toBe('Plano Premium');
  });

  it('retorna erro para vinculo inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, { id: uuidv7(), nomePlano: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('vinculo_nao_encontrado');
  });
});

describe('deactivatePacienteConvenio — desativa vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientDeact = uuidv7();
    const opDeact = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Deact Conv', 'completo')`,
        [patientDeact]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '123456', 'Op Para Deact Conv', '44ABC55566DE77', $2)`,
        [opDeact, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientDeact,
        operadoraId: opDeact,
        numeroCarteira: '66554433221100',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('desativa vinculo ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar vinculo ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listPacienteConvenios — lista convenios do paciente', () => {
  it('lista somente ativos por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listPacienteConvenios(tx, s.patientId));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./paciente-convenio` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/paciente-convenio.int.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./paciente-convenio` nao encontrado.

- [ ] Implementar `packages/tiss/src/paciente-convenio.ts`:

```typescript
// packages/tiss/src/paciente-convenio.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type PacienteConvenioFailure =
  | { kind: 'vinculo_nao_encontrado' }
  | { kind: 'carteira_duplicada' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'paciente_nao_encontrado' }
  | { kind: 'dependente_sem_titular' }
  | { kind: 'ja_desativado' };

export interface CreatePacienteConvenioInput {
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade?: string;
  readonly nomePlano?: string;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string;
  readonly titularCarteira?: string;
}

export interface PacienteConvenioRow {
  readonly id: string;
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade: string | null;
  readonly nomePlano: string | null;
  readonly tipoBeneficiario: string;
  readonly titularNome: string | null;
  readonly titularCarteira: string | null;
  readonly active: boolean;
}

export interface UpdatePacienteConvenioInput {
  readonly id: string;
  readonly numeroCarteira?: string;
  readonly validade?: string | null;
  readonly nomePlano?: string | null;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string | null;
  readonly titularCarteira?: string | null;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createPacienteConvenio(
  tx: TxClient,
  i: CreatePacienteConvenioInput,
  createdBy: string,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const tipo = i.tipoBeneficiario ?? 'T';

  if (tipo === 'D' && (i.titularNome === undefined || i.titularNome === null)) {
    return err({ kind: 'dependente_sem_titular' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira,
          validade, nome_plano, tipo_beneficiario,
          titular_nome, titular_carteira, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5::date, $6, $7,
               $8, $9, $10)`,
      [id, i.patientId, i.operadoraId, i.numeroCarteira,
       i.validade ?? null, i.nomePlano ?? null, tipo,
       i.titularNome ?? null, i.titularCarteira ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('patient')) {
        return err({ kind: 'paciente_nao_encontrado' });
      }
    }
    throw e;
  }

  return ok({
    id,
    patientId: i.patientId,
    operadoraId: i.operadoraId,
    numeroCarteira: i.numeroCarteira,
    validade: i.validade ?? null,
    nomePlano: i.nomePlano ?? null,
    tipoBeneficiario: tipo,
    titularNome: i.titularNome ?? null,
    titularCarteira: i.titularCarteira ?? null,
    active: true,
  });
}

export async function updatePacienteConvenio(
  tx: TxClient,
  i: UpdatePacienteConvenioInput,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT id::text, patient_id::text, operadora_id::text,
            numero_carteira, validade::text, nome_plano, tipo_beneficiario,
            titular_nome, titular_carteira, active
       FROM tiss.paciente_convenio WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });

  const numeroCarteira = i.numeroCarteira ?? existing.numero_carteira;
  const validade = i.validade !== undefined ? i.validade : existing.validade;
  const nomePlano = i.nomePlano !== undefined ? i.nomePlano : existing.nome_plano;
  const tipoBeneficiario = i.tipoBeneficiario ?? existing.tipo_beneficiario;
  const titularNome = i.titularNome !== undefined ? i.titularNome : existing.titular_nome;
  const titularCarteira = i.titularCarteira !== undefined ? i.titularCarteira : existing.titular_carteira;

  try {
    await tx.query(
      `UPDATE tiss.paciente_convenio
          SET numero_carteira = $2, validade = $3::date, nome_plano = $4,
              tipo_beneficiario = $5, titular_nome = $6, titular_carteira = $7
        WHERE id = $1`,
      [i.id, numeroCarteira, validade, nomePlano,
       tipoBeneficiario, titularNome, titularCarteira]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    throw e;
  }

  return ok({
    id: existing.id,
    patientId: existing.patient_id,
    operadoraId: existing.operadora_id,
    numeroCarteira,
    validade,
    nomePlano,
    tipoBeneficiario,
    titularNome,
    titularCarteira,
    active: existing.active,
  });
}

export async function deactivatePacienteConvenio(
  tx: TxClient,
  pcId: string,
): Promise<Result<{ id: string }, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.paciente_convenio WHERE id = $1`, [pcId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.paciente_convenio SET active = false WHERE id = $1`,
    [pcId]);

  return ok({ id: pcId });
}

export async function listPacienteConvenios(
  tx: TxClient,
  patientId: string,
  onlyActive: boolean = true,
): Promise<PacienteConvenioRow[]> {
  const whereActive = onlyActive ? 'AND pc.active = true' : '';
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT pc.id::text, pc.patient_id::text, pc.operadora_id::text,
            pc.numero_carteira, pc.validade::text, pc.nome_plano,
            pc.tipo_beneficiario, pc.titular_nome, pc.titular_carteira,
            pc.active
       FROM tiss.paciente_convenio pc
      WHERE pc.patient_id = $1 ${whereActive}
      ORDER BY pc.created_at DESC`,
    [patientId]);
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    operadoraId: r.operadora_id,
    numeroCarteira: r.numero_carteira,
    validade: r.validade,
    nomePlano: r.nome_plano,
    tipoBeneficiario: r.tipo_beneficiario,
    titularNome: r.titular_nome,
    titularCarteira: r.titular_carteira,
    active: r.active,
  }));
}
```

- [ ] Rodar o teste de paciente-convenio e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/paciente-convenio.int.test.ts
```

Saida esperada: todos os testes de paciente-convenio passam.

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar todos os modulos:

```typescript
export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';

export {
  createContrato,
  updateContrato,
  deactivateContrato,
  listContratos,
  type CreateContratoInput,
  type UpdateContratoInput,
  type ContratoRow,
  type ContratoFailure,
} from './contrato';

export {
  createPacienteConvenio,
  updatePacienteConvenio,
  deactivatePacienteConvenio,
  listPacienteConvenios,
  type CreatePacienteConvenioInput,
  type UpdatePacienteConvenioInput,
  type PacienteConvenioRow,
  type PacienteConvenioFailure,
} from './paciente-convenio';
```

- [ ] Rodar todos os testes do pacote tiss de uma vez:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```
feat(tiss): add contrato and paciente_convenio CRUD with integration tests
```

---

### Task 7: Acoes de authz para TISS e teste do catalogo

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Criar: `packages/authz/src/actions-fase4.test.ts`

**Passos**

- [ ] Escrever o teste que falha em `packages/authz/src/actions-fase4.test.ts`:

```typescript
// packages/authz/src/actions-fase4.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY } from './actions';

describe('acoes de TISS — Fase 4', () => {
  it('tiss.operadora.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.operadora.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.read existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.contrato.write existe e permite admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.contrato.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('financeiro');
  });

  it('tiss.paciente_convenio.read existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.read');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('profissional');
    expect(action!.roles).toContain('recepcao');
  });

  it('tiss.paciente_convenio.write existe e permite admin, profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.paciente_convenio.write');
    expect(action).toBeDefined();
    expect(action!.roles).toContain('admin_clinico');
    expect(action!.roles).toContain('recepcao');
  });

  it('nenhuma acao TISS exige MFA', () => {
    const tissActions = ACTIONS.filter((a) => a.key.startsWith('tiss.'));
    for (const action of tissActions) {
      expect(action.requiresMfa, `${action.key} nao deve exigir MFA`).toBeUndefined();
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque as acoes ainda nao existem:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run src/actions-fase4.test.ts 2>&1 | head -30
```

Saida esperada: os testes falham com "expected undefined not to be undefined" ou similar.

- [ ] Adicionar as acoes TISS em `packages/authz/src/actions.ts`, antes do `] as const satisfies readonly ActionDef[];`:

```typescript
  // ── Fase 4 · Convenios (TISS) ──────────────────────────────────────────
  { key: 'tiss.operadora.read', description: 'Listar operadoras de convenio',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.operadora.write', description: 'Criar ou editar operadora de convenio',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.contrato.read', description: 'Listar contratos com operadoras',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
  { key: 'tiss.contrato.write', description: 'Criar ou editar contrato com operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.paciente_convenio.read', description: 'Listar convenios do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.paciente_convenio.write', description: 'Vincular paciente a convenio',
    roles: ['admin_clinico', 'recepcao'] },
```

- [ ] Rodar o teste e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run src/actions-fase4.test.ts
```

Saida esperada: todos os testes de acoes TISS passam.

- [ ] Rodar todos os testes de authz para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/authz exec vitest run
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```
feat(authz): add Fase 4 TISS RBAC actions for operadora, contrato and paciente_convenio
```
