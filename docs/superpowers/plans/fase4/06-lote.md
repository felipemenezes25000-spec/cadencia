### Task 33: migration 0119 — enum lote_status, tabela lote_number_counter, funcao next_lote_number, tabela lote

**Arquivos**

- Criar `packages/db/migrations/0119_tiss_lote.sql`
- Modificar `packages/db/privileges.json`

**Passos**

- [ ] Criar a migration `packages/db/migrations/0119_tiss_lote.sql`:

```sql
-- 0119_tiss_lote.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Lote TISS: agrupamento de guias para envio a operadora. O numero do lote e
-- sequencial por operadora dentro do tenant, auto-provisionado na primeira
-- criacao. O ciclo de vida e: rascunho -> pronto -> enviado -> retornado.
-- Cancelamento so e permitido antes do envio.
--
-- Nenhuma ocorrencia de now() ou current_date neste schema (invariante de CI).

-- ---------------------------------------------------------------------------
-- 1. Enum de status do lote
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.lote_status AS ENUM (
  'rascunho', 'pronto', 'enviado', 'retornado', 'cancelado'
);

-- ---------------------------------------------------------------------------
-- 2. Contador de numero de lote por operadora (auto-provisionante)
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.lote_number_counter (
  tenant_id    uuid NOT NULL,
  operadora_id uuid NOT NULL,
  next_value   bigint NOT NULL DEFAULT 2,
  PRIMARY KEY (tenant_id, operadora_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id)
);
ALTER TABLE tiss.lote_number_counter OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.lote_number_counter TO app_rw;

ALTER TABLE tiss.lote_number_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote_number_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote_number_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Funcao auto-provisionante: primeira chamada insere e devolve 1
-- ---------------------------------------------------------------------------
CREATE FUNCTION tiss.next_lote_number(p_tenant_id uuid, p_operadora_id uuid)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
  INSERT INTO tiss.lote_number_counter (tenant_id, operadora_id, next_value)
  VALUES (p_tenant_id, p_operadora_id, 2)
  ON CONFLICT (tenant_id, operadora_id)
  DO UPDATE SET next_value = tiss.lote_number_counter.next_value + 1
  RETURNING next_value - 1 $$;
ALTER FUNCTION tiss.next_lote_number(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_lote_number(uuid, uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- 4. Tabela principal: tiss.lote
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.lote (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                    uuid NOT NULL,
  operadora_id          uuid NOT NULL,
  numero_lote           varchar(12) NOT NULL,
  status                tiss.lote_status NOT NULL DEFAULT 'rascunho',
  tiss_version          varchar(5) NOT NULL,
  guia_count            int NOT NULL DEFAULT 0 CHECK (guia_count >= 0),
  total_value_cents     bigint NOT NULL DEFAULT 0 CHECK (total_value_cents >= 0),
  xml_storage_key       text,
  xml_hash_md5          char(32),
  protocolo_operadora   varchar,
  sent_at               timestamptz(3),
  created_by            uuid NOT NULL,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, numero_lote),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  -- sent_at so pode existir se o lote foi enviado ou retornado
  CHECK (
    (status IN ('enviado', 'retornado') AND sent_at IS NOT NULL)
    OR (status NOT IN ('enviado', 'retornado') AND sent_at IS NULL)
  ),
  -- protocolo so existe apos envio
  CHECK (
    (protocolo_operadora IS NOT NULL AND status IN ('enviado', 'retornado'))
    OR protocolo_operadora IS NULL
  ),
  -- xml_storage_key e xml_hash_md5 vivem ou morrem juntos
  CHECK (num_nonnulls(xml_storage_key, xml_hash_md5) IN (0, 2))
);
ALTER TABLE tiss.lote OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.lote TO app_rw;

CREATE INDEX ix_lote_operadora_status
  ON tiss.lote (tenant_id, operadora_id, status);

CREATE INDEX ix_lote_created_at
  ON tiss.lote (tenant_id, created_at DESC);

ALTER TABLE tiss.lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.lote FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.lote
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: linha terminando em `0119_tiss_lote.sql`.

- [ ] Verificar que os invariantes continuam verdes:

```bash
pnpm db:invariants
```

Saida esperada: todos os invariantes passam (a tabela tem tenant_id, RLS habilitada e forcada, policy, FK composta).

---

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

### Task 36: teste de isolamento para tiss.lote e tiss.lote_guia

**Arquivos**

- Criar `packages/db/test/iso/31-tiss-lote.iso.test.ts`

**Passos**

- [ ] Criar o teste `packages/db/test/iso/31-tiss-lote.iso.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import * as F from './fixtures';
import { comoAtor, erroPg, openClient } from './harness';

describe('tiss.lote e tiss.lote_guia — isolamento e estrutura', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
    await admin.end();
  });

  // ── Estrutura ──────────────────────────────────────────────────────────────

  it('tiss.lote tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT rowsecurity, forcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote'::regclass`,
    );
    expect(rows[0]).toEqual({ rowsecurity: true, forcerowsecurity: true });
  });

  it('tiss.lote_guia tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT rowsecurity, forcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote_guia'::regclass`,
    );
    expect(rows[0]).toEqual({ rowsecurity: true, forcerowsecurity: true });
  });

  it('tiss.lote_number_counter tem RLS habilitada e forcada', async () => {
    const { rows } = await admin.query<{ rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT rowsecurity, forcerowsecurity FROM pg_class
        WHERE oid = 'tiss.lote_number_counter'::regclass`,
    );
    expect(rows[0]).toEqual({ rowsecurity: true, forcerowsecurity: true });
  });

  it('numero_lote e varchar(12) — tamanho maximo do campo no XML TISS', async () => {
    const { rows } = await admin.query<{ data_type: string; character_maximum_length: number }>(
      `SELECT data_type, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'tiss' AND table_name = 'lote'
          AND column_name = 'numero_lote'`,
    );
    expect(rows[0]?.data_type).toBe('character varying');
    expect(rows[0]?.character_maximum_length).toBe(12);
  });

  it('xml_storage_key e xml_hash_md5 vivem ou morrem juntos (CHECK)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.lote'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%xml_storage_key%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.def).toContain('num_nonnulls');
  });

  it('sent_at so existe se lote foi enviado ou retornado (CHECK)', async () => {
    const { rows } = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'tiss.lote'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%sent_at%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('guia so pertence a um lote — indice unico em (tenant_id, guia_id)', async () => {
    const { rows } = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'tiss' AND tablename = 'lote_guia'
          AND indexdef LIKE '%UNIQUE%'
          AND indexdef LIKE '%guia_id%'
          AND indexdef NOT LIKE '%lote_id%sequencial_item%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // ── Isolamento T1: tenant A nao ve lote do tenant B ─────────────────────

  it('tenant A nao enxerga lote do tenant B', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      const { rows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.lote WHERE id = $1`, [F.LOTE_B],
      );
      expect(rows).toEqual([]);
    });
  });

  it('tenant A nao enxerga lote_guia do tenant B', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      const { rows } = await c.query<{ lote_id: string }>(
        `SELECT lote_id FROM tiss.lote_guia WHERE lote_id = $1`, [F.LOTE_B],
      );
      expect(rows).toEqual([]);
    });
  });

  // ── next_lote_number: auto-provisionamento ─────────────────────────────

  it('next_lote_number auto-provisiona e incrementa', async () => {
    const actorA = {
      kind: 'user' as const,
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    await comoAtor(api, actorA, async (c) => {
      await c.query('SET LOCAL ROLE app_rw');
      // O seed ja provisionou com next_value=2, entao a proxima chamada
      // retorna 2 (incrementa para 3).
      const { rows: r1 } = await c.query<{ next_lote_number: string }>(
        `SELECT tiss.next_lote_number($1, $2) AS next_lote_number`,
        [F.TENANT_A, F.OPERADORA_A],
      );
      const n1 = Number(r1[0]?.next_lote_number);
      expect(n1).toBeGreaterThanOrEqual(2);

      const { rows: r2 } = await c.query<{ next_lote_number: string }>(
        `SELECT tiss.next_lote_number($1, $2) AS next_lote_number`,
        [F.TENANT_A, F.OPERADORA_A],
      );
      const n2 = Number(r2[0]?.next_lote_number);
      expect(n2).toBe(n1 + 1);
    });
  });
});
```

- [ ] Rodar o teste de isolamento:

```bash
pnpm test:iso -- --testPathPattern 31-tiss-lote
```

Saida esperada: todos os testes passam.

---

### Task 37: funcao de dominio createLote — cria lote em status rascunho

**Arquivos**

- Criar `packages/tiss/src/create-lote.ts`
- Criar `packages/tiss/src/create-lote.int.test.ts`
- Modificar `packages/tiss/src/index.ts`
- Modificar `packages/tiss/package.json`

**Passos**

- [ ] Adicionar dependencias ao `packages/tiss/package.json`:

```json
{
  "name": "@cadencia/tiss",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@cadencia/db": "workspace:*",
    "@cadencia/kernel": "workspace:*"
  },
  "devDependencies": {
    "pg": "^8.16.0",
    "vitest": "^3.2.1"
  }
}
```

- [ ] Criar `packages/tiss/src/create-lote.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type CreateLoteFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'operadora_inativa' };

export interface CreateLoteInput {
  readonly operadoraId: string;
  readonly createdBy: string;
}

export interface CreatedLote {
  readonly loteId: string;
  readonly numeroLote: string;
  readonly tissVersion: string;
}

/**
 * Cria um lote TISS em status rascunho para a operadora informada.
 * O numero do lote e gerado automaticamente via tiss.next_lote_number(),
 * que se auto-provisiona na primeira chamada. A versao TISS vem do
 * cadastro da operadora (a versao acordada, nao a versao vigente hoje).
 */
export async function createLote(
  tx: TxClient,
  i: CreateLoteInput,
): Promise<Result<CreatedLote, CreateLoteFailure>> {
  // 1. Busca a operadora para pegar tiss_version e validar que existe e esta ativa
  const { rows: opRows } = await tx.query<{
    id: string;
    tiss_version: string;
    active: boolean;
    tenant_id: string;
  }>(
    `SELECT id, tiss_version, active, tenant_id
       FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }
  const op = opRows[0]!;
  if (!op.active) {
    return err({ kind: 'operadora_inativa' });
  }

  // 2. Gera numero sequencial do lote para esta operadora
  const { rows: numRows } = await tx.query<{ n: string }>(
    `SELECT tiss.next_lote_number($1, $2) AS n`,
    [op.tenant_id, i.operadoraId],
  );
  const numeroLote = String(numRows[0]!.n);

  // 3. Insere o lote em status rascunho
  const loteId = uuidv7();
  await tx.query(
    `INSERT INTO tiss.lote
       (id, operadora_id, numero_lote, status, tiss_version,
        guia_count, total_value_cents, created_by)
     VALUES ($1, $2, $3, 'rascunho', $4, 0, 0, $5)`,
    [loteId, i.operadoraId, numeroLote, op.tiss_version, i.createdBy],
  );

  return ok({
    loteId,
    numeroLote,
    tissVersion: op.tiss_version,
  });
}
```

- [ ] Criar o teste `packages/tiss/src/create-lote.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';

interface SementeLote {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  operadoraInativaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLote(): Promise<SementeLote> {
  const s: SementeLote = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), operadoraInativaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Lote', '11ABC22334DE55')`,
      [s.tenantId, `l-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lote', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Lote')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ000001DE01', '3.05', true),
              ($1, $3, '999999', 'Operadora Inativa', '88XYZ000002DE02', '3.05', false)`,
      [s.tenantId, s.operadoraId, s.operadoraInativaId]);
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

describe('createLote', () => {
  let s: SementeLote;

  beforeAll(async () => {
    s = await semearLote();
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria lote em status rascunho com numero sequencial', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numeroLote).toBe('1');
    expect(result.value.tissVersion).toBe('3.05');
    expect(result.value.loteId).toBeTruthy();
  });

  it('segundo lote da mesma operadora recebe numero sequencial incrementado', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const r1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(Number(r2.value.numeroLote)).toBe(Number(r1.value.numeroLote) + 1);
  });

  it('recusa operadora inexistente', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: uuidv7(), createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_nao_encontrada');
  });

  it('recusa operadora inativa', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraInativaId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_inativa');
  });
});
```

- [ ] Atualizar `packages/tiss/src/index.ts`:

```typescript
export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/create-lote.int.test.ts
```

Saida esperada: 4 testes passando.

---

### Task 38: funcoes addGuiaToLote e removeGuiaFromLote com validacoes

**Arquivos**

- Criar `packages/tiss/src/lote-guias.ts`
- Criar `packages/tiss/src/lote-guias.int.test.ts`
- Modificar `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar `packages/tiss/src/lote-guias.ts`:

```typescript
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type AddGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'guia_nao_encontrada' }
  | { kind: 'guia_inativa' }
  | { kind: 'guia_operadora_divergente' }
  | { kind: 'guia_ja_em_lote'; loteId: string };

export type RemoveGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface AddGuiaInput {
  readonly loteId: string;
  readonly guiaId: string;
}

export interface AddedGuia {
  readonly sequencialItem: number;
  readonly guiaCount: number;
  readonly totalValueCents: number;
}

/**
 * Adiciona uma guia a um lote em rascunho. Validacoes:
 * - Lote existe e esta em rascunho
 * - Guia existe e esta com live=true
 * - Guia pertence a mesma operadora do lote
 * - Guia nao esta em outro lote (indice unico garante, mas validamos antes)
 */
export async function addGuiaToLote(
  tx: TxClient,
  i: AddGuiaInput,
): Promise<Result<AddedGuia, AddGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, operadora_id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Busca a guia e valida
  const { rows: guiaRows } = await tx.query<{
    id: string;
    operadora_id: string;
    live: boolean;
    valor_procedimento: string;
  }>(
    `SELECT id, operadora_id, live, valor_procedimento
       FROM tiss.encounter_guia_consulta WHERE id = $1`,
    [i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'guia_nao_encontrada' });
  }
  const guia = guiaRows[0]!;
  if (!guia.live) {
    return err({ kind: 'guia_inativa' });
  }
  if (guia.operadora_id !== lote.operadora_id) {
    return err({ kind: 'guia_operadora_divergente' });
  }

  // 3. Verifica se guia ja esta em outro lote
  const { rows: existeRows } = await tx.query<{ lote_id: string }>(
    `SELECT lote_id FROM tiss.lote_guia WHERE guia_id = $1`,
    [i.guiaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'guia_ja_em_lote', loteId: existeRows[0]!.lote_id });
  }

  // 4. Calcula proximo sequencial_item
  const { rows: seqRows } = await tx.query<{ max_seq: number | null }>(
    `SELECT MAX(sequencial_item) AS max_seq
       FROM tiss.lote_guia WHERE lote_id = $1`,
    [i.loteId],
  );
  const nextSeq = (seqRows[0]?.max_seq ?? 0) + 1;

  // 5. Insere o vinculo
  await tx.query(
    `INSERT INTO tiss.lote_guia (lote_id, guia_id, sequencial_item)
     VALUES ($1, $2, $3)`,
    [i.loteId, i.guiaId, nextSeq],
  );

  // 6. Atualiza contadores no lote
  // valor_procedimento e numeric(12,2) na guia; convertemos para centavos
  const valorCents = Math.round(Number(guia.valor_procedimento) * 100);
  const newCount = lote.guia_count + 1;
  const newTotal = Number(lote.total_value_cents) + valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, newCount, newTotal],
  );

  return ok({
    sequencialItem: nextSeq,
    guiaCount: newCount,
    totalValueCents: newTotal,
  });
}

/**
 * Remove uma guia de um lote em rascunho. Atualiza contadores.
 */
export async function removeGuiaFromLote(
  tx: TxClient,
  i: { loteId: string; guiaId: string },
): Promise<Result<{ guiaCount: number; totalValueCents: number }, RemoveGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Remove o vinculo e pega o valor da guia
  const { rows: guiaRows } = await tx.query<{ valor_procedimento: string }>(
    `DELETE FROM tiss.lote_guia lg
      USING tiss.encounter_guia_consulta g
      WHERE lg.lote_id = $1 AND lg.guia_id = $2
        AND g.id = lg.guia_id AND g.tenant_id = lg.tenant_id
      RETURNING g.valor_procedimento`,
    [i.loteId, i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const valorCents = Math.round(Number(guiaRows[0]!.valor_procedimento) * 100);
  const newCount = lote.guia_count - 1;
  const newTotal = Number(lote.total_value_cents) - valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, Math.max(newCount, 0), Math.max(newTotal, 0)],
  );

  return ok({
    guiaCount: Math.max(newCount, 0),
    totalValueCents: Math.max(newTotal, 0),
  });
}
```

- [ ] Criar o teste `packages/tiss/src/lote-guias.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote, removeGuiaFromLote } from './lote-guias';

interface SementeGuias {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  operadoraBId: string;
  guiaId: string;
  guiaBId: string;
  guiaInativaId: string;
  guiaOutraOperadoraId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearGuias(): Promise<SementeGuias> {
  const s: SementeGuias = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(), operadoraBId: uuidv7(),
    guiaId: uuidv7(), guiaBId: uuidv7(),
    guiaInativaId: uuidv7(), guiaOutraOperadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Guias', '22ABC33445DE66')`,
      [s.tenantId, `g-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Guias', '2223344', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Guias')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '222333', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Guias', 'completo')`,
      [s.tenantId, s.patientId]);

    // Duas operadoras
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ000001DE01', '3.05', true),
              ($1, $3, '111222', 'Outra Operadora', '77XYZ000003DE03', '3.05', true)`,
      [s.tenantId, s.operadoraId, s.operadoraBId]);

    // Encounter para vincular as guias
    const encounterId = uuidv7();
    const encounterBId = uuidv7();
    const encounterCId = uuidv7();
    const encounterDId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T14:00:00Z', DATE '2026-08-01'),
              ($1, $6, $3, $4, $5, TIMESTAMPTZ '2026-08-02T14:00:00Z', DATE '2026-08-02'),
              ($1, $7, $3, $4, $5, TIMESTAMPTZ '2026-08-03T14:00:00Z', DATE '2026-08-03'),
              ($1, $8, $3, $4, $5, TIMESTAMPTZ '2026-08-04T14:00:00Z', DATE '2026-08-04')`,
      [s.tenantId, encounterId, s.patientId, s.professionalId, s.clinicId,
       encounterBId, encounterCId, encounterDId]);

    // Versoes de encounter para FK de encounter_guia_consulta
    const versionId = uuidv7();
    const versionBId = uuidv7();
    const versionCId = uuidv7();
    const versionDId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $9, $10, sha256('v1'::bytea), 'jcs-1'),
              ($1, $4, $5, 1, 'original', $9, $10, sha256('v2'::bytea), 'jcs-1'),
              ($1, $6, $7, 1, 'original', $9, $10, sha256('v3'::bytea), 'jcs-1'),
              ($1, $8, $11, 1, 'original', $9, $10, sha256('v4'::bytea), 'jcs-1')`,
      [s.tenantId, versionId, encounterId, versionBId, encounterBId,
       versionCId, encounterCId, versionDId, encounterDId,
       s.userId, s.professionalId]);

    // Guias: ativa operadora A, ativa operadora A (segunda), inativa, outra operadora
    const guiaCounterId = uuidv7();
    await c.query(
      `INSERT INTO tiss.guia_numero_counter (tenant_id, id, next_value)
       VALUES ($1, $2, 5)
       ON CONFLICT DO NOTHING`,
      [s.tenantId, guiaCounterId]);

    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES
         ($1, $2, $12, $16, $6, '326305', 'G001', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $10),
         ($1, $3, $13, $17, $6, '326305', 'G002', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-02', '1', '22', '10101012', 180.00, true, $10),
         ($1, $4, $14, $18, $6, '326305', 'G003', '00998877665544', false,
          '900123', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-03', '1', '22', '10101012', 300.00, false, $10),
         ($1, $5, $15, $19, $7, '111222', 'G004', '00112233445566', false,
          '800456', '2223344', '06', '222333', 'SP', '225125', '9', '01',
          DATE '2026-08-04', '1', '22', '10101012', 200.00, true, $10)`,
      [s.tenantId, s.guiaId, s.guiaBId, s.guiaInativaId, s.guiaOutraOperadoraId,
       s.operadoraId, s.operadoraBId,
       encounterId, encounterBId, encounterCId, encounterDId,
       s.userId,
       encounterId, encounterBId, encounterCId, encounterDId,
       versionId, versionBId, versionCId, versionDId]);

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

describe('addGuiaToLote e removeGuiaFromLote', () => {
  let s: SementeGuias;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearGuias();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('adiciona guia ativa a lote rascunho e atualiza contadores', async () => {
    // Cria um lote
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    // Adiciona a guia
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sequencialItem).toBe(1);
    expect(result.value.guiaCount).toBe(1);
    expect(result.value.totalValueCents).toBe(25000);
  });

  it('adiciona segunda guia e incrementa sequencial e contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    const r2 = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaBId }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.sequencialItem).toBe(2);
    expect(r2.value.guiaCount).toBe(2);
    expect(r2.value.totalValueCents).toBe(43000); // 25000 + 18000
  });

  it('recusa guia inativa (live=false)', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaInativaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_inativa');
  });

  it('recusa guia de operadora diferente da do lote', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: loteResult.value.loteId, guiaId: s.guiaOutraOperadoraId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_operadora_divergente');
  });

  it('recusa guia ja inclusa em outro lote', async () => {
    // Cria dois lotes
    const l1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    const l2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(l1.ok && l2.ok).toBe(true);
    if (!l1.ok || !l2.ok) return;

    // Adiciona guia ao primeiro lote
    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l1.value.loteId, guiaId: s.guiaId }),
    );

    // Tenta adicionar a mesma guia ao segundo lote
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId: l2.value.loteId, guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('guia_ja_em_lote');
  });

  it('remove guia de lote rascunho e atualiza contadores', async () => {
    const loteResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(loteResult.ok).toBe(true);
    if (!loteResult.ok) return;
    const loteId = loteResult.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaBId }),
    );

    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId, guiaId: s.guiaBId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(0);
    expect(result.value.totalValueCents).toBe(0);
  });

  it('recusa remocao de guia de lote inexistente', async () => {
    const result = await withTenantTx(actor, (tx) =>
      removeGuiaFromLote(tx, { loteId: uuidv7(), guiaId: s.guiaId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_nao_encontrado');
  });
});
```

- [ ] Atualizar `packages/tiss/src/index.ts` adicionando as novas exportacoes:

```typescript
export { createLote, type CreateLoteInput, type CreatedLote, type CreateLoteFailure } from './create-lote';
export {
  addGuiaToLote, removeGuiaFromLote,
  type AddGuiaInput, type AddedGuia, type AddGuiaFailure, type RemoveGuiaFailure,
} from './lote-guias';
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/lote-guias.int.test.ts
```

Saida esperada: 7 testes passando.

---

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

### Task 40: teste de integracao completo do ciclo de vida do lote

**Arquivos**

- Criar `packages/tiss/src/lote-full-cycle.int.test.ts`

**Passos**

- [ ] Criar `packages/tiss/src/lote-full-cycle.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';
import { addGuiaToLote, removeGuiaFromLote } from './lote-guias';
import { markLoteReady, markLoteSent, receiveLoteReturn, cancelLote } from './lote-lifecycle';

interface SementeCiclo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  guiaIds: string[];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCiclo(): Promise<SementeCiclo> {
  const s: SementeCiclo = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), patientId: uuidv7(),
    operadoraId: uuidv7(),
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Ciclo', '44ABC55667DE88')`,
      [s.tenantId, `cy-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ciclo', '4445566', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Ciclo')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '444555', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Ciclo', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active)
       VALUES ($1, $2, '326305', 'Meridiano Ciclo', '66XYZ000005DE05', '3.05', true)`,
      [s.tenantId, s.operadoraId]);

    // Tres encounters e tres guias
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}')`,
        [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId]);
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, s.professionalId, `ciclo-${idx}`]);
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '4445566', '06', '444555', 'SP', '225125', '9', '01',
            DATE '2026-08-${dia}', '1', '22', '10101012', ${(idx + 1) * 100}.00,
            true, $7)`,
        [s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
         `CY-${String(idx + 1).padStart(3, '0')}`, s.userId]);
    }

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

describe('ciclo completo do lote TISS', () => {
  let s: SementeCiclo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearCiclo();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('percorre o ciclo completo: criar -> adicionar guias -> pronto -> enviar -> retornar', async () => {
    // 1. Criar lote em rascunho
    const createResult = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const loteId = createResult.value.loteId;
    expect(createResult.value.tissVersion).toBe('3.05');

    // 2. Adicionar 3 guias
    for (let idx = 0; idx < 3; idx++) {
      const addResult = await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId, guiaId: s.guiaIds[idx]! }),
      );
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;
      expect(addResult.value.sequencialItem).toBe(idx + 1);
    }

    // Verifica contadores apos as 3 guias
    const lastAdd = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ guia_count: number; total_value_cents: string }>(
        `SELECT guia_count, total_value_cents FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(lastAdd?.guia_count).toBe(3);
    // 100 + 200 + 300 = 600 reais = 60000 centavos
    expect(Number(lastAdd?.total_value_cents)).toBe(60000);

    // 3. Marcar como pronto
    const readyResult = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, loteId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.guiaCount).toBe(3);
    expect(readyResult.value.totalValueCents).toBe(60000);

    // 3b. Nao pode adicionar guia a lote pronto (ja nao esta em rascunho)
    // Esta verificacao usa uma guia que nao existe, mas o erro retornado
    // sera 'lote_nao_rascunho' porque a validacao de status vem primeiro.
    const addAfterReady = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: uuidv7() }),
    );
    expect(addAfterReady.ok).toBe(false);
    if (addAfterReady.ok) return;
    expect(addAfterReady.error.kind).toBe('lote_nao_rascunho');

    // 4. Enviar com protocolo
    const sentResult = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-CICLO-001',
        xmlStorageKey: 'lote/ciclo/001.xml',
        xmlHashMd5: 'aabbccdd11223344aabbccdd11223344',
      }),
    );
    expect(sentResult.ok).toBe(true);
    if (!sentResult.ok) return;
    expect(sentResult.value.protocoloOperadora).toBe('PROT-CICLO-001');

    // 4b. Nao pode cancelar lote enviado
    const cancelAfterSent = await withTenantTx(actor, (tx) =>
      cancelLote(tx, loteId),
    );
    expect(cancelAfterSent.ok).toBe(false);
    if (cancelAfterSent.ok) return;
    expect(cancelAfterSent.error.kind).toBe('lote_ja_enviado');

    // 5. Receber retorno
    const returnResult = await withTenantTx(actor, (tx) =>
      receiveLoteReturn(tx, loteId),
    );
    expect(returnResult.ok).toBe(true);

    // 6. Verificar estado final no banco
    const finalState = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        protocolo_operadora: string;
        xml_storage_key: string;
        xml_hash_md5: string;
        guia_count: number;
      }>(
        `SELECT status, protocolo_operadora, xml_storage_key, xml_hash_md5, guia_count
           FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(finalState?.status).toBe('retornado');
    expect(finalState?.protocolo_operadora).toBe('PROT-CICLO-001');
    expect(finalState?.xml_storage_key).toBe('lote/ciclo/001.xml');
    expect(finalState?.xml_hash_md5).toBe('aabbccdd11223344aabbccdd11223344');
    expect(finalState?.guia_count).toBe(3);
  });

  it('cancelamento libera guias para reutilizacao em outro lote', async () => {
    // Cria guias dedicadas para este sub-teste
    const freshGuiaIds = [uuidv7(), uuidv7()];
    const freshAdmin = new Pool({ connectionString: adminUrl(), max: 1 });
    const fc = await freshAdmin.connect();
    try {
      await fc.query('BEGIN');
      for (let idx = 0; idx < 2; idx++) {
        const encId = uuidv7();
        const verId = uuidv7();
        const dia = String(10 + idx).padStart(2, '0');
        await fc.query(
          `INSERT INTO clin.encounter
             (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
           VALUES ($1, $2, $3, $4, $5,
                   TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}')`,
          [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId]);
        await fc.query(
          `INSERT INTO clin.encounter_version
             (tenant_id, id, encounter_id, version_no, kind, author_user_id,
              author_professional_id, content_hash, serializer_version)
           VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
          [s.tenantId, verId, encId, s.userId, s.professionalId, `reuse-${idx}`]);
        await fc.query(
          `INSERT INTO tiss.encounter_guia_consulta
             (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
              registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
              codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
              uf_conselho, cbos, indicacao_acidente, regime_atendimento,
              data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
              valor_procedimento, live, created_by)
           VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
              '900123', '4445566', '06', '444555', 'SP', '225125', '9', '01',
              DATE '2026-08-${dia}', '1', '22', '10101012', 500.00, true, $7)`,
          [s.tenantId, freshGuiaIds[idx], encId, verId, s.operadoraId,
           `REUSE-${String(idx + 1).padStart(3, '0')}`, s.userId]);
      }
      await fc.query('COMMIT');
    } finally {
      fc.release();
      await freshAdmin.end();
    }

    // Cria lote, adiciona guias, cancela
    const lote1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote1.ok).toBe(true);
    if (!lote1.ok) return;

    for (const gid of freshGuiaIds) {
      await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId: lote1.value.loteId, guiaId: gid }),
      );
    }

    const cancelResult = await withTenantTx(actor, (tx) =>
      cancelLote(tx, lote1.value.loteId),
    );
    expect(cancelResult.ok).toBe(true);
    if (!cancelResult.ok) return;
    expect(cancelResult.value.guiasLiberadas).toBe(2);

    // Cria novo lote e reutiliza as mesmas guias
    const lote2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote2.ok).toBe(true);
    if (!lote2.ok) return;

    for (const gid of freshGuiaIds) {
      const addResult = await withTenantTx(actor, (tx) =>
        addGuiaToLote(tx, { loteId: lote2.value.loteId, guiaId: gid }),
      );
      expect(addResult.ok).toBe(true);
    }
  });
});
```

- [ ] Rodar o teste:

```bash
cd packages/tiss && pnpm vitest run src/lote-full-cycle.int.test.ts
```

Saida esperada: 2 testes passando.

- [ ] Rodar toda a suite do pacote tiss para confirmar que tudo esta verde:

```bash
cd packages/tiss && pnpm vitest run
```

Saida esperada: todos os testes passando (create-lote, lote-guias, lote-lifecycle, lote-full-cycle).

- [ ] Rodar os invariantes finais:

```bash
pnpm db:invariants
```

Saida esperada: todos passam.
