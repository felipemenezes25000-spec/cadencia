### Task 1: teste de integracao — tabelas demonstrativo e demonstrativo_item existem com colunas corretas

**Arquivos:**
- `packages/tiss/src/demonstrativo.int.test.ts`

O teste roda ANTES da migration existir, portanto FALHA. Confirma que o invariante de CI pega a ausencia.

- [ ] Criar o arquivo de teste que verifica a existencia e colunas das duas tabelas novas.

```ts
// packages/tiss/src/demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente minima para demonstrativo                                  */
/* ------------------------------------------------------------------ */

interface SementeDemonstrativo {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  loteId: string;
  guiaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDemonstrativo(): Promise<SementeDemonstrativo> {
  const s: SementeDemonstrativo = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    guiaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clinica, usuario, membership ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Demonstrativo', '44ABC55667DE88')`,
      [s.tenantId, `demo-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Demo', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Demo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Demo', '77XYZ00001DE01', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter + version + guia (minimo para FK) ---
    const encId = uuidv7();
    const verId = uuidv7();
    const profId = uuidv7();

    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '112233', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, gen_random_uuid(), 'Paciente Demo', 'completo')`,
      [s.tenantId],
    );
    // Precisamos do patient_id real
    const { rows: patRows } = await c.query<{ id: string }>(
      `SELECT id FROM clin.patient WHERE tenant_id = $1 LIMIT 1`,
      [s.tenantId],
    );
    const patientId = patRows[0]!.id;

    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T10:00:00Z', DATE '2026-08-01')`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('demo1'::bytea), 'jcs-1')`,
      [s.tenantId, verId, encId, s.userId, profId],
    );
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'DM001', '00998877665544', false,
          '900123', '4455667', '06', '112233', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, verId, s.operadoraId, s.userId],
    );

    // --- lote enviado (pre-requisito para vincular demonstrativo) ---
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 25000,
               'lote/demo.xml', '01234567890123456789012345678901',
               'PROT-DEMO-001', TIMESTAMPTZ '2026-08-02T10:00:00Z', $4)`,
      [s.tenantId, s.loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, s.loteId, s.guiaId],
    );

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

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('modelo de dados do demonstrativo TISS', () => {
  let s: SementeDemonstrativo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearDemonstrativo();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  // ── INSERT demonstrativo ────────────────────────────────────────────

  it('insere demonstrativo de analise vinculado a lote', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/demo-analise.xml',
                 25000, 24000, 24000, 1000, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      const { rows } = await tx.query<{
        id: string;
        kind: string;
        total_glosa_cents: string;
        data_pagamento: string | null;
      }>(
        `SELECT id, kind, total_glosa_cents, data_pagamento
           FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('analise');
      expect(Number(rows[0]!.total_glosa_cents)).toBe(1000);
      expect(rows[0]!.data_pagamento).toBeNull();
    });
  });

  it('insere demonstrativo de pagamento com data_pagamento', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, data_pagamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'pagamento',
                 DATE '2026-08-10', DATE '2026-08-15',
                 'demonstrativo/2026/08/demo-pag.xml',
                 25000, 25000, 25000, 0, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      const { rows } = await tx.query<{
        kind: string;
        data_pagamento: string;
      }>(
        `SELECT kind, data_pagamento FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('pagamento');
      expect(rows[0]!.data_pagamento).toBeTruthy();
    });
  });

  it('insere demonstrativo avulso (lote_id null)', async () => {
    const demoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, 'PROT-AVULSO', 'analise',
                 DATE '2026-08-06', 'demonstrativo/2026/08/avulso.xml',
                 10000, 9000, 9000, 1000, $3)`,
        [demoId, s.operadoraId, s.userId],
      );

      const { rows } = await tx.query<{ lote_id: string | null }>(
        `SELECT lote_id FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.lote_id).toBeNull();
    });
  });

  // ── INSERT demonstrativo_item ───────────────────────────────────────

  it('insere item de demonstrativo vinculado a guia', async () => {
    const demoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      // Primeiro insere o demonstrativo pai
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/item-test.xml',
                 25000, 24000, 24000, 1000, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      // Insere item
      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, 'DM001',
                 25000, 24000, 24000, 1000,
                 'M010', 'Procedimento nao coberto')`,
        [itemId, demoId, s.guiaId],
      );

      const { rows } = await tx.query<{
        id: string;
        glosa_codigo: string;
        valor_glosa_cents: string;
      }>(
        `SELECT id, glosa_codigo, valor_glosa_cents
           FROM tiss.demonstrativo_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.glosa_codigo).toBe('M010');
      expect(Number(rows[0]!.valor_glosa_cents)).toBe(1000);
    });
  });

  it('insere item sem glosa (glosa_codigo e glosa_descricao null)', async () => {
    const demoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-DEMO-001', 'analise',
                 DATE '2026-08-05', 'demonstrativo/2026/08/sem-glosa.xml',
                 25000, 25000, 25000, 0, $4)`,
        [demoId, s.operadoraId, s.loteId, s.userId],
      );

      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents)
         VALUES ($1, $2, $3, 'DM001',
                 25000, 25000, 25000, 0)`,
        [itemId, demoId, s.guiaId],
      );

      const { rows } = await tx.query<{
        glosa_codigo: string | null;
        glosa_descricao: string | null;
      }>(
        `SELECT glosa_codigo, glosa_descricao
           FROM tiss.demonstrativo_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.glosa_codigo).toBeNull();
      expect(rows[0]!.glosa_descricao).toBeNull();
    });
  });

  // ── RLS ─────────────────────────────────────────────────────────────

  it('demonstrativo de outro tenant e invisivel via RLS', async () => {
    const demoId = uuidv7();
    // Insere como admin (sem RLS) em s.tenantId
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.demonstrativo
           (tenant_id, id, operadora_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-RLS', 'analise',
                 DATE '2026-08-07', 'demonstrativo/rls.xml',
                 5000, 5000, 5000, 0, $4)`,
        [s.tenantId, demoId, s.operadoraId, s.userId],
      );
    } finally {
      c.release();
      await admin.end();
    }

    // Cria actor de OUTRO tenant e tenta ler
    const otherTenantId = uuidv7();
    const otherUserId = uuidv7();
    const otherClinicId = uuidv7();
    const admin2 = new Pool({ connectionString: adminUrl(), max: 1 });
    const c2 = await admin2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant', '99ABC11222DE33')`,
        [otherTenantId, `ot-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade', '9911223', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User')`,
        [otherUserId, `${otherUserId}@example.test`],
      );
      await c2.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenantId, otherUserId, otherClinicId],
      );
      await c2.query('COMMIT');
    } catch (e) {
      await c2.query('ROLLBACK');
      throw e;
    } finally {
      c2.release();
      await admin2.end();
    }

    const otherActor: Actor = {
      kind: 'user',
      tenantId: otherTenantId,
      userId: otherUserId,
      clinicId: otherClinicId,
      requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que falha (tabela nao existe ainda).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/demonstrativo.int.test.ts 2>&1 | tail -20
```

Saida esperada: falha com `relation "tiss.demonstrativo" does not exist`.

---

### Task 2: migration 0123 — tabela tiss.demonstrativo

**Arquivos:**
- `packages/db/migrations/0123_tiss_demonstrativo.sql`

- [ ] Criar a migration que cria o enum `tiss.demonstrativo_kind`, a tabela `tiss.demonstrativo` com RLS forcada e policy, e os indices necessarios.

```sql
-- 0123_tiss_demonstrativo.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Demonstrativo de retorno TISS: resultado financeiro que a operadora devolve
-- ao prestador apos processar um lote. Pode ser de analise (pre-pagamento) ou
-- de pagamento (liquidacao). Um demonstrativo pode vir avulso (lote_id NULL)
-- ou vinculado a um lote previamente enviado.
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de tipo do demonstrativo
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.demonstrativo_kind AS ENUM ('analise', 'pagamento');

-- ---------------------------------------------------------------------------
-- 2. Tabela principal: tiss.demonstrativo
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.demonstrativo (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  operadora_id            uuid NOT NULL,
  lote_id                 uuid,
  protocolo_operadora     varchar NOT NULL,
  kind                    tiss.demonstrativo_kind NOT NULL,
  data_processamento      date NOT NULL,
  data_pagamento          date,
  xml_storage_key         text NOT NULL,
  total_apresentado_cents bigint NOT NULL CHECK (total_apresentado_cents >= 0),
  total_processado_cents  bigint NOT NULL CHECK (total_processado_cents >= 0),
  total_liberado_cents    bigint NOT NULL CHECK (total_liberado_cents >= 0),
  total_glosa_cents       bigint NOT NULL CHECK (total_glosa_cents >= 0),
  imported_at             timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  imported_by             uuid NOT NULL,

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, lote_id)
    REFERENCES tiss.lote(tenant_id, id),

  -- data_pagamento so faz sentido no demonstrativo de pagamento
  CHECK (
    (kind = 'pagamento' AND data_pagamento IS NOT NULL)
    OR (kind = 'analise' AND data_pagamento IS NULL)
  )
);
ALTER TABLE tiss.demonstrativo OWNER TO app_owner;
GRANT SELECT, INSERT ON tiss.demonstrativo TO app_rw;
GRANT SELECT, INSERT ON tiss.demonstrativo TO jobs;

-- Indices
CREATE INDEX ix_demonstrativo_operadora
  ON tiss.demonstrativo (tenant_id, operadora_id);

CREATE INDEX ix_demonstrativo_lote
  ON tiss.demonstrativo (tenant_id, lote_id)
  WHERE lote_id IS NOT NULL;

CREATE INDEX ix_demonstrativo_imported_at
  ON tiss.demonstrativo (tenant_id, imported_at DESC);

-- RLS
ALTER TABLE tiss.demonstrativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.demonstrativo FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.demonstrativo
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_bypass ON tiss.demonstrativo
  AS PERMISSIVE FOR ALL TO jobs
  USING (true) WITH CHECK (true);
```

- [ ] Rodar a migration.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate 2>&1 | tail -5
```

Saida esperada: migration 0123 aplicada com sucesso.

- [ ] Verificar que a tabela existe no banco.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'tiss' AND table_name = 'demonstrativo' ORDER BY ordinal_position" 2>&1
```

Saida esperada: 14 colunas listadas (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind, data_processamento, data_pagamento, xml_storage_key, total_apresentado_cents, total_processado_cents, total_liberado_cents, total_glosa_cents, imported_at, imported_by).

---

### Task 3: migration 0124 — tabela tiss.demonstrativo_item

**Arquivos:**
- `packages/db/migrations/0124_tiss_demonstrativo_item.sql`

- [ ] Criar a migration que cria a tabela `tiss.demonstrativo_item` com RLS forcada e policy.

```sql
-- 0124_tiss_demonstrativo_item.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Item do demonstrativo TISS: resultado financeiro de cada guia individual
-- dentro de um demonstrativo de retorno. Liga ao encounter_guia_consulta via
-- FK composta. O numero_guia_prestador e gravado para facilitar o match mesmo
-- quando a guia nao e encontrada no sistema (reconciliacao manual).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

CREATE TABLE tiss.demonstrativo_item (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  demonstrativo_id        uuid NOT NULL,
  guia_id                 uuid,
  numero_guia_prestador   varchar(20) NOT NULL,
  valor_apresentado_cents bigint NOT NULL CHECK (valor_apresentado_cents >= 0),
  valor_processado_cents  bigint NOT NULL CHECK (valor_processado_cents >= 0),
  valor_liberado_cents    bigint NOT NULL CHECK (valor_liberado_cents >= 0),
  valor_glosa_cents       bigint NOT NULL CHECK (valor_glosa_cents >= 0),
  glosa_codigo            varchar(4),
  glosa_descricao         text,

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, demonstrativo_id)
    REFERENCES tiss.demonstrativo(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id),

  -- glosa_codigo e glosa_descricao vivem ou morrem juntos
  CHECK (num_nonnulls(glosa_codigo, glosa_descricao) IN (0, 2))
);
ALTER TABLE tiss.demonstrativo_item OWNER TO app_owner;
GRANT SELECT, INSERT ON tiss.demonstrativo_item TO app_rw;
GRANT SELECT, INSERT ON tiss.demonstrativo_item TO jobs;

-- Indices
CREATE INDEX ix_demonstrativo_item_demo
  ON tiss.demonstrativo_item (tenant_id, demonstrativo_id);

CREATE INDEX ix_demonstrativo_item_guia
  ON tiss.demonstrativo_item (tenant_id, guia_id)
  WHERE guia_id IS NOT NULL;

-- RLS
ALTER TABLE tiss.demonstrativo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.demonstrativo_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.demonstrativo_item
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
CREATE POLICY jobs_bypass ON tiss.demonstrativo_item
  AS PERMISSIVE FOR ALL TO jobs
  USING (true) WITH CHECK (true);
```

- [ ] Rodar a migration.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate 2>&1 | tail -5
```

Saida esperada: migration 0124 aplicada com sucesso.

- [ ] Verificar que a tabela existe no banco.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'tiss' AND table_name = 'demonstrativo_item' ORDER BY ordinal_position" 2>&1
```

Saida esperada: 11 colunas listadas (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador, valor_apresentado_cents, valor_processado_cents, valor_liberado_cents, valor_glosa_cents, glosa_codigo, glosa_descricao).

---

### Task 4: privileges.json — GRANTs para tiss.demonstrativo e tiss.demonstrativo_item

**Arquivos:**
- `packages/db/privileges.json`

- [ ] Adicionar as entradas de GRANTs para as duas novas tabelas no `privileges.json`.

Adicionar as seguintes entradas ao objeto raiz do `privileges.json`, ordenadas alfabeticamente entre as entradas existentes de `tiss.*`:

```jsonc
// Adicionar apos "tiss.contrato" e antes de "tiss.encounter_guia_consulta":

  "tiss.demonstrativo": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT"
      ],
      "jobs": [
        "INSERT",
        "SELECT"
      ]
    }
  },
  "tiss.demonstrativo_item": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT"
      ],
      "jobs": [
        "INSERT",
        "SELECT"
      ]
    }
  },
```

- [ ] Rodar o invariante 10 (matriz CRUD) para confirmar que os GRANTs batem.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv10-crud-matrix.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

---

### Task 5: teste de integracao do demonstrativo passa apos as migrations

**Arquivos:**
- `packages/tiss/src/demonstrativo.int.test.ts` (ja criado na Task 1)

- [ ] Rodar o teste de integracao criado na Task 1 e confirmar que PASSA agora que as migrations existem.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/demonstrativo.int.test.ts 2>&1 | tail -20
```

Saida esperada: todos os 6 testes passam (3 de INSERT demonstrativo, 2 de INSERT demonstrativo_item, 1 de RLS).

- [ ] Rodar os invariantes 1 (RLS) e 2 (FK composta) para confirmar que as novas tabelas sao alcancadas.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts 2>&1 | tail -10
pnpm vitest run packages/db/src/invariants/inv02-fk.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam; as tabelas `tiss.demonstrativo` e `tiss.demonstrativo_item` aparecem na varredura.

---

### Task 6: transicao de lote para retornado ao importar demonstrativo vinculado

> **RECONCILIACAO**: Esta task define `importDemonstrativo` em `packages/tiss/src/import-demonstrativo.ts`
> com entrada pre-parseada. O bloco 02 define uma versao mais completa em
> `packages/tiss/src/demonstrativo/import-demonstrativo.ts` que parseia XML e depois insere.
> **O bloco 02 e a versao canonica** — esta task serve como referencia de logica de negocio
> (transicao de lote) e testes de integracao. Na implementacao, o export publico
> em `index.ts` deve vir de `./demonstrativo/import-demonstrativo` (bloco 02).

**Arquivos:**
- `packages/tiss/src/import-demonstrativo.ts`
- `packages/tiss/src/import-demonstrativo.int.test.ts`

Quando um demonstrativo e importado e vinculado a um lote (`lote_id IS NOT NULL`), o status do lote deve transitar para `retornado`. Usa `receiveLoteReturn` que ja existe em `lote-lifecycle.ts`.

- [ ] Criar o teste de integracao que verifica a transicao do lote.

```ts
// packages/tiss/src/import-demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { importDemonstrativo } from './import-demonstrativo';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent } from './lote-lifecycle';

interface SementeImport {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  guiaNumero: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearImport(): Promise<SementeImport> {
  const s: SementeImport = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    guiaNumero: `IMP-${uuidv7().slice(0, 10)}`,
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Import Demo', '55ABC66778DE99')`,
      [s.tenantId, `imp-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Import', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Import')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '445566', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Import', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Import', '88XYZ00002DE02', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    const encId = uuidv7();
    const verId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id, occurred_at, occurred_date)
       VALUES ($1, $2, $3, $4, $5, TIMESTAMPTZ '2026-08-01T10:00:00Z', DATE '2026-08-01')`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('imp1'::bytea), 'jcs-1')`,
      [s.tenantId, verId, encId, s.userId, profId],
    );
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
          '900123', '5566778', '06', '445566', 'SP', '225125', '9', '01',
          DATE '2026-08-01', '1', '22', '10101012', 250.00, true, $7)`,
      [s.tenantId, s.guiaId, encId, verId, s.operadoraId, s.guiaNumero, s.userId],
    );

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

describe('importacao de demonstrativo TISS', () => {
  let s: SementeImport;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearImport();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('importa demonstrativo vinculado a lote e transita lote para retornado', async () => {
    // Cria lote, adiciona guia, marca pronto, marca enviado
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;
    const loteId = lote.value.loteId;

    await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId: s.guiaId }),
    );
    await withTenantTx(actor, (tx) => markLoteReady(tx, loteId));
    await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-IMP-001',
        xmlStorageKey: 'lote/imp.xml',
        xmlHashMd5: 'aabbccddee0011223344556677889900',
      }),
    );

    // Importa demonstrativo
    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId,
        protocoloOperadora: 'PROT-IMP-001',
        kind: 'analise',
        dataProcessamento: '2026-08-05',
        xmlStorageKey: 'demonstrativo/2026/08/imp.xml',
        totalApresentadoCents: 25000,
        totalProcessadoCents: 24000,
        totalLiberadoCents: 24000,
        totalGlosaCents: 1000,
        importedBy: s.userId,
        items: [
          {
            guiaId: s.guiaId,
            numeroGuiaPrestador: s.guiaNumero,
            valorApresentadoCents: 25000,
            valorProcessadoCents: 24000,
            valorLiberadoCents: 24000,
            valorGlosaCents: 1000,
            glosaCodigo: 'M010',
            glosaDescricao: 'Procedimento nao coberto',
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.demonstrativoId).toBeTruthy();
    expect(result.value.loteRetornado).toBe(true);

    // Verifica que o lote transitou para retornado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`,
        [loteId],
      ),
    );
    expect(rows[0]!.status).toBe('retornado');
  });

  it('importa demonstrativo avulso sem transitar lote', async () => {
    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId: null,
        protocoloOperadora: 'PROT-AVULSO-IMP',
        kind: 'analise',
        dataProcessamento: '2026-08-06',
        xmlStorageKey: 'demonstrativo/2026/08/avulso-imp.xml',
        totalApresentadoCents: 10000,
        totalProcessadoCents: 9000,
        totalLiberadoCents: 9000,
        totalGlosaCents: 1000,
        importedBy: s.userId,
        items: [],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.loteRetornado).toBe(false);
  });

  it('recusa importacao quando lote nao esta em status enviado', async () => {
    // Cria lote em rascunho (sem enviar)
    const lote = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(lote.ok).toBe(true);
    if (!lote.ok) return;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId: lote.value.loteId,
        protocoloOperadora: 'PROT-FAIL',
        kind: 'analise',
        dataProcessamento: '2026-08-07',
        xmlStorageKey: 'demonstrativo/2026/08/fail.xml',
        totalApresentadoCents: 5000,
        totalProcessadoCents: 5000,
        totalLiberadoCents: 5000,
        totalGlosaCents: 0,
        importedBy: s.userId,
        items: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('lote_nao_enviado');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `import-demonstrativo` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/import-demonstrativo.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './import-demonstrativo'`.

- [ ] Criar a implementacao da funcao `importDemonstrativo`.

```ts
// packages/tiss/src/import-demonstrativo.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { receiveLoteReturn } from './lote-lifecycle';

export type ImportDemonstrativoFailure =
  | { kind: 'lote_nao_enviado' }
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'transicao_lote_falhou'; detalhe: string };

export interface ImportDemonstrativoInput {
  readonly operadoraId: string;
  readonly loteId: string | null;
  readonly protocoloOperadora: string;
  readonly kind: 'analise' | 'pagamento';
  readonly dataProcessamento: string;
  readonly dataPagamento?: string;
  readonly xmlStorageKey: string;
  readonly totalApresentadoCents: number;
  readonly totalProcessadoCents: number;
  readonly totalLiberadoCents: number;
  readonly totalGlosaCents: number;
  readonly importedBy: string;
  readonly items: readonly ImportDemonstrativoItem[];
}

export interface ImportDemonstrativoItem {
  readonly guiaId: string | null;
  readonly numeroGuiaPrestador: string;
  readonly valorApresentadoCents: number;
  readonly valorProcessadoCents: number;
  readonly valorLiberadoCents: number;
  readonly valorGlosaCents: number;
  readonly glosaCodigo?: string | null;
  readonly glosaDescricao?: string | null;
}

export interface ImportDemonstrativoResult {
  readonly demonstrativoId: string;
  readonly itemCount: number;
  readonly loteRetornado: boolean;
}

/**
 * Importa um demonstrativo de retorno TISS e seus itens na mesma transacao.
 * Quando vinculado a um lote (lote_id nao nulo), transita o lote para 'retornado'
 * via receiveLoteReturn. O lote PRECISA estar em status 'enviado'.
 */
export async function importDemonstrativo(
  tx: TxClient,
  i: ImportDemonstrativoInput,
): Promise<Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>> {
  // 1. Se vinculado a lote, valida que o lote existe e esta em status 'enviado'
  let loteRetornado = false;

  if (i.loteId !== null) {
    const { rows: loteRows } = await tx.query<{ status: string }>(
      `SELECT status FROM tiss.lote WHERE id = $1 FOR UPDATE`,
      [i.loteId],
    );
    if (loteRows.length === 0) {
      return err({ kind: 'lote_nao_encontrado' });
    }
    if (loteRows[0]!.status !== 'enviado') {
      return err({ kind: 'lote_nao_enviado' });
    }
  }

  // 2. Insere o demonstrativo
  const demonstrativoId = uuidv7();
  const dataPagamento = i.kind === 'pagamento' ? i.dataPagamento ?? null : null;

  await tx.query(
    `INSERT INTO tiss.demonstrativo
       (id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, data_pagamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by)
     VALUES ($1, $2, $3, $4, $5::tiss.demonstrativo_kind,
             $6::date, $7::date, $8,
             $9, $10, $11, $12, $13)`,
    [
      demonstrativoId, i.operadoraId, i.loteId, i.protocoloOperadora, i.kind,
      i.dataProcessamento, dataPagamento, i.xmlStorageKey,
      i.totalApresentadoCents, i.totalProcessadoCents,
      i.totalLiberadoCents, i.totalGlosaCents, i.importedBy,
    ],
  );

  // 3. Insere os itens
  for (const item of i.items) {
    const itemId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.demonstrativo_item
         (id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        itemId, demonstrativoId, item.guiaId, item.numeroGuiaPrestador,
        item.valorApresentadoCents, item.valorProcessadoCents,
        item.valorLiberadoCents, item.valorGlosaCents,
        item.glosaCodigo ?? null, item.glosaDescricao ?? null,
      ],
    );
  }

  // 4. Transita o lote para 'retornado' se vinculado
  if (i.loteId !== null) {
    const transicao = await receiveLoteReturn(tx, i.loteId);
    if (!transicao.ok) {
      return err({
        kind: 'transicao_lote_falhou',
        detalhe: transicao.error.kind,
      });
    }
    loteRetornado = true;
  }

  return ok({
    demonstrativoId,
    itemCount: i.items.length,
    loteRetornado,
  });
}
```

- [ ] Rodar o teste de integracao e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/import-demonstrativo.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 3 testes passam.

- [ ] Rodar a suite completa de invariantes e testes TISS para confirmar que nada quebrou.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/ 2>&1 | tail -10
pnpm vitest run packages/tiss/src/ 2>&1 | tail -10
```

Saida esperada: todos os testes passam.
### Task 7: tipos ParsedDemonstrativo e funcao decodeIso8859 com teste unitario

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`
- Criar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — criar o arquivo de tipos e a funcao `decodeIso8859` em `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`:

```ts
// packages/tiss/src/demonstrativo/parse-demonstrativo.ts

/**
 * Parser PURO e deterministico de XML de demonstrativo TISS.
 *
 * Recebe o XML em bytes ISO-8859-1 (como retornado por TissTransport.fetchDemonstrativo),
 * decodifica para string e extrai os campos estruturados. Sem I/O, sem side-effects.
 *
 * O parser usa extracao por regex para o subset limitado do XSD TISS — DOMParser
 * nao existe em Node.js e uma dependencia de parser XML completo e desnecessaria
 * para o formato previsivel e bem definido do demonstrativo TISS 4.01.00.
 */

// ---------------------------------------------------------------------------
// Tipos de saida
// ---------------------------------------------------------------------------

export interface ParsedDemonstrativoGlosa {
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
}

export interface ParsedDemonstrativoItem {
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora?: string;
  readonly valorInformadoCents: number;
  readonly valorProcessadoCents: number;
  readonly valorLiberadoCents: number;
  readonly valorGlosaCents: number;
  readonly glosas: readonly ParsedDemonstrativoGlosa[];
}

export interface ParsedDemonstrativoCabecalho {
  readonly registroANS: string;
  readonly numeroDemonstrativo: string;
  readonly dataProcessamento: string;
  readonly numeroProtocolo: string;
}

export interface ParsedDemonstrativo {
  readonly tipo: 'analise' | 'pagamento';
  readonly cabecalho: ParsedDemonstrativoCabecalho;
  readonly itens: readonly ParsedDemonstrativoItem[];
}

// ---------------------------------------------------------------------------
// Utilidade de decodificacao
// ---------------------------------------------------------------------------

/**
 * Decodifica bytes ISO-8859-1 para string JavaScript.
 *
 * Inversa de encodeIso8859 (packages/tiss/src/serializer/encode-iso8859.ts).
 * ISO-8859-1 mapeia bytes 0x00-0xFF diretamente para code points Unicode
 * correspondentes, o que TextDecoder('iso-8859-1') faz nativamente.
 */
export function decodeIso8859(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes);
}
```

- [ ] **Passo 2** — criar o teste unitario para `decodeIso8859` em `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`:

```ts
// packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
import { describe, expect, it } from 'vitest';
import { decodeIso8859 } from './parse-demonstrativo';
import { encodeIso8859 } from '../serializer/encode-iso8859';

describe('decodeIso8859', () => {
  it('decodifica bytes ASCII em string identica', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    expect(decodeIso8859(bytes)).toBe('Hello');
  });

  it('decodifica bytes acentuados ISO-8859-1 para caracteres corretos', () => {
    // e agudo = 0xE9, c cedilha = 0xE7, a til = 0xE3
    const bytes = new Uint8Array([0xE9, 0xE7, 0xE3]);
    expect(decodeIso8859(bytes)).toBe('éçã');
  });

  it('decodifica Uint8Array vazio em string vazia', () => {
    expect(decodeIso8859(new Uint8Array([]))).toBe('');
  });

  it('preserva roundtrip com encodeIso8859 para texto portugues', () => {
    const texto = 'Procedimento não autorizado pela clínica';
    const encoded = encodeIso8859(texto);
    expect(encoded.warnings).toHaveLength(0);
    expect(decodeIso8859(encoded.bytes)).toBe(texto);
  });
});
```

- [ ] **Passo 3** — rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 4 passed`.

- [ ] **Passo 4** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.ts \
       packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "feat(tiss): add ParsedDemonstrativo types and decodeIso8859 utility"
```

---

### Task 8: parseDemonstrativoXml — teste e implementacao com amostra de 3 guias

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`
- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`

- [ ] **Passo 1** — adicionar o teste de `parseDemonstrativoXml` com fixture de 3 guias (1 paga integral, 1 glosa parcial, 1 glosa total) em `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`. Adicionar o bloco abaixo APOS o `describe('decodeIso8859', ...)` existente:

```ts
// --- Adicionar ao final de parse-demonstrativo.test.ts ---
// Na linha de imports existente, adicionar parseDemonstrativoXml:
//   import { decodeIso8859, parseDemonstrativoXml } from './parse-demonstrativo';
// (encodeIso8859 ja foi importado no Passo 2 da Task 7)

/** Fixture: demonstrativo de analise com 3 guias de consulta. */
const SAMPLE_ANALISE = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-2026-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // --- Guia 1: paga integralmente, sem glosa ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // --- Guia 2: glosa parcial (R$ 50 de R$ 200) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:numeroGuiaOperadora>OP-5678</ans:numeroGuiaOperadora>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // --- Guia 3: glosa total (R$ 300 de R$ 300, 2 codigos de glosa) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto pelo plano</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc123</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

describe('parseDemonstrativoXml', () => {
  it('extrai cabecalho, 3 itens e glosas de demonstrativo de analise', () => {
    const encoded = encodeIso8859(SAMPLE_ANALISE);
    const result = parseDemonstrativoXml(encoded.bytes);

    // Tipo detectado a partir da tag demonstrativoAnaliseConta
    expect(result.tipo).toBe('analise');

    // Cabecalho extraido do bloco cabecalhoDemonstrativo (NAO do cabecalho da mensagem)
    expect(result.cabecalho.registroANS).toBe('326305');
    expect(result.cabecalho.numeroDemonstrativo).toBe('DEMO-2026-001');
    expect(result.cabecalho.dataProcessamento).toBe('2026-08-05');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-001');

    expect(result.itens).toHaveLength(3);

    // --- Guia 1: paga integralmente ---
    const g1 = result.itens[0]!;
    expect(g1.numeroGuiaPrestador).toBe('CY-001');
    expect(g1.numeroGuiaOperadora).toBeUndefined();
    expect(g1.valorInformadoCents).toBe(10000);
    expect(g1.valorProcessadoCents).toBe(10000);
    expect(g1.valorLiberadoCents).toBe(10000);
    expect(g1.valorGlosaCents).toBe(0);
    expect(g1.glosas).toHaveLength(0);

    // --- Guia 2: glosa parcial ---
    const g2 = result.itens[1]!;
    expect(g2.numeroGuiaPrestador).toBe('CY-002');
    expect(g2.numeroGuiaOperadora).toBe('OP-5678');
    expect(g2.valorInformadoCents).toBe(20000);
    expect(g2.valorProcessadoCents).toBe(15000);
    expect(g2.valorLiberadoCents).toBe(15000);
    expect(g2.valorGlosaCents).toBe(5000);
    expect(g2.glosas).toHaveLength(1);
    expect(g2.glosas[0]!.codigoGlosa).toBe('A010');
    expect(g2.glosas[0]!.descricaoGlosa).toBe('Valor acima do autorizado');

    // --- Guia 3: glosa total ---
    const g3 = result.itens[2]!;
    expect(g3.numeroGuiaPrestador).toBe('CY-003');
    expect(g3.valorInformadoCents).toBe(30000);
    expect(g3.valorProcessadoCents).toBe(0);
    expect(g3.valorLiberadoCents).toBe(0);
    expect(g3.valorGlosaCents).toBe(30000);
    expect(g3.glosas).toHaveLength(2);
    expect(g3.glosas[0]!.codigoGlosa).toBe('B015');
    expect(g3.glosas[0]!.descricaoGlosa).toBe('Procedimento nao coberto pelo plano');
    expect(g3.glosas[1]!.codigoGlosa).toBe('C020');
    expect(g3.glosas[1]!.descricaoGlosa).toBe('Guia vencida');
  });
});
```

- [ ] **Passo 2** — rodar o teste e confirmar que falha (a funcao `parseDemonstrativoXml` ainda nao existe):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: erro de compilacao ou `parseDemonstrativoXml is not a function`.

- [ ] **Passo 3** — implementar `parseDemonstrativoXml` em `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`. Adicionar o bloco abaixo apos a funcao `decodeIso8859`:

```ts
// --- Adicionar ao final de parse-demonstrativo.ts ---

// ---------------------------------------------------------------------------
// Helpers de extracao XML por regex
// ---------------------------------------------------------------------------

/**
 * Extrai o conteudo texto de uma tag folha (sem filhos).
 * Retorna undefined se a tag nao for encontrada.
 * O regex aceita tags com ou sem atributos.
 */
function extractTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`);
  const m = xml.match(re);
  return m?.[1];
}

/**
 * Extrai todos os blocos de conteudo de tags container (com filhos).
 * Usa match lazy para evitar capturar tags irmãs.
 *
 * LIMITACAO: nao suporta tags identicas aninhadas (ex: <a><a>...</a></a>).
 * O formato TISS nao tem tags identicas aninhadas, entao esta limitacao
 * e aceitavel para este parser de subset.
 */
function extractAllBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'g');
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result.push(m[1]!);
  }
  return result;
}

/**
 * Converte valor monetario no formato TISS (reais com 2 decimais) para centavos inteiros.
 * Ex: '150.00' -> 15000, '0.99' -> 99, '' -> 0
 */
function parseReaisToCentavos(valor: string): number {
  const trimmed = valor.trim();
  if (trimmed === '') return 0;
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) return Number(trimmed) * 100;
  const reais = Number(trimmed.slice(0, dotIndex));
  const decPart = trimmed.slice(dotIndex + 1).padEnd(2, '0').slice(0, 2);
  return reais * 100 + Number(decPart);
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

/**
 * Parseia XML de demonstrativo TISS (ISO-8859-1) em estrutura tipada.
 *
 * Funcao PURA e DETERMINISTICA. Recebe bytes ISO-8859-1, decodifica,
 * extrai os campos do demonstrativo de analise de conta ou de pagamento.
 *
 * Lanca Error se o XML nao contiver nenhum dos dois tipos de demonstrativo.
 */
export function parseDemonstrativoXml(xml: Uint8Array): ParsedDemonstrativo {
  const text = decodeIso8859(xml);

  // Detecta tipo pela presenca da tag container
  const isAnalise = text.includes('<ans:demonstrativoAnaliseConta');
  const isPagamento = text.includes('<ans:demonstrativoPagamento');

  if (!isAnalise && !isPagamento) {
    throw new Error(
      'XML nao contem demonstrativoAnaliseConta nem demonstrativoPagamento',
    );
  }

  const tipo: 'analise' | 'pagamento' = isAnalise ? 'analise' : 'pagamento';
  const demoTag = isAnalise
    ? 'ans:demonstrativoAnaliseConta'
    : 'ans:demonstrativoPagamento';

  // Extrai o bloco do demonstrativo (pode haver apenas 1 por mensagem TISS)
  const demoBlocks = extractAllBlocks(text, demoTag);
  if (demoBlocks.length === 0) {
    throw new Error(`Bloco <${demoTag}> nao encontrado no XML`);
  }
  const demo = demoBlocks[0]!;

  // Cabecalho — extraido de dentro do bloco demonstrativo, nao da mensagem TISS
  const registroANS = extractTag(demo, 'ans:registroANS') ?? '';
  const numeroDemonstrativo = extractTag(demo, 'ans:numeroDemonstrativo') ?? '';
  const dataProcessamento = extractTag(demo, 'ans:dataProcessamento') ?? '';
  const numeroProtocolo = extractTag(demo, 'ans:numeroProtocolo') ?? '';

  // Itens (guias) — cada <ans:guiaCabecalho> e um item
  const guiaBlocks = extractAllBlocks(demo, 'ans:guiaCabecalho');
  const itens: ParsedDemonstrativoItem[] = guiaBlocks.map(parseGuiaBlock);

  return {
    tipo,
    cabecalho: { registroANS, numeroDemonstrativo, dataProcessamento, numeroProtocolo },
    itens,
  };
}

function parseGuiaBlock(guiaXml: string): ParsedDemonstrativoItem {
  const numeroGuiaPrestador = extractTag(guiaXml, 'ans:numeroGuiaPrestador') ?? '';
  const numeroGuiaOperadora = extractTag(guiaXml, 'ans:numeroGuiaOperadora');
  const valorInformadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorInformadoGuia') ?? '0',
  );
  const valorProcessadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorProcessadoGuia') ?? '0',
  );
  const valorLiberadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorLiberadoGuia') ?? '0',
  );
  const valorGlosaCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorGlosaGuia') ?? '0',
  );

  // Glosas: extrai cada <ans:glosa> de dentro de <ans:glosas>.
  // O regex distingue corretamente <ans:glosa> de <ans:glosas> pelo '>' final.
  const glosaBlocks = extractAllBlocks(guiaXml, 'ans:glosa');
  const glosas: ParsedDemonstrativoGlosa[] = glosaBlocks.map((g) => ({
    codigoGlosa: extractTag(g, 'ans:codigoGlosa') ?? '',
    descricaoGlosa: extractTag(g, 'ans:descricaoGlosa') ?? '',
  }));

  return {
    numeroGuiaPrestador,
    ...(numeroGuiaOperadora !== undefined ? { numeroGuiaOperadora } : {}),
    valorInformadoCents,
    valorProcessadoCents,
    valorLiberadoCents,
    valorGlosaCents,
    glosas,
  };
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 5 passed` (4 do decodeIso8859 + 1 do parseDemonstrativoXml).

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.ts \
       packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "feat(tiss): implement parseDemonstrativoXml for TISS demonstrativo XML"
```

---

### Task 9: parseDemonstrativoXml — suporte a demonstrativo de pagamento e acentos ISO-8859-1

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — adicionar teste para demonstrativo de pagamento (tag `demonstrativoPagamento` em vez de `demonstrativoAnaliseConta`). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  // --- Adicionar dentro do describe('parseDemonstrativoXml') ---

  it('detecta tipo pagamento a partir da tag demonstrativoPagamento', () => {
    const xmlPagamento = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho>',
      '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-10</ans:dataGeracao>',
      '<ans:horaGeracao>14:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1000</ans:sequencialTransacao>',
      '</ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoPagamento>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>PAG-2026-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo>',
      '<ans:numeroProtocolo>PROT-PAG-001</ans:numeroProtocolo>',
      '</ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-10</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>PG-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>500.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>500.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoPagamento>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>def456</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlPagamento);
    const result = parseDemonstrativoXml(encoded.bytes);

    expect(result.tipo).toBe('pagamento');
    expect(result.cabecalho.numeroDemonstrativo).toBe('PAG-2026-001');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-PAG-001');
    expect(result.itens).toHaveLength(1);
    expect(result.itens[0]!.numeroGuiaPrestador).toBe('PG-001');
    expect(result.itens[0]!.valorInformadoCents).toBe(50000);
    expect(result.itens[0]!.valorGlosaCents).toBe(0);
  });
```

- [ ] **Passo 2** — adicionar teste para acentos ISO-8859-1 na descricao de glosa (bytes reais, nao UTF-8). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('decodifica acentos ISO-8859-1 na descricao de glosa', () => {
    const xmlComAcentos = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>AC-ACENTO</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-AC</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>AC-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>50.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>50.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
      '<ans:glosas><ans:glosa>',
      '<ans:codigoGlosa>X001</ans:codigoGlosa>',
      // 'nao' com til: n + a-til + o = caracteres ISO-8859-1 validos
      '<ans:descricaoGlosa>Procedimento não autorizado pela clínica</ans:descricaoGlosa>',
      '</ans:glosa></ans:glosas>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>xyz</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlComAcentos);
    expect(encoded.warnings).toHaveLength(0);

    const result = parseDemonstrativoXml(encoded.bytes);

    // Os acentos devem ser preservados apos decode ISO-8859-1
    expect(result.itens[0]!.glosas[0]!.descricaoGlosa).toBe(
      'Procedimento não autorizado pela clínica',
    );
  });
```

- [ ] **Passo 3** — rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 7 passed`.

- [ ] **Passo 4** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "test(tiss): add demonstrativoPagamento and ISO-8859-1 accent tests"
```

---

### Task 10: parseDemonstrativoXml — testes de borda e robustez

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — adicionar teste de erro para XML sem tag de demonstrativo. Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('lanca erro para XML sem tag de demonstrativo', () => {
    const xmlSemDemo = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao></ans:cabecalho>',
      '</ans:mensagemTISS>',
    ].join('\n');
    const encoded = encodeIso8859(xmlSemDemo);

    expect(() => parseDemonstrativoXml(encoded.bytes)).toThrow(
      'XML nao contem demonstrativoAnaliseConta nem demonstrativoPagamento',
    );
  });
```

- [ ] **Passo 2** — adicionar teste para demonstrativo com zero guias (relacaoGuias vazio). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('retorna itens vazio para demonstrativo sem guias', () => {
    const xmlSemGuias = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>VAZIO-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-V</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias></ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>vazio</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlSemGuias);
    const result = parseDemonstrativoXml(encoded.bytes);

    expect(result.tipo).toBe('analise');
    expect(result.cabecalho.numeroDemonstrativo).toBe('VAZIO-001');
    expect(result.itens).toHaveLength(0);
  });
```

- [ ] **Passo 3** — adicionar teste para valores monetarios com formatos variados. Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('converte valores monetarios com centavos fracionarios corretamente', () => {
    const xmlValores = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>VAL-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-VAL</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>VAL-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>0.99</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>1234.56</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>0.01</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>val</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlValores);
    const result = parseDemonstrativoXml(encoded.bytes);
    const item = result.itens[0]!;

    expect(item.valorInformadoCents).toBe(99);
    expect(item.valorProcessadoCents).toBe(123456);
    expect(item.valorLiberadoCents).toBe(1);
    expect(item.valorGlosaCents).toBe(0);
  });
```

- [ ] **Passo 4** — rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 10 passed`.

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "test(tiss): add edge case tests for parseDemonstrativoXml"
```

---

### Task 11: importDemonstrativo — tipos e implementacao

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/import-demonstrativo.ts`

- [ ] **Passo 1** — criar `packages/tiss/src/demonstrativo/import-demonstrativo.ts` com tipos e implementacao completa:

```ts
// packages/tiss/src/demonstrativo/import-demonstrativo.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { parseDemonstrativoXml, type ParsedDemonstrativo } from './parse-demonstrativo';
import { receiveLoteReturn } from '../lote-lifecycle';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ImportDemonstrativoInput {
  /** XML do demonstrativo em bytes ISO-8859-1. */
  readonly xml: Uint8Array;
  /** Id da operadora destino (FK obrigatoria em tiss.demonstrativo). */
  readonly operadoraId: string;
  /** Chave de storage do XML original (coluna xml_storage_key). */
  readonly xmlStorageKey: string;
  /** Se informado, atualiza o lote para status 'retornado'. */
  readonly loteId?: string;
}

export type ImportDemonstrativoFailure =
  | { kind: 'xml_invalido'; message: string }
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string };

export interface ImportDemonstrativoResult {
  /** Id do demonstrativo inserido. */
  readonly demonstrativoId: string;
  /** Quantidade de itens (guias) no demonstrativo. */
  readonly itemCount: number;
  /** Quantas guias foram vinculadas a encounter_guia_consulta existente. */
  readonly matchedCount: number;
  /** Valor total de glosa em centavos. */
  readonly totalGlosaCents: number;
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Importa um demonstrativo TISS para o banco de dados.
 *
 * (1) Chama parseDemonstrativoXml para extrair dados estruturados do XML.
 * (2) Para cada item, faz match de numero_guia_prestador com
 *     tiss.encounter_guia_consulta (RLS filtra por tenant automaticamente).
 * (3) Insere em tiss.demonstrativo e tiss.demonstrativo_item.
 * (4) Marca guias com glosa: o vinculo demonstrativo_item.guia_id +
 *     valor_glosa_cents > 0 constitui a marcacao de glosa na guia.
 * (5) Se loteId presente, atualiza lote.status para 'retornado' via
 *     receiveLoteReturn.
 *
 * As tabelas tiss.demonstrativo e tiss.demonstrativo_item sao criadas
 * pelo bloco 01-demonstrativo-migrations.
 */
export async function importDemonstrativo(
  tx: TxClient,
  input: ImportDemonstrativoInput,
  importedBy: string,
): Promise<Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>> {
  // 1. Parse XML
  let parsed: ParsedDemonstrativo;
  try {
    parsed = parseDemonstrativoXml(input.xml);
  } catch (e) {
    return err({
      kind: 'xml_invalido',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const demonstrativoId = uuidv7();
  const cab = parsed.cabecalho;

  // 2. Computa totais a partir dos itens parseados
  let totalApresentado = 0;
  let totalProcessado = 0;
  let totalLiberado = 0;
  let totalGlosa = 0;
  for (const item of parsed.itens) {
    totalApresentado += item.valorInformadoCents;
    totalProcessado += item.valorProcessadoCents;
    totalLiberado += item.valorLiberadoCents;
    totalGlosa += item.valorGlosaCents;
  }

  // 3. Insere cabecalho do demonstrativo (tenant_id vem do DEFAULT via RLS).
  //    Nomes de coluna seguem o schema canonico do bloco 01 (migration 0123).
  await tx.query(
    `INSERT INTO tiss.demonstrativo
       (id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by)
     VALUES ($1, $2, $3, $4, $5::tiss.demonstrativo_kind,
             $6::date, $7, $8, $9, $10, $11, $12)`,
    [
      demonstrativoId,
      input.operadoraId,
      input.loteId ?? null,
      cab.numeroProtocolo,
      parsed.tipo === 'analise' ? 'analise' : 'pagamento',
      cab.dataProcessamento,
      input.xmlStorageKey,
      totalApresentado,
      totalProcessado,
      totalLiberado,
      totalGlosa,
      importedBy,
    ],
  );

  // 4. Para cada item, faz match e insere demonstrativo_item
  let matchedCount = 0;
  for (const item of parsed.itens) {
    // Match por numero_guia_prestador na guia VIVA (RLS filtra por tenant)
    const { rows: guiaRows } = await tx.query<{ id: string }>(
      `SELECT id FROM tiss.encounter_guia_consulta
        WHERE numero_guia_prestador = $1 AND live = true`,
      [item.numeroGuiaPrestador],
    );
    const guiaId = guiaRows.length > 0 ? guiaRows[0]!.id : null;
    if (guiaId !== null) matchedCount++;

    // Nomes de coluna seguem o schema canonico do bloco 01 (migration 0124).
    // Glosa armazenada como par codigo+descricao (primeiro da lista parseada);
    // detalhes completos preservados no XML original (xml_storage_key).
    const primaryGlosa = item.glosas.length > 0 ? item.glosas[0]! : null;
    await tx.query(
      `INSERT INTO tiss.demonstrativo_item
         (id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv7(),
        demonstrativoId,
        guiaId,
        item.numeroGuiaPrestador,
        item.valorInformadoCents,
        item.valorProcessadoCents,
        item.valorLiberadoCents,
        item.valorGlosaCents,
        primaryGlosa?.codigoGlosa ?? null,
        primaryGlosa?.descricaoGlosa ?? null,
      ],
    );
  }

  // 5. Atualiza lote para 'retornado' se loteId presente
  if (input.loteId) {
    const loteResult = await receiveLoteReturn(tx, input.loteId);
    if (!loteResult.ok) {
      const e = loteResult.error;
      if (e.kind === 'lote_nao_encontrado') {
        return err({ kind: 'lote_nao_encontrado' });
      }
      if (e.kind === 'transicao_invalida') {
        return err({ kind: 'transicao_invalida', de: e.de, para: e.para });
      }
    }
  }

  return ok({
    demonstrativoId,
    itemCount: parsed.itens.length,
    matchedCount,
    totalGlosaCents: totalGlosa,
  });
}
```

- [ ] **Passo 2** — verificar que o arquivo compila sem erros de tipo:

```bash
pnpm tsc --noEmit -p packages/tiss/tsconfig.json 2>&1 | head -20
```

Saida esperada: sem erros de tipo (ou zero output).

- [ ] **Passo 3** — commitar:

```bash
git add packages/tiss/src/demonstrativo/import-demonstrativo.ts
git commit -m "feat(tiss): add importDemonstrativo function for demonstrativo TISS import"
```

---

### Task 12: importDemonstrativo — teste de integracao e exports no index.ts

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts`
- Modificar `packages/tiss/src/index.ts`

- [ ] **Passo 1** — criar o teste de integracao em `packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts`. O teste semeia 3 guias num lote enviado, importa o demonstrativo de amostra e verifica valores, vinculos e transicao de lote:

```ts
// packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import { importDemonstrativo } from './import-demonstrativo';

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------

interface SementeDemonstrativo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  loteId: string;
  guiaIds: string[];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDemonstrativo(): Promise<SementeDemonstrativo> {
  const s: SementeDemonstrativo = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- Infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Demo', '77ABC88899DE00')`,
      [s.tenantId, `demo-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Demo', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Admin Demo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Demo', 'completo')`,
      [s.tenantId, s.patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Demo', '66XYZ00005DE05', '4.01', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters com guias (numero_guia_prestador CY-001, CY-002, CY-003) ---
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, s.professionalId, `demo-${idx}`],
      );
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00112233445566', false,
                '900123', '7788990', '06', '777888', 'SP', '225125', '9', '01',
                DATE '2026-08-${dia}', '1', '22', '10101012',
                ${(idx + 1) * 100}.00, true, $7)`,
        [
          s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
          `CY-${String(idx + 1).padStart(3, '0')}`, s.userId,
        ],
      );
    }

    // --- Lote em status 'enviado' com as 3 guias ---
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, protocolo_operadora, sent_at,
          xml_storage_key, xml_hash_md5, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '4.01', 3, 60000,
               'PROT-001', clock_timestamp(),
               'lote/demo/001.xml', 'aabbccddaabbccddaabbccddaabbccdd', $4)`,
      [s.tenantId, s.loteId, s.operadoraId, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
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

// ---------------------------------------------------------------------------
// Fixture XML de demonstrativo (3 guias: paga, glosa parcial, glosa total)
// ---------------------------------------------------------------------------

const DEMONSTRATIVO_XML = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-INT-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // Guia CY-001: paga integralmente (R$ 100,00)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // Guia CY-002: glosa parcial (R$ 50 de R$ 200)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // Guia CY-003: glosa total (R$ 300)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('importDemonstrativo', () => {
  let s: SementeDemonstrativo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearDemonstrativo();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('importa demonstrativo com 3 guias, vincula guias e transiciona lote para retornado', async () => {
    const xmlBytes = encodeIso8859(DEMONSTRATIVO_XML).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(
        tx,
        { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/int-001.xml', loteId: s.loteId },
        s.userId,
      ),
    );

    // Resultado de sucesso
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(3);
    expect(result.value.matchedCount).toBe(3);
    expect(result.value.totalGlosaCents).toBe(35000); // 0 + 5000 + 30000

    const demoId = result.value.demonstrativoId;

    // --- Verificar tiss.demonstrativo (colunas canonicas do bloco 01) ---
    const demoRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        lote_id: string;
        protocolo_operadora: string;
        kind: string;
        total_apresentado_cents: string;
        total_processado_cents: string;
        total_liberado_cents: string;
        total_glosa_cents: string;
      }>(
        `SELECT id, lote_id, protocolo_operadora, kind,
                total_apresentado_cents, total_processado_cents,
                total_liberado_cents, total_glosa_cents
           FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      return rows[0];
    });

    expect(demoRow).toBeDefined();
    expect(demoRow!.lote_id).toBe(s.loteId);
    expect(demoRow!.protocolo_operadora).toBe('PROT-001');
    expect(demoRow!.kind).toBe('analise');
    expect(Number(demoRow!.total_apresentado_cents)).toBe(60000);
    expect(Number(demoRow!.total_processado_cents)).toBe(25000);
    expect(Number(demoRow!.total_glosa_cents)).toBe(35000);

    // --- Verificar tiss.demonstrativo_item (colunas canonicas do bloco 01) ---
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string | null;
        numero_guia_prestador: string;
        valor_apresentado_cents: string;
        valor_processado_cents: string;
        valor_glosa_cents: string;
        glosa_codigo: string | null;
        glosa_descricao: string | null;
      }>(
        `SELECT guia_id, numero_guia_prestador, valor_apresentado_cents,
                valor_processado_cents, valor_glosa_cents,
                glosa_codigo, glosa_descricao
           FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1
          ORDER BY numero_guia_prestador`,
        [demoId],
      );
      return rows;
    });

    expect(items).toHaveLength(3);

    // CY-001: paga, sem glosa, vinculada
    expect(items[0]!.numero_guia_prestador).toBe('CY-001');
    expect(items[0]!.guia_id).toBe(s.guiaIds[0]);
    expect(Number(items[0]!.valor_apresentado_cents)).toBe(10000);
    expect(Number(items[0]!.valor_glosa_cents)).toBe(0);
    expect(items[0]!.glosa_codigo).toBeNull();

    // CY-002: glosa parcial, vinculada (primeiro codigo de glosa armazenado)
    expect(items[1]!.numero_guia_prestador).toBe('CY-002');
    expect(items[1]!.guia_id).toBe(s.guiaIds[1]);
    expect(Number(items[1]!.valor_apresentado_cents)).toBe(20000);
    expect(Number(items[1]!.valor_processado_cents)).toBe(15000);
    expect(Number(items[1]!.valor_glosa_cents)).toBe(5000);
    expect(items[1]!.glosa_codigo).toBe('A010');
    expect(items[1]!.glosa_descricao).toBe('Valor acima do autorizado');

    // CY-003: glosa total, vinculada (primeiro codigo de glosa armazenado)
    expect(items[2]!.numero_guia_prestador).toBe('CY-003');
    expect(items[2]!.guia_id).toBe(s.guiaIds[2]);
    expect(Number(items[2]!.valor_apresentado_cents)).toBe(30000);
    expect(Number(items[2]!.valor_processado_cents)).toBe(0);
    expect(Number(items[2]!.valor_glosa_cents)).toBe(30000);
    expect(items[2]!.glosa_codigo).toBe('B015');
    expect(items[2]!.glosa_descricao).toBe('Procedimento nao coberto pelo plano');

    // --- Verificar transicao do lote para 'retornado' ---
    const loteStatus = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`,
        [s.loteId],
      );
      return rows[0]!.status;
    });

    expect(loteStatus).toBe('retornado');
  });

  it('importa demonstrativo sem loteId e nao altera nenhum lote', async () => {
    // Cria XML com guia que NAO existe no banco (sem vinculo)
    const xmlOrfa = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-06</ans:dataGeracao>',
      '<ans:horaGeracao>11:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>2</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>DEMO-ORFA</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-ORFA</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-06</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>INEXISTENTE-999</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>500.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>orfa</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const xmlBytes = encodeIso8859(xmlOrfa).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/orfa.xml' }, s.userId),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(1);
    expect(result.value.matchedCount).toBe(0); // guia nao encontrada
    expect(result.value.totalGlosaCents).toBe(50000);

    // Item inserido com guia_id NULL
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ guia_id: string | null }>(
        `SELECT guia_id FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1`,
        [result.value.demonstrativoId],
      );
      return rows;
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.guia_id).toBeNull();
  });

  it('retorna erro xml_invalido para XML malformado', async () => {
    const xmlInvalido = new TextEncoder().encode('isso nao e xml');

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlInvalido, operadoraId: s.operadoraId, xmlStorageKey: 'demo/invalid.xml' }, s.userId),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('xml_invalido');
  });
});
```

- [ ] **Passo 2** — adicionar exports ao `packages/tiss/src/index.ts`. Adicionar ao final do arquivo existente:

```ts
// --- Demonstrativo (Fase 5) ---
export {
  parseDemonstrativoXml,
  decodeIso8859,
  type ParsedDemonstrativo,
  type ParsedDemonstrativoCabecalho,
  type ParsedDemonstrativoItem,
  type ParsedDemonstrativoGlosa,
} from './demonstrativo/parse-demonstrativo';

export {
  importDemonstrativo,
  type ImportDemonstrativoInput,
  type ImportDemonstrativoResult,
  type ImportDemonstrativoFailure,
} from './demonstrativo/import-demonstrativo';
```

- [ ] **Passo 3** — rodar os testes unitarios (o teste de integracao depende das migrations do bloco 01):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 10 passed`.

- [ ] **Passo 4** — rodar o teste de integracao (requer migrations do bloco 01 aplicadas e DATABASE_URL_ADMIN configurado):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts
```

Saida esperada: `Tests: 3 passed` (apos aplicacao das migrations do bloco 01-demonstrativo-migrations).

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts \
       packages/tiss/src/index.ts
git commit -m "test(tiss): add importDemonstrativo integration test and export demonstrativo API"
```
### Task 13: migration 0125 — enum tiss.glosa_status + tabela tiss.glosa

**Arquivos:**
- `packages/db/migrations/0125_tiss_glosa.sql`
- `packages/db/privileges.json`

- [ ] Criar a migration que cria o enum `tiss.glosa_status` e a tabela `tiss.glosa` com RLS forcada, FK composta, indices e GRANTs.

```sql
-- 0125_tiss_glosa.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Glosa TISS: item glosado pela operadora em um demonstrativo de retorno.
-- Cada glosa vincula um demonstrativo_item a guia e a versao do prontuario
-- que gerou a guia glosada (Design §2.4 — recurso de glosa precisa reproduzir).
--
-- O codigo_glosa segue o padrao ANS (tabela de motivos de glosa, 4 caracteres).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de status da glosa
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.glosa_status AS ENUM (
  'pendente',    -- recem-criada a partir do demonstrativo
  'aceita',      -- clinica aceita a glosa (ou recurso indeferido)
  'contestada',  -- recurso de glosa em andamento
  'revertida'    -- recurso deferido, operadora devolveu o valor
);

-- ---------------------------------------------------------------------------
-- 2. Tabela principal: tiss.glosa
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.glosa (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  demonstrativo_item_id   uuid NOT NULL,
  guia_id                 uuid NOT NULL,
  encounter_version_id    uuid NOT NULL,
  codigo_glosa            varchar(4) NOT NULL,
  descricao_glosa         text NOT NULL,
  valor_glosado_cents     bigint NOT NULL CHECK (valor_glosado_cents > 0),
  status                  tiss.glosa_status NOT NULL DEFAULT 'pendente',
  resolved_at             timestamptz(3),
  resolved_by             uuid,
  created_at              timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, demonstrativo_item_id)
    REFERENCES tiss.demonstrativo_item(tenant_id, id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_consulta(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),

  -- resolved_at e resolved_by vivem ou morrem juntos, e so existem em aceita/revertida
  CHECK (
    (status IN ('aceita', 'revertida') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    OR (status IN ('pendente', 'contestada') AND resolved_at IS NULL AND resolved_by IS NULL)
  )
);
ALTER TABLE tiss.glosa OWNER TO app_owner;

-- Insercao e leitura livres; atualizacao restrita a status e resolucao
GRANT SELECT, INSERT ON tiss.glosa TO app_rw;
GRANT UPDATE (status, resolved_at, resolved_by) ON tiss.glosa TO app_rw;
GRANT SELECT ON tiss.glosa TO rpt_owner;

-- Indices
CREATE INDEX ix_glosa_demonstrativo_item
  ON tiss.glosa (tenant_id, demonstrativo_item_id);

CREATE INDEX ix_glosa_guia
  ON tiss.glosa (tenant_id, guia_id);

CREATE INDEX ix_glosa_pendente
  ON tiss.glosa (tenant_id, created_at DESC)
  WHERE status = 'pendente';

CREATE INDEX ix_glosa_status
  ON tiss.glosa (tenant_id, status);

-- RLS
ALTER TABLE tiss.glosa ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.glosa FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.glosa
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Adicionar a entrada de GRANTs para `tiss.glosa` no `privileges.json`, ordenada alfabeticamente entre as entradas existentes de `tiss.*` (apos `tiss.encounter_guia_consulta` e antes de `tiss.guia_ajuste`).

No arquivo `packages/db/privileges.json`, adicionar dentro do objeto raiz:

```jsonc
  "tiss.glosa": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT"
      ],
      "rpt_owner": [
        "SELECT"
      ]
    },
    "columns": {
      "app_rw": {
        "resolved_at": [
          "UPDATE"
        ],
        "resolved_by": [
          "UPDATE"
        ],
        "status": [
          "UPDATE"
        ]
      }
    }
  },
```

- [ ] Rodar a migration.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate 2>&1 | tail -5
```

Saida esperada: migration 0125 aplicada com sucesso.

- [ ] Verificar que a tabela existe no banco.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'tiss' AND table_name = 'glosa' ORDER BY ordinal_position" 2>&1
```

Saida esperada: 12 colunas listadas (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id, codigo_glosa, descricao_glosa, valor_glosado_cents, status, resolved_at, resolved_by, created_at).

- [ ] Rodar o invariante 10 (matriz CRUD) para confirmar que os GRANTs batem.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv10-crud-matrix.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/db/migrations/0125_tiss_glosa.sql packages/db/privileges.json
git commit -m "feat(db): add tiss.glosa table with RLS and FK composta (migration 0125)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 14: teste de integracao — tiss.glosa constraints, FK e RLS

**Arquivos:**
- `packages/tiss/src/glosa-model.int.test.ts`

- [ ] Criar o teste de integracao que verifica constraints, FK composta e isolamento RLS da tabela `tiss.glosa`.

```ts
// packages/tiss/src/glosa-model.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente para testes de glosa                                       */
/* ------------------------------------------------------------------ */

interface SementeGlosa {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  versionId: string;
  demonstrativoId: string;
  demonstrativoItemId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearGlosa(): Promise<SementeGlosa> {
  const s: SementeGlosa = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    versionId: uuidv7(),
    demonstrativoId: uuidv7(),
    demonstrativoItemId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clinica, usuario, membership, profissional, paciente ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Glosa Teste', '33ABC44556DE77')`,
      [s.tenantId, `gl-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Glosa', '3344556', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Glosa')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '334455', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Glosa', 'completo')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Glosa', '66XYZ00003DE03', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter finalizado + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-15T10:00:00Z', DATE '2026-07-15',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('glosa-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia de consulta ---
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'GL001', '00998877665544', false,
          '900123', '3344556', '06', '334455', 'SP', '225125', '9', '01',
          DATE '2026-07-15', '1', '22', '10101012', 250.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

    // --- lote enviado ---
    const loteId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 25000,
               'lote/glosa.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-GL-001', TIMESTAMPTZ '2026-07-16T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, s.guiaId],
    );

    // --- demonstrativo + demonstrativo_item ---
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-GL-001', 'analise',
               DATE '2026-07-20', 'demonstrativo/glosa.xml',
               25000, 18000, 18000, 7000, $5)`,
      [s.tenantId, s.demonstrativoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, 'GL001',
               25000, 18000, 18000, 7000,
               'M010', 'Procedimento nao coberto pelo contrato')`,
      [s.tenantId, s.demonstrativoItemId, s.demonstrativoId, s.guiaId],
    );

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

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('modelo de dados tiss.glosa', () => {
  let s: SementeGlosa;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  // ── INSERT valido ──────────────────────────────────────────────────

  it('insere glosa com todos os campos obrigatorios', async () => {
    const glosaId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.glosa
           (id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, 'M010', 'Procedimento nao coberto', 7000)`,
        [glosaId, s.demonstrativoItemId, s.guiaId, s.versionId],
      );

      const { rows } = await tx.query<{
        id: string;
        status: string;
        valor_glosado_cents: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT id, status, valor_glosado_cents, resolved_at, resolved_by
           FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('pendente');
      expect(Number(rows[0]!.valor_glosado_cents)).toBe(7000);
      expect(rows[0]!.resolved_at).toBeNull();
      expect(rows[0]!.resolved_by).toBeNull();
    });
  });

  // ── CHECK valor_glosado_cents > 0 ─────────────────────────────────

  it('rejeita glosa com valor_glosado_cents = 0', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'Zero', 0)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita glosa com valor_glosado_cents negativo', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'Negativo', -100)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // ── CHECK resolved_at / resolved_by consistencia ──────────────────

  it('rejeita glosa pendente com resolved_at preenchido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents,
              status, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, 'M010', 'Invalido', 1000,
                   'pendente', clock_timestamp(), $5)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita glosa aceita sem resolved_at', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents,
              status, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, 'M010', 'Sem data', 1000,
                   'aceita', NULL, NULL)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // ── FK demonstrativo_item inexistente ─────────────────────────────

  it('rejeita FK para demonstrativo_item inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK invalida', 500)`,
          [uuidv7(), uuidv7(), s.guiaId, s.versionId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // ── FK guia inexistente ───────────────────────────────────────────

  it('rejeita FK para guia inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK guia invalida', 500)`,
          [uuidv7(), s.demonstrativoItemId, uuidv7(), s.versionId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // ── FK encounter_version inexistente ──────────────────────────────

  it('rejeita FK para encounter_version inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.glosa
             (id, demonstrativo_item_id, guia_id, encounter_version_id,
              codigo_glosa, descricao_glosa, valor_glosado_cents)
           VALUES ($1, $2, $3, $4, 'M010', 'FK version invalida', 500)`,
          [uuidv7(), s.demonstrativoItemId, s.guiaId, uuidv7()],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // ── RLS: tenant B nao ve glosa do tenant A ────────────────────────

  it('glosa de outro tenant e invisivel via RLS', async () => {
    // Insere glosa no tenant A (via admin, sem RLS)
    const glosaId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, $5, 'M010', 'RLS teste', 5000)`,
        [s.tenantId, glosaId, s.demonstrativoItemId, s.guiaId, s.versionId],
      );
    } finally {
      c.release();
      await admin.end();
    }

    // Cria tenant B
    const otherTenantId = uuidv7();
    const otherUserId = uuidv7();
    const otherClinicId = uuidv7();
    const admin2 = new Pool({ connectionString: adminUrl(), max: 1 });
    const c2 = await admin2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant Glosa', '11ABC99888DE77')`,
        [otherTenantId, `otg-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade', '1199887', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User Glosa')`,
        [otherUserId, `${otherUserId}@example.test`],
      );
      await c2.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenantId, otherUserId, otherClinicId],
      );
      await c2.query('COMMIT');
    } catch (e) {
      await c2.query('ROLLBACK');
      throw e;
    } finally {
      c2.release();
      await admin2.end();
    }

    const otherActor: Actor = {
      kind: 'user',
      tenantId: otherTenantId,
      userId: otherUserId,
      clinicId: otherClinicId,
      requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que passa.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/glosa-model.int.test.ts 2>&1 | tail -20
```

Saida esperada: todos os 8 testes passam.

- [ ] Rodar os invariantes 1 (RLS) e 2 (FK composta) para confirmar que `tiss.glosa` e alcancada.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts 2>&1 | tail -10
pnpm vitest run packages/db/src/invariants/inv02-fk.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam; `tiss.glosa` aparece na varredura de RLS e FK composta.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/glosa-model.int.test.ts
git commit -m "test(tiss): add integration tests for tiss.glosa data model

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 15: migration 0126 — tiss.recurso_glosa, tiss.recurso_glosa_item e contador

**Arquivos:**
- `packages/db/migrations/0126_tiss_recurso_glosa.sql`
- `packages/db/privileges.json`

- [ ] Criar a migration que cria os enums, tabela de contador, funcao sequencial, `tiss.recurso_glosa` e `tiss.recurso_glosa_item` com RLS forcada, FK composta, indices e GRANTs.

```sql
-- 0126_tiss_recurso_glosa.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Recurso de glosa TISS e itens do recurso.
-- Design §3.9 — recurso de glosa sempre cita a encounter_version_id usada.
-- Design §2.4 — recurso de glosa precisa reproduzir o dado clinico.
--
-- O numero do recurso e sequencial por operadora dentro do tenant,
-- auto-provisionado na primeira criacao (mesmo padrao de tiss.lote_number_counter).
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. Enum de status do recurso de glosa
-- ---------------------------------------------------------------------------
CREATE TYPE tiss.recurso_glosa_status AS ENUM (
  'rascunho',       -- em edicao
  'pronto',         -- pronto para envio
  'enviado',        -- enviado a operadora
  'indeterminado',  -- timeout no envio SOAP, resultado desconhecido (bloco 04/06)
  'deferido',       -- recurso aceito pela operadora
  'indeferido',     -- recurso negado pela operadora
  'parcial'         -- recurso parcialmente aceito
);

-- ---------------------------------------------------------------------------
-- 2. Contador de numero de recurso por operadora (auto-provisionante)
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_number_counter (
  tenant_id    uuid NOT NULL,
  operadora_id uuid NOT NULL,
  next_value   bigint NOT NULL DEFAULT 2,
  PRIMARY KEY (tenant_id, operadora_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id)
);
ALTER TABLE tiss.recurso_number_counter OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.recurso_number_counter TO app_rw;

ALTER TABLE tiss.recurso_number_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_number_counter FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_number_counter
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 3. Funcao auto-provisionante: primeira chamada insere e devolve 1
-- ---------------------------------------------------------------------------
CREATE FUNCTION tiss.next_recurso_number(p_tenant_id uuid, p_operadora_id uuid)
RETURNS bigint LANGUAGE sql VOLATILE AS $$
  INSERT INTO tiss.recurso_number_counter (tenant_id, operadora_id, next_value)
  VALUES (p_tenant_id, p_operadora_id, 2)
  ON CONFLICT (tenant_id, operadora_id)
  DO UPDATE SET next_value = tiss.recurso_number_counter.next_value + 1
  RETURNING next_value - 1 $$;
ALTER FUNCTION tiss.next_recurso_number(uuid, uuid) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION tiss.next_recurso_number(uuid, uuid) TO app_rw;

-- ---------------------------------------------------------------------------
-- 4. Tabela principal: tiss.recurso_glosa
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_glosa (
  tenant_id               uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                      uuid NOT NULL,
  operadora_id            uuid NOT NULL,
  numero_recurso          varchar(20) NOT NULL,
  status                  tiss.recurso_glosa_status NOT NULL DEFAULT 'rascunho',
  justificativa_geral     text,
  encounter_version_id    uuid NOT NULL,
  xml_storage_key         text,
  protocolo_operadora     varchar,
  sent_at                 timestamptz(3),
  item_count              integer NOT NULL DEFAULT 0,
  total_recursado_cents   bigint NOT NULL DEFAULT 0,
  created_by              uuid NOT NULL,
  created_at              timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operadora_id, numero_recurso),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),

  -- sent_at so existe apos envio (inclui 'indeterminado' — timeout SOAP)
  CHECK (
    (status IN ('enviado', 'indeterminado', 'deferido', 'indeferido', 'parcial') AND sent_at IS NOT NULL)
    OR (status NOT IN ('enviado', 'indeterminado', 'deferido', 'indeferido', 'parcial') AND sent_at IS NULL)
  ),
  -- protocolo so existe apos envio (indeterminado pode nao ter protocolo)
  CHECK (
    (protocolo_operadora IS NOT NULL AND status IN ('enviado', 'deferido', 'indeferido', 'parcial'))
    OR protocolo_operadora IS NULL
  )
);
ALTER TABLE tiss.recurso_glosa OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON tiss.recurso_glosa TO app_rw;
GRANT SELECT ON tiss.recurso_glosa TO rpt_owner;

-- Indices
CREATE INDEX ix_recurso_glosa_operadora_status
  ON tiss.recurso_glosa (tenant_id, operadora_id, status);

CREATE INDEX ix_recurso_glosa_created_at
  ON tiss.recurso_glosa (tenant_id, created_at DESC);

-- RLS
ALTER TABLE tiss.recurso_glosa ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_glosa FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_glosa
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 5. Tabela de juncao: tiss.recurso_glosa_item
-- ---------------------------------------------------------------------------
CREATE TABLE tiss.recurso_glosa_item (
  tenant_id              uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                     uuid NOT NULL,
  recurso_id             uuid NOT NULL,
  glosa_id               uuid NOT NULL,
  justificativa_item     text NOT NULL,
  valor_recursado_cents  bigint NOT NULL CHECK (valor_recursado_cents > 0),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, recurso_id, glosa_id),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, recurso_id)
    REFERENCES tiss.recurso_glosa(tenant_id, id),
  FOREIGN KEY (tenant_id, glosa_id)
    REFERENCES tiss.glosa(tenant_id, id)
);
ALTER TABLE tiss.recurso_glosa_item OWNER TO app_owner;
GRANT SELECT, INSERT, DELETE ON tiss.recurso_glosa_item TO app_rw;
GRANT SELECT ON tiss.recurso_glosa_item TO rpt_owner;

-- Indices
CREATE INDEX ix_recurso_glosa_item_recurso
  ON tiss.recurso_glosa_item (tenant_id, recurso_id);

CREATE INDEX ix_recurso_glosa_item_glosa
  ON tiss.recurso_glosa_item (tenant_id, glosa_id);

-- RLS
ALTER TABLE tiss.recurso_glosa_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.recurso_glosa_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.recurso_glosa_item
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] Adicionar as entradas de GRANTs para as tres novas tabelas no `privileges.json`, ordenadas alfabeticamente entre as entradas existentes de `tiss.*`.

No arquivo `packages/db/privileges.json`, adicionar as seguintes entradas:

Apos `tiss.paciente_convenio`, adicionar:

```jsonc
  "tiss.recurso_glosa": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "rpt_owner": [
        "SELECT"
      ]
    }
  },
  "tiss.recurso_glosa_item": {
    "table": {
      "app_rw": [
        "DELETE",
        "INSERT",
        "SELECT"
      ],
      "rpt_owner": [
        "SELECT"
      ]
    }
  },
  "tiss.recurso_number_counter": {
    "table": {
      "app_rw": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ]
    }
  },
```

- [ ] Rodar a migration.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate 2>&1 | tail -5
```

Saida esperada: migration 0126 aplicada com sucesso.

- [ ] Verificar que as tabelas existem no banco.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:psql -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'tiss' AND table_name IN ('recurso_glosa', 'recurso_glosa_item', 'recurso_number_counter') ORDER BY table_name, ordinal_position" 2>&1
```

Saida esperada: colunas de `recurso_glosa` (12), `recurso_glosa_item` (6) e `recurso_number_counter` (3).

- [ ] Rodar o invariante 10 (matriz CRUD) para confirmar que os GRANTs batem.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv10-crud-matrix.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/db/migrations/0126_tiss_recurso_glosa.sql packages/db/privileges.json
git commit -m "feat(db): add tiss.recurso_glosa, recurso_glosa_item and counter (migration 0126)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 16: teste de integracao — tiss.recurso_glosa e tiss.recurso_glosa_item constraints e RLS

**Arquivos:**
- `packages/tiss/src/recurso-glosa-model.int.test.ts`

- [ ] Criar o teste de integracao que verifica constraints, FK composta, contador sequencial e isolamento RLS das tabelas `tiss.recurso_glosa` e `tiss.recurso_glosa_item`.

```ts
// packages/tiss/src/recurso-glosa-model.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

/* ------------------------------------------------------------------ */
/* Semente para testes de recurso de glosa                            */
/* ------------------------------------------------------------------ */

interface SementeRecurso {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  guiaId: string;
  versionId: string;
  glosaId: string;
  glosaId2: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearRecurso(): Promise<SementeRecurso> {
  const s: SementeRecurso = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    guiaId: uuidv7(),
    versionId: uuidv7(),
    glosaId: uuidv7(),
    glosaId2: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recurso Teste', '22ABC33445DE66')`,
      [s.tenantId, `rc-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Recurso', '2233445', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Recurso')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '223344', 'RJ', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Recurso', 'completo')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Recurso', '44XYZ00005DE05', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter finalizado + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-10T10:00:00Z', DATE '2026-07-10',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('rec-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia ---
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'RC001', '00998877665544', false,
          '900123', '2233445', '06', '223344', 'RJ', '225125', '9', '01',
          DATE '2026-07-10', '1', '22', '10101012', 250.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

    // --- lote enviado ---
    const loteId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 25000,
               'lote/rec.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-RC-001', TIMESTAMPTZ '2026-07-11T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, s.guiaId],
    );

    // --- demonstrativo + 2 itens com glosa ---
    const demoId = uuidv7();
    const demoItemId1 = uuidv7();
    const demoItemId2 = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RC-001', 'analise',
               DATE '2026-07-15', 'demonstrativo/rec.xml',
               25000, 15000, 15000, 10000, $5)`,
      [s.tenantId, demoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, 'RC001', 15000, 10000, 10000, 5000, 'M010', 'Nao coberto'),
              ($1, $5, $3, $4, 'RC001', 10000, 5000, 5000, 5000, 'A015', 'Fora de prazo')`,
      [s.tenantId, demoItemId1, demoId, s.guiaId, demoItemId2],
    );

    // --- 2 glosas pendentes ---
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents)
       VALUES ($1, $2, $3, $6, $7, 'M010', 'Procedimento nao coberto', 5000),
              ($1, $4, $5, $6, $7, 'A015', 'Guia fora do prazo', 5000)`,
      [s.tenantId, s.glosaId, demoItemId1, s.glosaId2, demoItemId2,
       s.guiaId, s.versionId],
    );

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

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('modelo de dados tiss.recurso_glosa e tiss.recurso_glosa_item', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecurso();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  // ── Contador sequencial ───────────────────────────────────────────

  it('contador retorna 1 na primeira chamada e incrementa', async () => {
    await withTenantTx(actor, async (tx) => {
      const { rows: r1 } = await tx.query<{ next_recurso_number: string }>(
        `SELECT tiss.next_recurso_number($1, $2) AS next_recurso_number`,
        [s.tenantId, s.operadoraId],
      );
      expect(Number(r1[0]!.next_recurso_number)).toBe(1);

      const { rows: r2 } = await tx.query<{ next_recurso_number: string }>(
        `SELECT tiss.next_recurso_number($1, $2) AS next_recurso_number`,
        [s.tenantId, s.operadoraId],
      );
      expect(Number(r2[0]!.next_recurso_number)).toBe(2);
    });
  });

  // ── INSERT recurso_glosa ──────────────────────────────────────────

  it('insere recurso de glosa em rascunho', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, justificativa_geral,
            encounter_version_id, created_by)
         VALUES ($1, $2, '3', 'Procedimento esta dentro da cobertura contratual',
                 $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );

      const { rows } = await tx.query<{
        id: string;
        status: string;
        sent_at: string | null;
        protocolo_operadora: string | null;
      }>(
        `SELECT id, status, sent_at, protocolo_operadora
           FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('rascunho');
      expect(rows[0]!.sent_at).toBeNull();
      expect(rows[0]!.protocolo_operadora).toBeNull();
    });
  });

  // ── CHECK sent_at em rascunho ─────────────────────────────────────

  it('rejeita recurso rascunho com sent_at preenchido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id,
              status, sent_at, created_by)
           VALUES ($1, $2, '99', $3, 'rascunho', clock_timestamp(), $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // ── CHECK enviado sem sent_at ─────────────────────────────────────

  it('rejeita recurso enviado sem sent_at', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id,
              status, sent_at, created_by)
           VALUES ($1, $2, '98', $3, 'enviado', NULL, $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ),
    ).rejects.toThrow(/check/i);
  });

  // ── UNIQUE numero_recurso por operadora ───────────────────────────

  it('rejeita numero_recurso duplicado na mesma operadora', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, 'UNICO01', $3, $4)`,
        [uuidv7(), s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa
             (id, operadora_id, numero_recurso, encounter_version_id, created_by)
           VALUES ($1, $2, 'UNICO01', $3, $4)`,
          [uuidv7(), s.operadoraId, s.versionId, s.userId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  // ── INSERT recurso_glosa_item ─────────────────────────────────────

  it('insere item de recurso vinculando glosa', async () => {
    const recursoId = uuidv7();
    const itemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '4', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Procedimento coberto conforme clausula 5.2 do contrato', 5000)`,
        [itemId, recursoId, s.glosaId],
      );

      const { rows } = await tx.query<{
        id: string;
        justificativa_item: string;
        valor_recursado_cents: string;
      }>(
        `SELECT id, justificativa_item, valor_recursado_cents
           FROM tiss.recurso_glosa_item WHERE id = $1`,
        [itemId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.justificativa_item).toContain('clausula 5.2');
      expect(Number(rows[0]!.valor_recursado_cents)).toBe(5000);
    });
  });

  // ── CHECK valor_recursado_cents > 0 ───────────────────────────────

  it('rejeita item com valor_recursado_cents = 0', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '5', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'Zero', 0)`,
          [uuidv7(), recursoId, s.glosaId],
        ),
      ).rejects.toThrow(/check/i);
    });
  });

  // ── UNIQUE recurso_id + glosa_id ──────────────────────────────────

  it('rejeita mesma glosa duplicada no mesmo recurso', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '6', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Primeira inclusao', 3000)`,
        [uuidv7(), recursoId, s.glosaId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'Duplicata', 2000)`,
          [uuidv7(), recursoId, s.glosaId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  // ── FK recurso inexistente ────────────────────────────────────────

  it('rejeita FK para recurso inexistente', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'FK invalida', 1000)`,
          [uuidv7(), uuidv7(), s.glosaId],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  // ── FK glosa inexistente ──────────────────────────────────────────

  it('rejeita FK para glosa inexistente', async () => {
    const recursoId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, '7', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await expect(
        tx.query(
          `INSERT INTO tiss.recurso_glosa_item
             (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
           VALUES ($1, $2, $3, 'FK glosa invalida', 1000)`,
          [uuidv7(), recursoId, uuidv7()],
        ),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  // ── RLS: tenant B nao ve recurso do tenant A ─────────────────────

  it('recurso de outro tenant e invisivel via RLS', async () => {
    const recursoId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query(
        `INSERT INTO tiss.recurso_glosa
           (tenant_id, id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, $3, '8', $4, $5)`,
        [s.tenantId, recursoId, s.operadoraId, s.versionId, s.userId],
      );
    } finally {
      c.release();
      await admin.end();
    }

    // Cria tenant B
    const otherTenantId = uuidv7();
    const otherUserId = uuidv7();
    const otherClinicId = uuidv7();
    const admin2 = new Pool({ connectionString: adminUrl(), max: 1 });
    const c2 = await admin2.connect();
    try {
      await c2.query('BEGIN');
      await c2.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, $2, 'Outro Tenant Recurso', '88ABC77666DE55')`,
        [otherTenantId, `otr-${otherTenantId}`],
      );
      await c2.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
         VALUES ($1, $2, 'Outra Unidade R', '8877665', 'America/Sao_Paulo')`,
        [otherTenantId, otherClinicId],
      );
      await c2.query(
        `INSERT INTO id."user" (id, email, full_name)
         VALUES ($1, $2, 'Outro User Recurso')`,
        [otherUserId, `${otherUserId}@example.test`],
      );
      await c2.query(
        `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
         VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
        [otherTenantId, otherUserId, otherClinicId],
      );
      await c2.query('COMMIT');
    } catch (e) {
      await c2.query('ROLLBACK');
      throw e;
    } finally {
      c2.release();
      await admin2.end();
    }

    const otherActor: Actor = {
      kind: 'user',
      tenantId: otherTenantId,
      userId: otherUserId,
      clinicId: otherClinicId,
      requestId: uuidv7(),
    };

    const { rows } = await withTenantTx(otherActor, (tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que passa.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa-model.int.test.ts 2>&1 | tail -20
```

Saida esperada: todos os 10 testes passam.

- [ ] Rodar os invariantes 1 (RLS) e 2 (FK composta) para confirmar que as novas tabelas sao alcancadas.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts 2>&1 | tail -10
pnpm vitest run packages/db/src/invariants/inv02-fk.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam; `tiss.recurso_glosa`, `tiss.recurso_glosa_item` e `tiss.recurso_number_counter` aparecem na varredura.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa-model.int.test.ts
git commit -m "test(tiss): add integration tests for recurso_glosa data model

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 17: funcao resolveRecurso — teste que falha primeiro, depois implementacao

> **RECONCILIACAO**: Esta task define `resolveRecurso` em `packages/tiss/src/resolve-recurso.ts`
> como funcao standalone. O bloco 04 define o ciclo de vida completo do recurso em
> `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` incluindo `resolveRecurso`.
> **O bloco 04 e o dono do dominio** — esta task serve como referencia de regra de negocio
> e testes de integracao para a resolucao. Na implementacao, a logica de resolucao
> pode ser integrada no lifecycle do bloco 04.

**Arquivos:**
- `packages/tiss/src/resolve-recurso.ts`
- `packages/tiss/src/resolve-recurso.int.test.ts`

Esta funcao implementa a regra de negocio: quando o recurso e deferido, as glosas vinculadas transitam para `revertida`; quando indeferido, transitam para `aceita`; quando parcial, cada item e marcado individualmente. O bloco 04 (dominio do recurso) consome esta funcao.

- [ ] Criar o teste de integracao que falha (a funcao ainda nao existe).

```ts
// packages/tiss/src/resolve-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveRecurso } from './resolve-recurso';

/* ------------------------------------------------------------------ */
/* Semente para testes de resolucao de recurso                        */
/* ------------------------------------------------------------------ */

interface SementeResolve {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  versionId: string;
  glosaIdA: string;
  glosaIdB: string;
  glosaIdC: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearResolve(): Promise<SementeResolve> {
  const s: SementeResolve = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    versionId: uuidv7(),
    glosaIdA: uuidv7(),
    glosaIdB: uuidv7(),
    glosaIdC: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Resolve', '55ABC66778DE99')`,
      [s.tenantId, `rv-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Resolve', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Resolve')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '556677', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Resolve', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Resolve', '77XYZ00006DE06', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- encounter + version ---
    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-07-01T10:00:00Z', DATE '2026-07-01',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('resolve-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    // --- guia ---
    const guiaId = uuidv7();
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'RV001', '00998877665544', false,
          '900123', '5566778', '06', '556677', 'SP', '225125', '9', '01',
          DATE '2026-07-01', '1', '22', '10101012', 300.00, true, $6)`,
      [s.tenantId, guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

    // --- lote + demonstrativo + 3 itens + 3 glosas ---
    const loteId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 30000,
               'lote/rv.xml', 'aabbccdd00112233aabbccdd00112233',
               'PROT-RV', TIMESTAMPTZ '2026-07-02T10:00:00Z', $4)`,
      [s.tenantId, loteId, s.operadoraId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [s.tenantId, loteId, guiaId],
    );

    const demoId = uuidv7();
    const diA = uuidv7();
    const diB = uuidv7();
    const diC = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RV', 'analise',
               DATE '2026-07-10', 'demo/rv.xml',
               30000, 15000, 15000, 15000, $5)`,
      [s.tenantId, demoId, s.operadoraId, loteId, s.userId],
    );
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $6, $7, 'RV001', 10000, 5000, 5000, 5000, 'M010', 'Nao coberto'),
              ($1, $3, $6, $7, 'RV001', 10000, 5000, 5000, 5000, 'A015', 'Fora de prazo'),
              ($1, $4, $6, $7, 'RV001', 10000, 5000, 5000, 5000, 'B001', 'Duplicidade')`,
      [s.tenantId, diA, diB, diC, s.userId, demoId, guiaId],
    );

    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents)
       VALUES ($1, $2, $5, $8, $9, 'M010', 'Nao coberto', 5000),
              ($1, $3, $6, $8, $9, 'A015', 'Fora de prazo', 5000),
              ($1, $4, $7, $8, $9, 'B001', 'Duplicidade', 5000)`,
      [s.tenantId, s.glosaIdA, s.glosaIdB, s.glosaIdC,
       diA, diB, diC, guiaId, s.versionId],
    );

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

/* ------------------------------------------------------------------ */
/* Funcao auxiliar: cria recurso enviado com itens                     */
/* ------------------------------------------------------------------ */

async function criarRecursoEnviado(
  actor: Actor,
  s: SementeResolve,
  glosaIds: string[],
  numero: string,
): Promise<string> {
  const recursoId = uuidv7();
  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO tiss.recurso_glosa
         (id, operadora_id, numero_recurso, justificativa_geral,
          encounter_version_id, status, protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, 'Justificativa geral do recurso',
               $4, 'enviado', 'PROT-REC-001', clock_timestamp(), $5)`,
      [recursoId, s.operadoraId, numero, s.versionId, s.userId],
    );
    for (let i = 0; i < glosaIds.length; i++) {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, $4, 5000)`,
        [uuidv7(), recursoId, glosaIds[i], `Justificativa item ${i + 1}`],
      );
    }
    // Marca glosas como contestada
    for (const glosaId of glosaIds) {
      await tx.query(
        `UPDATE tiss.glosa SET status = 'contestada' WHERE id = $1`,
        [glosaId],
      );
    }
  });
  return recursoId;
}

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('resolveRecurso — transicao de status das glosas', () => {
  let s: SementeResolve;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearResolve();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('deferido — todas as glosas vinculadas transitam para revertida', async () => {
    const recursoId = await criarRecursoEnviado(
      actor, s, [s.glosaIdA, s.glosaIdB], 'DEF01',
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(true);

    // Verifica status do recurso
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('deferido');
    });

    // Verifica status das glosas
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        status: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT id, status, resolved_at, resolved_by FROM tiss.glosa
          WHERE id IN ($1, $2) ORDER BY id`,
        [s.glosaIdA, s.glosaIdB],
      );
      for (const row of rows) {
        expect(row.status).toBe('revertida');
        expect(row.resolved_at).not.toBeNull();
        expect(row.resolved_by).toBe(s.userId);
      }
    });
  });

  it('indeferido — todas as glosas vinculadas transitam para aceita', async () => {
    // Precisa de novas glosas para este teste (as anteriores ja foram resolvidas)
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const glosaD = uuidv7();
    const glosaE = uuidv7();
    const diD = uuidv7();
    const diE = uuidv7();
    const guiaId = uuidv7();
    try {
      // Reusar a guia existente para FK; criar novos demonstrativo_items e glosas
      // Buscar guia_id existente do tenant
      const { rows: guiaRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingGuiaId = guiaRows[0]!.id;

      // Buscar demonstrativo existente
      const { rows: demoRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingDemoId = demoRows[0]!.id;

      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $5, $6, 'RV001', 8000, 3000, 3000, 5000, 'X001', 'Motivo D'),
                ($1, $3, $5, $6, 'RV001', 8000, 3000, 3000, 5000, 'X002', 'Motivo E')`,
        [s.tenantId, diD, diE, s.userId, existingDemoId, existingGuiaId],
      );
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $4, $6, $7, 'X001', 'Motivo D', 5000),
                ($1, $3, $5, $6, $7, 'X002', 'Motivo E', 5000)`,
        [s.tenantId, glosaD, glosaE, diD, diE, existingGuiaId, s.versionId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const recursoId = await criarRecursoEnviado(
      actor, s, [glosaD, glosaE], 'IND01',
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'indeferido' }, s.userId),
    );
    expect(r.ok).toBe(true);

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('indeferido');
    });

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id IN ($1, $2) ORDER BY id`,
        [glosaD, glosaE],
      );
      for (const row of rows) {
        expect(row.status).toBe('aceita');
      }
    });
  });

  it('parcial — cada glosa marcada individualmente', async () => {
    // Reusar glosaIdC que ainda esta pendente
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    const glosaF = uuidv7();
    const diF = uuidv7();
    try {
      const { rows: guiaRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingGuiaId = guiaRows[0]!.id;
      const { rows: demoRows } = await c.query<{ id: string }>(
        `SELECT id FROM tiss.demonstrativo WHERE tenant_id = $1 LIMIT 1`,
        [s.tenantId],
      );
      const existingDemoId = demoRows[0]!.id;

      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, $4, 'RV001', 6000, 2000, 2000, 4000, 'Y001', 'Motivo F')`,
        [s.tenantId, diF, existingDemoId, existingGuiaId],
      );
      await c.query(
        `INSERT INTO tiss.glosa
           (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, $5, 'Y001', 'Motivo F', 4000)`,
        [s.tenantId, glosaF, diF, existingGuiaId, s.versionId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    const recursoId = await criarRecursoEnviado(
      actor, s, [s.glosaIdC, glosaF], 'PAR01',
    );

    // Buscar os item ids
    const itemIds = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string; glosa_id: string }>(
        `SELECT id, glosa_id FROM tiss.recurso_glosa_item
          WHERE recurso_id = $1 ORDER BY glosa_id`,
        [recursoId],
      );
      return rows;
    });

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(
        tx,
        recursoId,
        {
          resultado: 'parcial',
          itens: [
            { recursoItemId: itemIds.find((i) => i.glosa_id === s.glosaIdC)!.id, deferido: true },
            { recursoItemId: itemIds.find((i) => i.glosa_id === glosaF)!.id, deferido: false },
          ],
        },
        s.userId,
      ),
    );
    expect(r.ok).toBe(true);

    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('parcial');
    });

    // glosaIdC deferida → revertida
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [s.glosaIdC],
      );
      expect(rows[0]!.status).toBe('revertida');
    });

    // glosaF indeferida → aceita
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [glosaF],
      );
      expect(rows[0]!.status).toBe('aceita');
    });
  });

  it('retorna erro para recurso nao encontrado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, uuidv7(), { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('recurso_nao_encontrado');
  });

  it('retorna erro para recurso que nao esta em status enviado', async () => {
    // Criar recurso em rascunho (nao enviado)
    const recursoId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, encounter_version_id, created_by)
         VALUES ($1, $2, 'RASC01', $3, $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      ),
    );

    const r = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('transicao_invalida');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (a funcao `resolveRecurso` ainda nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/resolve-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './resolve-recurso'` ou erro de import.

- [ ] Implementar a funcao `resolveRecurso`.

```ts
// packages/tiss/src/resolve-recurso.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { resultado: 'deferido' }
  | { resultado: 'indeferido' }
  | { resultado: 'parcial'; itens: Array<{ recursoItemId: string; deferido: boolean }> };

export type ResolveRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; statusAtual: string }
  | { kind: 'itens_obrigatorios_para_parcial' };

export interface ResolveRecursoResult {
  readonly recursoId: string;
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Resolve um recurso de glosa com o resultado da operadora.
 *
 * - deferido:   todas as glosas vinculadas transitam para `revertida`
 * - indeferido: todas as glosas vinculadas transitam para `aceita`
 * - parcial:    cada item e marcado individualmente (deferido -> revertida, nao -> aceita)
 *
 * Design §3.9 — recurso de glosa sempre cita a versao usada.
 * O recurso precisa estar em status `enviado` para ser resolvido.
 */
export async function resolveRecurso(
  tx: TxClient,
  recursoId: string,
  resultado: ResolveResult,
  resolvedBy: string,
): Promise<Result<ResolveRecursoResult, ResolveRecursoFailure>> {
  // 1. Busca o recurso e valida que esta em status enviado
  const { rows: recursoRows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );

  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }

  const recurso = recursoRows[0]!;
  if (recurso.status !== 'enviado') {
    return err({ kind: 'transicao_invalida', statusAtual: recurso.status });
  }

  // 2. Atualiza o status do recurso
  await tx.query(
    `UPDATE tiss.recurso_glosa SET status = $2::tiss.recurso_glosa_status WHERE id = $1`,
    [recursoId, resultado.resultado],
  );

  // 3. Atualiza as glosas conforme o resultado
  if (resultado.resultado === 'deferido') {
    // Todas as glosas vinculadas transitam para revertida
    await tx.query(
      `UPDATE tiss.glosa g
          SET status = 'revertida',
              resolved_at = clock_timestamp(),
              resolved_by = $2
        WHERE g.id IN (
          SELECT ri.glosa_id FROM tiss.recurso_glosa_item ri
           WHERE ri.recurso_id = $1
        )`,
      [recursoId, resolvedBy],
    );
  } else if (resultado.resultado === 'indeferido') {
    // Todas as glosas vinculadas transitam para aceita
    await tx.query(
      `UPDATE tiss.glosa g
          SET status = 'aceita',
              resolved_at = clock_timestamp(),
              resolved_by = $2
        WHERE g.id IN (
          SELECT ri.glosa_id FROM tiss.recurso_glosa_item ri
           WHERE ri.recurso_id = $1
        )`,
      [recursoId, resolvedBy],
    );
  } else {
    // parcial: cada item e marcado individualmente
    if (!resultado.itens || resultado.itens.length === 0) {
      return err({ kind: 'itens_obrigatorios_para_parcial' });
    }

    for (const item of resultado.itens) {
      // Busca o glosa_id a partir do recurso_item_id
      const { rows: itemRows } = await tx.query<{ glosa_id: string }>(
        `SELECT glosa_id FROM tiss.recurso_glosa_item
          WHERE id = $1 AND recurso_id = $2`,
        [item.recursoItemId, recursoId],
      );

      if (itemRows.length > 0) {
        const newStatus = item.deferido ? 'revertida' : 'aceita';
        await tx.query(
          `UPDATE tiss.glosa
              SET status = $2::tiss.glosa_status,
                  resolved_at = clock_timestamp(),
                  resolved_by = $3
            WHERE id = $1`,
          [itemRows[0]!.glosa_id, newStatus, resolvedBy],
        );
      }
    }
  }

  return ok({ recursoId });
}
```

- [ ] Rodar o teste e confirmar que passa.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/resolve-recurso.int.test.ts 2>&1 | tail -20
```

Saida esperada: todos os 5 testes passam.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/resolve-recurso.ts packages/tiss/src/resolve-recurso.int.test.ts
git commit -m "feat(tiss): add resolveRecurso function for glosa status transitions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 18: teste de integracao — ciclo completo e invariantes CI

**Arquivos:**
- `packages/tiss/src/glosa-lifecycle.int.test.ts`

Este teste verifica o ciclo completo: demonstrativo importado com glosa → glosa criada → recurso criado com itens → recurso resolvido → status das glosas atualizado. Tambem roda os invariantes de CI para garantir que as novas tabelas estao no escopo.

- [ ] Criar o teste de integracao do ciclo completo.

```ts
// packages/tiss/src/glosa-lifecycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveRecurso } from './resolve-recurso';

/* ------------------------------------------------------------------ */
/* Semente para teste de ciclo completo                               */
/* ------------------------------------------------------------------ */

interface SementeCiclo {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  versionId: string;
  guiaId: string;
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
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    versionId: uuidv7(),
    guiaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Ciclo Glosa', '44ABC55667DE88')`,
      [s.tenantId, `cg-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Ciclo', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Ciclo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    const profId = uuidv7();
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '667788', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    const patientId = uuidv7();
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Ciclo', 'completo')`,
      [s.tenantId, patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Ciclo', '99XYZ00007DE07', '3.05', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    const encId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5,
               TIMESTAMPTZ '2026-06-15T10:00:00Z', DATE '2026-06-15',
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, encId, patientId, profId, s.clinicId],
    );
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256('ciclo-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, encId, s.userId, profId],
    );
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1 WHERE id = $2`,
      [s.versionId, encId],
    );

    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
          uf_conselho, cbos, indicacao_acidente, regime_atendimento,
          data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, live, created_by)
       VALUES ($1, $2, $3, $4, $5, '326305', 'CG001', '00998877665544', false,
          '900123', '4455667', '06', '667788', 'SP', '225125', '9', '01',
          DATE '2026-06-15', '1', '22', '10101012', 300.00, true, $6)`,
      [s.tenantId, s.guiaId, encId, s.versionId, s.operadoraId, s.userId],
    );

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

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

describe('ciclo completo: demonstrativo → glosa → recurso → resolucao', () => {
  let s: SementeCiclo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearCiclo();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('ciclo: lote enviado → demonstrativo importado → glosa criada → recurso → deferido → glosa revertida', async () => {
    // 1. Criar lote enviado
    const loteId = uuidv7();
    const admin = new Pool({ connectionString: adminUrl(), max: 1 });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
            protocolo_operadora, sent_at, created_by)
         VALUES ($1, $2, $3, '1', 'enviado', '3.05', 1, 30000,
                 'lote/ciclo.xml', 'aabbccdd00112233aabbccdd00112233',
                 'PROT-CG', TIMESTAMPTZ '2026-06-16T10:00:00Z', $4)`,
        [s.tenantId, loteId, s.operadoraId, s.userId],
      );
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s.tenantId, loteId, s.guiaId],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
      await admin.end();
    }

    // 2. Importar demonstrativo com glosa
    const demoId = uuidv7();
    const demoItemId = uuidv7();
    const glosaId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, lote_id, protocolo_operadora, kind,
            data_processamento, xml_storage_key,
            total_apresentado_cents, total_processado_cents,
            total_liberado_cents, total_glosa_cents, imported_by)
         VALUES ($1, $2, $3, 'PROT-CG', 'analise',
                 DATE '2026-06-25', 'demo/ciclo.xml',
                 30000, 23000, 23000, 7000, $4)`,
        [demoId, s.operadoraId, loteId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.demonstrativo_item
           (id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, 'CG001',
                 30000, 23000, 23000, 7000,
                 'M010', 'Procedimento nao coberto pelo contrato')`,
        [demoItemId, demoId, s.guiaId],
      );
    });

    // 3. Criar glosa a partir do demonstrativo_item
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.glosa
           (id, demonstrativo_item_id, guia_id, encounter_version_id,
            codigo_glosa, descricao_glosa, valor_glosado_cents)
         VALUES ($1, $2, $3, $4, 'M010', 'Procedimento nao coberto', 7000)`,
        [glosaId, demoItemId, s.guiaId, s.versionId],
      );
    });

    // Verificar que a glosa esta pendente
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows[0]!.status).toBe('pendente');
    });

    // 4. Criar recurso de glosa e marcar como enviado
    const recursoId = uuidv7();
    const recursoItemId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO tiss.recurso_glosa
           (id, operadora_id, numero_recurso, justificativa_geral,
            encounter_version_id, status, protocolo_operadora, sent_at, created_by)
         VALUES ($1, $2, '1', 'Procedimento esta coberto pelo contrato vigente',
                 $3, 'enviado', 'PROT-REC-CG', clock_timestamp(), $4)`,
        [recursoId, s.operadoraId, s.versionId, s.userId],
      );
      await tx.query(
        `INSERT INTO tiss.recurso_glosa_item
           (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
         VALUES ($1, $2, $3, 'Conforme clausula 3.1 do contrato 2026', 7000)`,
        [recursoItemId, recursoId, glosaId],
      );
      // Atualizar glosa para contestada
      await tx.query(
        `UPDATE tiss.glosa SET status = 'contestada' WHERE id = $1`,
        [glosaId],
      );
    });

    // 5. Resolver recurso como deferido
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, { resultado: 'deferido' }, s.userId),
    );
    expect(resolveResult.ok).toBe(true);

    // 6. Verificar que o recurso esta deferido
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      );
      expect(rows[0]!.status).toBe('deferido');
    });

    // 7. Verificar que a glosa transitou para revertida
    await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        resolved_at: string | null;
        resolved_by: string | null;
      }>(
        `SELECT status, resolved_at, resolved_by FROM tiss.glosa WHERE id = $1`,
        [glosaId],
      );
      expect(rows[0]!.status).toBe('revertida');
      expect(rows[0]!.resolved_at).not.toBeNull();
      expect(rows[0]!.resolved_by).toBe(s.userId);
    });
  });
});
```

- [ ] Rodar o teste e confirmar que passa.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/glosa-lifecycle.int.test.ts 2>&1 | tail -20
```

Saida esperada: o teste do ciclo completo passa.

- [ ] Rodar todos os invariantes de CI para confirmar que as novas tabelas estao no escopo.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts 2>&1 | tail -10
pnpm vitest run packages/db/src/invariants/inv02-fk.int.test.ts 2>&1 | tail -10
pnpm vitest run packages/db/src/invariants/inv10-crud-matrix.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os invariantes passam; `tiss.glosa`, `tiss.recurso_glosa`, `tiss.recurso_glosa_item` e `tiss.recurso_number_counter` aparecem nas varreduras.

- [ ] Rodar o lint de relogio no schema tiss para confirmar ausencia de `now()` e `current_date`.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm lint:terminology-clock 2>&1 | tail -10
```

Saida esperada: zero violacoes no schema tiss.

- [ ] Rodar o typecheck para garantir que `resolve-recurso.ts` compila.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm typecheck 2>&1 | tail -10
```

Saida esperada: exit 0, sem erros.

- [ ] Commitar.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/glosa-lifecycle.int.test.ts
git commit -m "test(tiss): add end-to-end lifecycle test for glosa and recurso

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
### Task 19: tipos e createRecursoGlosa — cria recurso em rascunho com glosas iniciais

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/types.ts`
- Criar `packages/tiss/src/recurso-glosa/test-support.ts`
- Criar `packages/tiss/src/recurso-glosa/create-recurso.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/create-recurso.ts`

**Por que**: O ponto de entrada do fluxo de recurso de glosa e a criacao do recurso em rascunho, vinculando glosas selecionadas pelo usuario. Cada glosa precisa estar em status `pendente` e pertencer ao mesmo tenant. A funcao valida essas condicoes, insere o recurso e os itens de vinculo, e atualiza os contadores.

- [ ] Criar o diretorio e o arquivo de tipos `packages/tiss/src/recurso-glosa/types.ts`:

```ts
// packages/tiss/src/recurso-glosa/types.ts

/**
 * Tipos do dominio de recurso de glosa TISS.
 *
 * O recurso de glosa e a contestacao formal do prestador contra glosas
 * aplicadas pela operadora em um demonstrativo de retorno. O ciclo de vida e:
 * rascunho -> pronto -> enviado -> (deferido | indeferido | parcial)
 * Com desvio para 'indeterminado' em caso de timeout no envio (§7 design).
 */

export type RecursoStatus =
  | 'rascunho'
  | 'pronto'
  | 'enviado'
  | 'indeterminado'
  | 'deferido'
  | 'indeferido'
  | 'parcial';

export type GlosaItemResultado = 'deferido' | 'indeferido';

export interface CreateRecursoGlosaInput {
  readonly operadoraId: string;
  readonly createdBy: string;
  readonly itens: readonly CreateRecursoItemInput[];
}

export interface CreateRecursoItemInput {
  readonly glosaId: string;
  readonly justificativa: string;
  readonly valorRecursadoCents: number;
}

export type CreateRecursoFailure =
  | { kind: 'sem_itens' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'glosa_nao_encontrada'; glosaId: string }
  | { kind: 'glosa_nao_pendente'; glosaId: string; status: string }
  | { kind: 'glosa_operadora_divergente'; glosaId: string };

export interface CreatedRecurso {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type AddGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'glosa_nao_encontrada' }
  | { kind: 'glosa_nao_pendente'; status: string }
  | { kind: 'glosa_operadora_divergente' }
  | { kind: 'glosa_ja_no_recurso' };

export interface AddedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type RemoveGlosaFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'recurso_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface RemovedGlosaItem {
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type MarkReadyFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'sem_itens' }
  | { kind: 'justificativa_geral_ausente' };

export interface RecursoReadyResult {
  readonly recursoId: string;
  readonly itemCount: number;
  readonly totalRecursadoCents: number;
}

export type SubmitRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'transport_indisponivel'; detail: string }
  | { kind: 'transport_rejeitado'; detail: string }
  | { kind: 'transport_nao_suportado'; detail: string }
  | { kind: 'transport_indeterminado'; detail: string };

export interface RecursoSentResult {
  readonly recursoId: string;
  readonly protocoloOperadora?: string;
  readonly storageKey?: string;
}

export interface RecursoIndeterminadoResult {
  readonly recursoId: string;
  readonly detail: string;
}

export type ResolveRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string }
  | { kind: 'item_nao_encontrado'; glosaId: string };

export interface ResolveRecursoInput {
  readonly resultado: 'deferido' | 'indeferido' | 'parcial';
  readonly itensResolvidos: readonly ResolveItemInput[];
}

export interface ResolveItemInput {
  readonly glosaId: string;
  readonly resultado: GlosaItemResultado;
}

export interface RecursoResolvedResult {
  readonly recursoId: string;
  readonly resultado: string;
  readonly itensDeferidos: number;
  readonly itensIndeferidos: number;
}
```

- [ ] Criar o arquivo de suporte para testes `packages/tiss/src/recurso-glosa/test-support.ts`:

```ts
// packages/tiss/src/recurso-glosa/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeRecurso {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  loteId: string;
  demonstrativoId: string;
  glosaIds: [string, string, string];
  guiaIds: [string, string, string];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia o grafo completo para testes de recurso de glosa:
 * - tenant, clinica, usuario, profissional, paciente
 * - operadora
 * - 3 encounters finalizados, cada um com encounter_version e guia
 * - 1 lote retornado contendo as 3 guias
 * - 1 demonstrativo de analise vinculado ao lote
 * - 3 demonstrativo_items com glosa (valor_glosa_cents > 0, glosa_codigo preenchido)
 *
 * Os 3 demonstrativo_items servem como "glosas pendentes" para vincular ao recurso.
 * O status dos itens no demonstrativo_item e implicitamente pendente: nenhum recurso
 * foi criado ainda.
 */
export async function semearRecursoGlosa(): Promise<SementeRecurso> {
  const s: SementeRecurso = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    demonstrativoId: uuidv7(),
    glosaIds: [uuidv7(), uuidv7(), uuidv7()],
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const profId = uuidv7();
  const patientId = uuidv7();

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- tenant, clinica, usuario, membership, profissional, paciente ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Recurso Glosa', '33ABC44556DE77')`,
      [s.tenantId, `rg-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade RG', '33ABC44556DE77', '3344556', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin RG')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '334455', 'SP', '225125')`,
      [s.tenantId, profId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Paciente RG', 'completo', '1985-03-10')`,
      [s.tenantId, patientId],
    );

    // --- operadora ---
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora RG', '66XYZ00003DE03', '4.01.00', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters finalizados com guias ---
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      const valorProcedimento = (idx + 1) * 100; // 100, 200, 300 reais

      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-07-${dia}T14:00:00Z', DATE '2026-07-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, patientId, profId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, profId, `rg-${idx}`],
      );
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes, conselho_profissional, numero_conselho,
            uf_conselho, cbos, indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00998877665544', false,
            '900123', '3344556', '06', '334455', 'SP', '225125', '9', '01',
            DATE '2026-07-${dia}', '1', '22', '10101012',
            ${valorProcedimento}.00, true, $7)`,
        [s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
         `RG-${String(idx + 1).padStart(3, '0')}`, s.userId],
      );
    }

    // --- lote retornado com as 3 guias ---
    const totalCents = (100 + 200 + 300) * 100; // 60000 centavos
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $3, '1', 'retornado'::tiss.lote_status, '4.01.00', 3, $4,
               'lote/rg.xml', 'aabb0011223344556677889900aabbcc',
               'PROT-RG-001', TIMESTAMPTZ '2026-07-10T10:00:00Z', $5)`,
      [s.tenantId, s.loteId, s.operadoraId, totalCents, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
    }

    // --- demonstrativo de analise ---
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-RG-001', 'analise'::tiss.demonstrativo_kind,
               DATE '2026-07-15', 'demonstrativo/rg.xml',
               60000, 45000, 45000, 15000, $5)`,
      [s.tenantId, s.demonstrativoId, s.operadoraId, s.loteId, s.userId],
    );

    // --- 3 demonstrativo_items com glosa (servem como glosas pendentes) ---
    for (let idx = 0; idx < 3; idx++) {
      const valorApresentado = (idx + 1) * 10000; // 10000, 20000, 30000 centavos
      const valorGlosa = (idx + 1) * 1000; // 1000, 2000, 3000 centavos de glosa
      const valorLiberado = valorApresentado - valorGlosa;
      await c.query(
        `INSERT INTO tiss.demonstrativo_item
           (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
            valor_apresentado_cents, valor_processado_cents,
            valor_liberado_cents, valor_glosa_cents,
            glosa_codigo, glosa_descricao)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $6, $7, $8,
                 $9, $10)`,
        [
          s.tenantId, s.glosaIds[idx], s.demonstrativoId, s.guiaIds[idx],
          `RG-${String(idx + 1).padStart(3, '0')}`,
          valorApresentado, valorLiberado, valorGlosa,
          `M01${idx}`, `Motivo de glosa ${idx + 1}`,
        ],
      );
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
```

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/create-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/create-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('createRecursoGlosa', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria recurso em rascunho com 2 glosas vinculadas', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Procedimento necessario', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[1], justificativa: 'Exame indicado clinicamente', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(2);
    expect(result.value.totalRecursadoCents).toBe(3000);
    expect(result.value.recursoId).toBeTruthy();

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; item_count: number; total_recursado_cents: string }>(
        `SELECT status, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [result.value.recursoId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('rascunho');
    expect(rows[0]!.item_count).toBe(2);
    expect(Number(rows[0]!.total_recursado_cents)).toBe(3000);
  });

  it('recusa criacao sem itens', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('sem_itens');
  });

  it('recusa glosa inexistente', async () => {
    const fakeGlosaId = uuidv7();
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: fakeGlosaId, justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('glosa_nao_encontrada');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `create-recurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/create-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './create-recurso'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/create-recurso.ts`:

```ts
// packages/tiss/src/recurso-glosa/create-recurso.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  CreateRecursoGlosaInput,
  CreatedRecurso,
  CreateRecursoFailure,
} from './types';

/**
 * Cria um recurso de glosa em status rascunho com os itens informados.
 *
 * Validacoes:
 * - Ao menos 1 item
 * - Operadora existe
 * - Cada glosa existe, esta com glosa_codigo preenchido (e portanto glosada),
 *   e pertence a mesma operadora do recurso
 * - Glosa nao esta em outro recurso ativo (nao-cancelado)
 */
export async function createRecursoGlosa(
  tx: TxClient,
  i: CreateRecursoGlosaInput,
): Promise<Result<CreatedRecurso, CreateRecursoFailure>> {
  if (i.itens.length === 0) {
    return err({ kind: 'sem_itens' });
  }

  // 1. Valida operadora
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }

  // 2. Valida cada glosa
  for (const item of i.itens) {
    const { rows: glosaRows } = await tx.query<{
      id: string;
      glosa_codigo: string | null;
      valor_glosa_cents: string;
      demonstrativo_id: string;
    }>(
      `SELECT di.id, di.glosa_codigo, di.valor_glosa_cents, di.demonstrativo_id
         FROM tiss.demonstrativo_item di
        WHERE di.id = $1`,
      [item.glosaId],
    );
    if (glosaRows.length === 0) {
      return err({ kind: 'glosa_nao_encontrada', glosaId: item.glosaId });
    }
    const glosa = glosaRows[0]!;

    // Glosa precisa ter glosa_codigo preenchido (indicando que foi glosada)
    if (glosa.glosa_codigo === null) {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: 'sem_glosa' });
    }

    // Valida que a glosa pertence a mesma operadora
    const { rows: demoRows } = await tx.query<{ operadora_id: string }>(
      `SELECT operadora_id FROM tiss.demonstrativo WHERE id = $1`,
      [glosa.demonstrativo_id],
    );
    if (demoRows.length === 0 || demoRows[0]!.operadora_id !== i.operadoraId) {
      return err({ kind: 'glosa_operadora_divergente', glosaId: item.glosaId });
    }

    // Verifica se a glosa ja esta em outro recurso ativo
    const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
      `SELECT rgi.recurso_id
         FROM tiss.recurso_glosa_item rgi
         JOIN tiss.recurso_glosa rg ON rg.id = rgi.recurso_id AND rg.tenant_id = rgi.tenant_id
        WHERE rgi.glosa_id = $1
          AND rg.status NOT IN ('indeferido')`,
      [item.glosaId],
    );
    if (existeRows.length > 0) {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: 'ja_recursada' });
    }
  }

  // 3. Obtem encounter_version_id da primeira guia (FK obrigatoria em tiss.recurso_glosa)
  const firstGlosaId = i.itens[0]!.glosaId;
  const { rows: evRows } = await tx.query<{ encounter_version_id: string }>(
    `SELECT gc.encounter_version_id
       FROM tiss.glosa g
       JOIN tiss.encounter_guia_consulta gc ON gc.id = g.guia_id AND gc.tenant_id = g.tenant_id
      WHERE g.id = $1`,
    [firstGlosaId],
  );
  const encounterVersionId = evRows[0]!.encounter_version_id;

  // 4. Gera numero_recurso via contador auto-provisionante (migration 0126)
  const { rows: nrRows } = await tx.query<{ next_recurso_number: string }>(
    `SELECT tiss.next_recurso_number(app.current_tenant_id(), $1) AS next_recurso_number`,
    [i.operadoraId],
  );
  const numeroRecurso = String(nrRows[0]!.next_recurso_number);

  // 5. Insere o recurso
  const recursoId = uuidv7();
  let totalRecursadoCents = 0;
  for (const item of i.itens) {
    totalRecursadoCents += item.valorRecursadoCents;
  }

  await tx.query(
    `INSERT INTO tiss.recurso_glosa
       (id, operadora_id, numero_recurso, encounter_version_id,
        status, item_count, total_recursado_cents, created_by)
     VALUES ($1, $2, $3, $4, 'rascunho'::tiss.recurso_glosa_status, $5, $6, $7)`,
    [recursoId, i.operadoraId, numeroRecurso, encounterVersionId,
     i.itens.length, totalRecursadoCents, i.createdBy],
  );

  // 4. Insere os itens
  for (const item of i.itens) {
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
       VALUES ($1, $2, $3, $4)`,
      [recursoId, item.glosaId, item.justificativa, item.valorRecursadoCents],
    );
  }

  return ok({
    recursoId,
    itemCount: i.itens.length,
    totalRecursadoCents,
  });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/create-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 3 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/types.ts packages/tiss/src/recurso-glosa/test-support.ts packages/tiss/src/recurso-glosa/create-recurso.ts packages/tiss/src/recurso-glosa/create-recurso.int.test.ts
git commit -m "feat(tiss): add createRecursoGlosa with types and test support seed"
```

---

### Task 20: addGlosaToRecurso e removeGlosaFromRecurso — gerenciar itens do recurso em rascunho

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/recurso-items.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/recurso-items.ts`

**Por que**: Apos criar o recurso em rascunho, o usuario pode adicionar ou remover glosas individualmente antes de submeter. Cada operacao atualiza os contadores (item_count, total_recursado_cents) e valida que o recurso esta em rascunho.

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/recurso-items.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/recurso-items.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('addGlosaToRecurso e removeGlosaFromRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('adiciona glosa a recurso existente em rascunho', async () => {
    // Cria recurso com 1 glosa
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo 1', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    // Adiciona segunda glosa
    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1], 'Motivo 2', 2000),
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(add.value.itemCount).toBe(2);
    expect(add.value.totalRecursadoCents).toBe(3000);
  });

  it('recusa adicionar glosa a recurso que nao esta em rascunho', async () => {
    // Cria recurso com justificativa geral e marca pronto
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Motivo 3', valorRecursadoCents: 3000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    // Atualiza justificativa_geral e marca pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao geral', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [recursoId],
      ),
    );

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[0], 'Motivo extra', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('recurso_nao_rascunho');
  });

  it('recusa adicionar glosa ja vinculada ao mesmo recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo A', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const add = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, create.value.recursoId, s.glosaIds[0], 'Duplicata', 500),
    );
    expect(add.ok).toBe(false);
    if (add.ok) return;
    expect(add.error.kind).toBe('glosa_ja_no_recurso');
  });

  it('remove glosa de recurso em rascunho e atualiza contadores', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo X', valorRecursadoCents: 1000 },
          { glosaId: s.glosaIds[1], justificativa: 'Motivo Y', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[0]),
    );
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(remove.value.itemCount).toBe(1);
    expect(remove.value.totalRecursadoCents).toBe(2000);
  });

  it('recusa remover glosa que nao esta no recurso', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo W', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const remove = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[2]),
    );
    expect(remove.ok).toBe(false);
    if (remove.ok) return;
    expect(remove.error.kind).toBe('vinculo_nao_encontrado');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `recurso-items` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-items.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './recurso-items'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/recurso-items.ts`:

```ts
// packages/tiss/src/recurso-glosa/recurso-items.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
} from './types';

/**
 * Adiciona uma glosa a um recurso em rascunho. Validacoes:
 * - Recurso existe e esta em rascunho
 * - Glosa existe e esta glosada (glosa_codigo preenchido)
 * - Glosa pertence a mesma operadora do recurso
 * - Glosa nao esta ja vinculada a este recurso
 */
export async function addGlosaToRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
  justificativa: string,
  valorRecursadoCents: number,
): Promise<Result<AddedGlosaItem, AddGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, operadora_id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Busca a glosa (demonstrativo_item) e valida
  const { rows: glosaRows } = await tx.query<{
    id: string;
    glosa_codigo: string | null;
    demonstrativo_id: string;
  }>(
    `SELECT id, glosa_codigo, demonstrativo_id
       FROM tiss.demonstrativo_item WHERE id = $1`,
    [glosaId],
  );
  if (glosaRows.length === 0) {
    return err({ kind: 'glosa_nao_encontrada' });
  }
  const glosa = glosaRows[0]!;
  if (glosa.glosa_codigo === null) {
    return err({ kind: 'glosa_nao_pendente', status: 'sem_glosa' });
  }

  // 3. Valida operadora
  const { rows: demoRows } = await tx.query<{ operadora_id: string }>(
    `SELECT operadora_id FROM tiss.demonstrativo WHERE id = $1`,
    [glosa.demonstrativo_id],
  );
  if (demoRows.length === 0 || demoRows[0]!.operadora_id !== recurso.operadora_id) {
    return err({ kind: 'glosa_operadora_divergente' });
  }

  // 4. Verifica duplicata
  const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
    `SELECT recurso_id FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2`,
    [recursoId, glosaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'glosa_ja_no_recurso' });
  }

  // 5. Insere o item
  await tx.query(
    `INSERT INTO tiss.recurso_glosa_item
       (recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
     VALUES ($1, $2, $3, $4)`,
    [recursoId, glosaId, justificativa, valorRecursadoCents],
  );

  // 6. Atualiza contadores
  const newCount = recurso.item_count + 1;
  const newTotal = Number(recurso.total_recursado_cents) + valorRecursadoCents;
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}

/**
 * Remove uma glosa de um recurso em rascunho. Atualiza contadores.
 */
export async function removeGlosaFromRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
): Promise<Result<RemovedGlosaItem, RemoveGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Remove o item e pega o valor
  const { rows: removedRows } = await tx.query<{ valor_recursado_cents: string }>(
    `DELETE FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2
      RETURNING valor_recursado_cents`,
    [recursoId, glosaId],
  );
  if (removedRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const removedCents = Number(removedRows[0]!.valor_recursado_cents);
  const newCount = Math.max(recurso.item_count - 1, 0);
  const newTotal = Math.max(Number(recurso.total_recursado_cents) - removedCents, 0);
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-items.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 5 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-items.ts packages/tiss/src/recurso-glosa/recurso-items.int.test.ts
git commit -m "feat(tiss): add addGlosaToRecurso and removeGlosaFromRecurso"
```

---

### Task 21: markRecursoReady — transicao de rascunho para pronto com validacao

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`

**Por que**: Antes de enviar o recurso, o usuario marca como pronto. A funcao valida que tem pelo menos 1 item e que a justificativa geral esta preenchida (campo `justificativa_geral` no recurso, diferente da justificativa individual de cada item).

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts` com os cenarios de markRecursoReady:

```ts
// packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('markRecursoReady', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('transiciona recurso de rascunho para pronto com justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo 1', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [create.value.recursoId, 'Todos os procedimentos foram realizados conforme protocolo clinico.'],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.recursoId).toBe(create.value.recursoId);
    expect(ready.value.itemCount).toBe(1);
    expect(ready.value.totalRecursadoCents).toBe(1000);

    // Verifica status no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [create.value.recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('pronto');
  });

  it('recusa marcar pronto sem justificativa geral', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1], justificativa: 'Motivo 2', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // NAO preenche justificativa_geral
    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('justificativa_geral_ausente');
  });

  it('recusa marcar pronto recurso sem itens', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Motivo 3', valorRecursadoCents: 3000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Remove o unico item
    await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, create.value.recursoId, s.glosaIds[2]),
    );

    // Preenche justificativa geral
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral' WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('sem_itens');
  });

  it('recusa marcar pronto recurso que ja esta pronto', async () => {
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Motivo R', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Geral R', status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
        [create.value.recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, create.value.recursoId),
    );
    expect(ready.ok).toBe(false);
    if (ready.ok) return;
    expect(ready.error.kind).toBe('transicao_invalida');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (modulo `recurso-lifecycle` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com `Cannot find module './recurso-lifecycle'`.

- [ ] Criar a implementacao `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` com markRecursoReady:

```ts
// packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
} from './types';

/**
 * Marca o recurso de glosa como pronto para envio. Validacoes:
 * - Recurso existe
 * - Status atual e 'rascunho' (transicao permitida: rascunho -> pronto)
 * - Tem pelo menos 1 item
 * - justificativa_geral esta preenchida
 */
export async function markRecursoReady(
  tx: TxClient,
  recursoId: string,
): Promise<Result<RecursoReadyResult, MarkReadyFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
    justificativa_geral: string | null;
  }>(
    `SELECT id, status, item_count, total_recursado_cents, justificativa_geral
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  if (recurso.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'pronto' });
  }
  if (recurso.item_count === 0) {
    return err({ kind: 'sem_itens' });
  }
  if (!recurso.justificativa_geral || recurso.justificativa_geral.trim() === '') {
    return err({ kind: 'justificativa_geral_ausente' });
  }

  await tx.query(
    `UPDATE tiss.recurso_glosa SET status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
    [recursoId],
  );

  return ok({
    recursoId: recurso.id,
    itemCount: recurso.item_count,
    totalRecursadoCents: Number(recurso.total_recursado_cents),
  });
}
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 4 testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts
git commit -m "feat(tiss): add markRecursoReady with justificativa and item count validation"
```

---

### Task 22: atualizar fake transport e submitRecurso — envio com timeout gerando indeterminado

**Arquivos:**
- Modificar `packages/tiss/src/transport/tiss-arquivo-fake.ts`
- Modificar `packages/tiss/src/transport/tiss-arquivo-fake.test.ts`
- Criar `packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts`
- Modificar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` (adicionar submitRecurso)

**Por que**: O `submitRecurso` chama `transport.submitRecursoGlosa` para enviar o XML do recurso. O fake transport precisa aceitar o envio (em vez de retornar `unsupported`). Em caso de timeout, o recurso transita para `indeterminado` — NUNCA retry automatico (Design §7). O fake transport no modo `timeout` permite testar esse fluxo.

- [ ] Atualizar `packages/tiss/src/transport/tiss-arquivo-fake.ts` para implementar `submitRecursoGlosa`:

No trecho do metodo `submitRecursoGlosa` existente, substituir o bloco que retorna `unsupported`:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// SUBSTITUIR o metodo submitRecursoGlosa existente:
// DE:
    async submitRecursoGlosa(_ctx: ProviderCtx, _i) {
      return failure({
        kind: 'unsupported', retrySafe: false,
        detail: 'submitRecursoGlosa nao disponivel no fake (Fase 5)',
      });
    },
// PARA:
    async submitRecursoGlosa(ctx: ProviderCtx, i) {
      const f = talvezFalhar<TissSubmissionReceipt>();
      if (f) return f;

      const iso = isoFromMs(systemClock.nowMs());
      const ano = iso.slice(0, 4);
      const mes = iso.slice(5, 7);
      const seq = submittedRecursos.length + 1;
      const fileName = `recurso_${i.operadoraCnpj}_${ano}_${mes}_${seq}.xml`;
      const sha256 = createHash('sha256').update(i.xml).digest('hex');
      const storageKey = asStorageKey(`tiss-fake/${ctx.tenantId}/${fileName}`);

      submittedRecursos.push({
        recursoId: i.recursoId,
        xml: new Uint8Array(i.xml),
        operadoraCnpj: i.operadoraCnpj,
      });

      const receipt: TissSubmissionReceipt = {
        kind: 'arquivo',
        storageKey,
        fileName,
        sha256,
        instructions:
          `Acesse o portal da operadora ${i.operadoraCnpj}, ` +
          `menu Recurso de Glosa, importe o arquivo ${fileName}.`,
      };

      return success(receipt, `tiss-fake-recurso-${i.recursoId}`);
    },
```

Adicionar a interface `SubmittedRecurso` e o array de rastreamento. Logo apos a interface `SubmittedBatch` existente, adicionar:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// APOS a interface SubmittedBatch, adicionar:

export interface SubmittedRecurso {
  readonly recursoId: string;
  readonly xml: Uint8Array;
  readonly operadoraCnpj: string;
}
```

Na interface `FakeTissArquivoTransport`, adicionar o campo de rastreamento:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.ts
// Na interface FakeTissArquivoTransport, APOS submittedBatches:
export interface FakeTissArquivoTransport extends TissTransport {
  readonly submittedBatches: readonly SubmittedBatch[];
  readonly submittedRecursos: readonly SubmittedRecurso[];
}
```

Na funcao `createFakeTissArquivoTransport`, logo apos `const batches`, adicionar:

```ts
  const submittedRecursos: SubmittedRecurso[] = [];
```

E adicionar o getter na interface retornada, logo apos o getter `submittedBatches`:

```ts
    get submittedRecursos(): readonly SubmittedRecurso[] {
      return submittedRecursos;
    },
```

- [ ] Atualizar o teste do fake transport em `packages/tiss/src/transport/tiss-arquivo-fake.test.ts`. Localizar o teste `submitRecursoGlosa retorna unsupported` e substituir:

```ts
// em packages/tiss/src/transport/tiss-arquivo-fake.test.ts
// SUBSTITUIR o teste:
// DE:
  it('submitRecursoGlosa retorna unsupported', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unsupported');
  });
// PARA:
  it('submitRecursoGlosa retorna sucesso com arquivo', async () => {
    const transport = createFakeTissArquivoTransport();
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-001',
      xml: new Uint8Array([1, 2, 3]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('arquivo');
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe('rec-001');
  });

  it('submitRecursoGlosa retorna timeout quando modo e timeout', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });
    const result = await transport.submitRecursoGlosa(ctx, {
      recursoId: 'rec-002',
      xml: new Uint8Array([4, 5, 6]),
      operadoraCnpj: '12ABC34503DE37',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
    expect(transport.submittedRecursos).toHaveLength(0);
  });
```

- [ ] Rodar os testes do fake transport para confirmar que passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/transport/tiss-arquivo-fake.test.ts 2>&1 | tail -15
```

Saida esperada: todos os testes passam.

- [ ] Criar o teste de integracao do submitRecurso `packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { markRecursoReady, submitRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('submitRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;
  let providerCtx: ProviderCtx;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      correlationId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('envia recurso pronto com fake transport e transita para enviado', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // Cria e marca pronto
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Necessario', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao formal' WHERE id = $1`,
        [recursoId],
      ),
    );

    const ready = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(ready.ok).toBe(true);

    // Submete
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    expect(submit.value.recursoId).toBe(recursoId);
    expect(submit.value.storageKey).toBeTruthy();

    // Verifica estado no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; xml_storage_key: string | null; sent_at: string | null }>(
        `SELECT status, xml_storage_key, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('enviado');
    expect(rows[0]!.xml_storage_key).toBeTruthy();
    expect(rows[0]!.sent_at).toBeTruthy();

    // Verifica que o fake transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
  });

  it('timeout no transport transita para indeterminado — NUNCA retry', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'timeout' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[1], justificativa: 'Procedimento indicado', valorRecursadoCents: 2000 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const recursoId = create.value.recursoId;

    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = 'Contestacao timeout' WHERE id = $1`,
        [recursoId],
      ),
    );
    await withTenantTx(actor, (tx) => markRecursoReady(tx, recursoId));

    // Submete — timeout
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transport_indeterminado');

    // Verifica estado no banco: INDETERMINADO, nao enviado
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string }>(
        `SELECT status FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('indeterminado');

    // Transport NAO recebeu nada (timeout simulado antes do efeito)
    expect(transport.submittedRecursos).toHaveLength(0);
  });

  it('recusa submeter recurso que nao esta pronto', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // Nao marca pronto — status e rascunho
    const submit = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, create.value.recursoId, transport, providerCtx),
    );
    expect(submit.ok).toBe(false);
    if (submit.ok) return;
    expect(submit.error.kind).toBe('transicao_invalida');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (funcao `submitRecurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com export nao encontrado.

- [ ] Adicionar `submitRecurso` ao arquivo `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`. Acrescentar ao final do arquivo:

```ts
// --- acrescentar ao final de packages/tiss/src/recurso-glosa/recurso-lifecycle.ts ---

import type { ProviderCtx } from '@cadencia/integrations';
import type { TissTransport } from '../transport/types';
import { XmlBuilder } from '../serializer/xml-builder';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import type {
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';

/**
 * Submete o recurso de glosa via transport. Fluxo:
 * 1. Valida que o recurso esta em status 'pronto'
 * 2. Busca dados necessarios (operadora, itens)
 * 3. Serializa XML minimo do recurso
 * 4. Chama transport.submitRecursoGlosa
 * 5. Sucesso: transita para 'enviado', grava protocolo/storageKey
 * 6. Timeout: transita para 'indeterminado' — NUNCA retry (Design §7)
 * 7. Outro erro: retorna falha sem mudar estado
 */
export async function submitRecurso(
  tx: TxClient,
  recursoId: string,
  transport: TissTransport,
  providerCtx: ProviderCtx,
): Promise<Result<RecursoSentResult, SubmitRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
    operadora_id: string;
    justificativa_geral: string;
    item_count: number;
  }>(
    `SELECT id, status, operadora_id, justificativa_geral, item_count
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;
  if (recurso.status !== 'pronto') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'enviado' });
  }

  // 2. Busca dados da operadora
  const { rows: opRows } = await tx.query<{
    registro_ans: string;
    cnpj: string;
  }>(
    `SELECT registro_ans, cnpj FROM tiss.operadora WHERE id = $1`,
    [recurso.operadora_id],
  );
  const op = opRows[0]!;

  // 3. Busca itens do recurso com dados da glosa
  const { rows: itemRows } = await tx.query<{
    glosa_id: string;
    justificativa_item: string;
    valor_recursado_cents: string;
    glosa_codigo: string;
    numero_guia_prestador: string;
    data_atendimento: string;
    codigo_procedimento: string;
  }>(
    `SELECT rgi.glosa_id, rgi.justificativa_item, rgi.valor_recursado_cents,
            di.glosa_codigo, di.numero_guia_prestador,
            g.data_atendimento::text, g.codigo_procedimento
       FROM tiss.recurso_glosa_item rgi
       JOIN tiss.demonstrativo_item di ON di.id = rgi.glosa_id AND di.tenant_id = rgi.tenant_id
       JOIN tiss.encounter_guia_consulta g ON g.id = di.guia_id AND g.tenant_id = di.tenant_id
      WHERE rgi.recurso_id = $1
      ORDER BY rgi.glosa_id`,
    [recursoId],
  );

  // 4. Serializa XML minimo do recurso
  const xml = new XmlBuilder();
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', transport.tissVersion);
  xml.tag('ans:registroANS', op.registro_ans);
  xml.close('ans:cabecalho');

  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');
  xml.tag('ans:numeroRecursoGlosa', recursoId.slice(0, 20));

  for (let idx = 0; idx < itemRows.length; idx++) {
    const item = itemRows[idx]!;
    xml.open('ans:itemRecursoGlosa');
    xml.tag('ans:sequencialItem', String(idx + 1));
    xml.tag('ans:dataAtendimento', item.data_atendimento);
    xml.tag('ans:numeroGuiaPrestador', item.numero_guia_prestador);
    xml.tag('ans:codigoProcedimento', item.codigo_procedimento);
    xml.tag('ans:codigoGlosa', item.glosa_codigo);
    xml.tag('ans:valorRecursado', formatCentsAsReais(Number(item.valor_recursado_cents)));
    xml.tag('ans:justificativa', item.justificativa_item);
    xml.close('ans:itemRecursoGlosa');
  }

  xml.close('ans:recursoGlosa');
  xml.close('ans:prestadorParaOperadora');
  xml.close('ans:mensagemTISS');

  const encoded = encodeIso8859(xml.toString());

  // 5. Chama o transport
  const transportResult = await transport.submitRecursoGlosa(providerCtx, {
    recursoId,
    xml: encoded.bytes,
    operadoraCnpj: op.cnpj,
  });

  // 6. Trata o resultado
  if (transportResult.ok) {
    const receipt = transportResult.value;
    const storageKey = receipt.kind === 'arquivo' ? receipt.storageKey : undefined;
    const protocolo = receipt.kind === 'protocolo' ? receipt.protocolo : undefined;

    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado'::tiss.recurso_glosa_status,
              protocolo_operadora = $2,
              xml_storage_key = $3,
              sent_at = clock_timestamp()
        WHERE id = $1`,
      [recursoId, protocolo ?? null, storageKey ?? null],
    );

    return ok({
      recursoId,
      protocoloOperadora: protocolo,
      storageKey: storageKey as string | undefined,
    });
  }

  // Timeout: transita para indeterminado — NUNCA retry (Design §7)
  if (transportResult.error.kind === 'timeout') {
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'indeterminado'::tiss.recurso_glosa_status
        WHERE id = $1`,
      [recursoId],
    );
    return err({
      kind: 'transport_indeterminado',
      detail: transportResult.error.detail,
    });
  }

  // Outros erros: nao muda estado
  if (transportResult.error.kind === 'unavailable') {
    return err({ kind: 'transport_indisponivel', detail: transportResult.error.detail });
  }
  if (transportResult.error.kind === 'rejected') {
    return err({ kind: 'transport_rejeitado', detail: transportResult.error.detail });
  }
  return err({ kind: 'transport_nao_suportado', detail: transportResult.error.detail });
}

function formatCentsAsReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

Atualizar os imports no topo de `recurso-lifecycle.ts` para incluir os novos:

```ts
// em packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
// SUBSTITUIR o bloco de imports:
// DE:
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
} from './types';
// PARA:
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type { ProviderCtx } from '@cadencia/integrations';
import type { TissTransport } from '../transport/types';
import { XmlBuilder } from '../serializer/xml-builder';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';
```

- [ ] Rodar o teste do submit e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 3 testes passam.

- [ ] Rodar o teste do lifecycle para confirmar que markRecursoReady ainda passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/recurso-lifecycle.int.test.ts 2>&1 | tail -10
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/transport/tiss-arquivo-fake.ts packages/tiss/src/transport/tiss-arquivo-fake.test.ts packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/submit-recurso.int.test.ts
git commit -m "feat(tiss): add submitRecurso with timeout->indeterminado and update fake transport"
```

---

### Task 23: resolveRecurso — resolucao do recurso com resultado por item

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts`
- Modificar `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` (adicionar resolveRecurso)

**Por que**: Quando a operadora responde ao recurso, o usuario registra o resultado: deferido (todos os itens aceitos), indeferido (todos negados), ou parcial (alguns sim, outros nao). A funcao atualiza o status do recurso e o resultado individual de cada item vinculado.

- [ ] Criar o teste de integracao `packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createRecursoGlosa } from './create-recurso';
import { resolveRecurso } from './recurso-lifecycle';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('resolveRecurso', () => {
  let s: SementeRecurso;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  async function criarRecursoEnviado(glosaIds: string[]): Promise<string> {
    const itens = glosaIds.map((id, idx) => ({
      glosaId: id,
      justificativa: `Motivo ${idx + 1}`,
      valorRecursadoCents: (idx + 1) * 1000,
    }));

    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens,
      }),
    );
    if (!create.ok) throw new Error(`Falha ao criar recurso: ${create.error.kind}`);
    const recursoId = create.value.recursoId;

    // Marca pronto e enviado diretamente (para simplificar o teste)
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa
            SET justificativa_geral = 'Contestacao',
                status = 'enviado'::tiss.recurso_glosa_status,
                sent_at = clock_timestamp()
          WHERE id = $1`,
        [recursoId],
      ),
    );

    return recursoId;
  }

  it('resolve recurso como deferido — todos os itens deferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('deferido');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(0);

    // Verifica no banco
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; resolved_at: string | null }>(
        `SELECT status, resolved_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(rows[0]!.status).toBe('deferido');
    expect(rows[0]!.resolved_at).toBeTruthy();

    // Verifica resultado do item
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ resultado: string }>(
        `SELECT resultado FROM tiss.recurso_glosa_item WHERE recurso_id = $1`,
        [recursoId],
      ),
    );
    expect(itemRows[0]!.resultado).toBe('deferido');
  });

  it('resolve recurso como indeferido — todos os itens indeferidos', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[1]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'indeferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('indeferido');
    expect(resolve.value.itensDeferidos).toBe(0);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('resolve recurso como parcial — mix de deferido e indeferido', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0], s.glosaIds[1]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(true);
    if (!resolve.ok) return;
    expect(resolve.value.resultado).toBe('parcial');
    expect(resolve.value.itensDeferidos).toBe(1);
    expect(resolve.value.itensIndeferidos).toBe(1);
  });

  it('recusa resolver recurso que nao esta enviado', async () => {
    // Cria recurso em rascunho (nao enviado)
    const create = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[2], justificativa: 'Teste', valorRecursadoCents: 500 },
        ],
      }),
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, create.value.recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[2], resultado: 'deferido' },
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('transicao_invalida');
  });

  it('recusa resolver com item que nao pertence ao recurso', async () => {
    const recursoId = await criarRecursoEnviado([s.glosaIds[0]]);

    const resolve = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'deferido',
        itensResolvidos: [
          { glosaId: s.glosaIds[2], resultado: 'deferido' }, // nao esta neste recurso
        ],
      }),
    );
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.error.kind).toBe('item_nao_encontrado');
  });
});
```

- [ ] Rodar o teste e confirmar que falha (funcao `resolveRecurso` nao existe).

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts 2>&1 | tail -10
```

Saida esperada: falha com export nao encontrado.

- [ ] Adicionar `resolveRecurso` ao final de `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/recurso-glosa/recurso-lifecycle.ts ---

import type {
  ResolveRecursoFailure,
  ResolveRecursoInput,
  RecursoResolvedResult,
} from './types';

/**
 * Resolve o recurso de glosa com o resultado da operadora.
 * Transicao permitida: enviado -> (deferido | indeferido | parcial).
 * Tambem aceita resolver recurso em status 'indeterminado' (apos reconciliacao).
 * Atualiza o resultado individual de cada item vinculado.
 */
export async function resolveRecurso(
  tx: TxClient,
  recursoId: string,
  input: ResolveRecursoInput,
): Promise<Result<RecursoResolvedResult, ResolveRecursoFailure>> {
  // 1. Busca o recurso
  const { rows } = await tx.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  // Transicao permitida: enviado ou indeterminado -> resultado final
  if (recurso.status !== 'enviado' && recurso.status !== 'indeterminado') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: input.resultado });
  }

  // 2. Valida que todos os itens pertencem ao recurso
  for (const item of input.itensResolvidos) {
    const { rows: itemRows } = await tx.query<{ glosa_id: string }>(
      `SELECT glosa_id FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId],
    );
    if (itemRows.length === 0) {
      return err({ kind: 'item_nao_encontrado', glosaId: item.glosaId });
    }
  }

  // 3. Atualiza resultado de cada item
  let deferidos = 0;
  let indeferidos = 0;
  for (const item of input.itensResolvidos) {
    await tx.query(
      `UPDATE tiss.recurso_glosa_item
          SET resultado = $3
        WHERE recurso_id = $1 AND glosa_id = $2`,
      [recursoId, item.glosaId, item.resultado],
    );
    if (item.resultado === 'deferido') deferidos++;
    if (item.resultado === 'indeferido') indeferidos++;
  }

  // 4. Atualiza status e resolved_at do recurso
  await tx.query(
    `UPDATE tiss.recurso_glosa
        SET status = $2::tiss.recurso_glosa_status,
            resolved_at = clock_timestamp()
      WHERE id = $1`,
    [recursoId, input.resultado],
  );

  return ok({
    recursoId: recurso.id,
    resultado: input.resultado,
    itensDeferidos: deferidos,
    itensIndeferidos: indeferidos,
  });
}
```

Atualizar os imports de tipos no topo de `recurso-lifecycle.ts` para incluir os novos tipos de resolve. O bloco de imports de tipos ficara:

```ts
// em packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
// SUBSTITUIR o import de tipos:
// DE:
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
} from './types';
// PARA:
import type {
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  RecursoResolvedResult,
} from './types';
```

- [ ] Rodar o teste e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts 2>&1 | tail -15
```

Saida esperada: todos os 5 testes passam.

- [ ] Rodar TODOS os testes do recurso-glosa para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/ 2>&1 | tail -15
```

Saida esperada: todos os testes passam (create, items, lifecycle, submit, resolve).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/recurso-lifecycle.ts packages/tiss/src/recurso-glosa/resolve-recurso.int.test.ts
git commit -m "feat(tiss): add resolveRecurso with per-item deferido/indeferido tracking"
```

---

### Task 24: ciclo completo de integracao e exportacao via index.ts

**Arquivos:**
- Criar `packages/tiss/src/recurso-glosa/full-cycle.int.test.ts`
- Criar `packages/tiss/src/recurso-glosa/index.ts`
- Modificar `packages/tiss/src/index.ts` (re-exportar o modulo recurso-glosa)

**Por que**: O teste de ciclo completo garante que o fluxo inteiro funciona em sequencia: criar recurso -> adicionar glosa -> marcar pronto -> submeter com fake transport -> resolver. Alem disso, o `index.ts` expoe todas as funcoes e tipos para consumo por L3 (API e worker).

- [ ] Criar o barrel `packages/tiss/src/recurso-glosa/index.ts`:

```ts
// packages/tiss/src/recurso-glosa/index.ts
export { createRecursoGlosa } from './create-recurso';
export { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
export { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
export type {
  RecursoStatus,
  GlosaItemResultado,
  CreateRecursoGlosaInput,
  CreateRecursoItemInput,
  CreateRecursoFailure,
  CreatedRecurso,
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
  MarkReadyFailure,
  RecursoReadyResult,
  SubmitRecursoFailure,
  RecursoSentResult,
  RecursoIndeterminadoResult,
  ResolveRecursoFailure,
  ResolveRecursoInput,
  ResolveItemInput,
  RecursoResolvedResult,
} from './types';
```

- [ ] Adicionar a re-exportacao em `packages/tiss/src/index.ts`. Acrescentar ao final:

```ts
// --- acrescentar ao final de packages/tiss/src/index.ts ---

// Recurso de glosa (Fase 5)
export {
  createRecursoGlosa,
  addGlosaToRecurso,
  removeGlosaFromRecurso,
  markRecursoReady,
  submitRecurso,
  resolveRecurso,
  type RecursoStatus,
  type GlosaItemResultado,
  type CreateRecursoGlosaInput,
  type CreateRecursoItemInput,
  type CreateRecursoFailure,
  type CreatedRecurso,
  type AddGlosaFailure,
  type AddedGlosaItem,
  type RemoveGlosaFailure,
  type RemovedGlosaItem,
  type MarkReadyFailure,
  type RecursoReadyResult,
  type SubmitRecursoFailure,
  type RecursoSentResult,
  type RecursoIndeterminadoResult,
  type ResolveRecursoFailure,
  type ResolveRecursoInput,
  type ResolveItemInput,
  type RecursoResolvedResult,
} from './recurso-glosa/index';
```

- [ ] Criar o teste de ciclo completo `packages/tiss/src/recurso-glosa/full-cycle.int.test.ts`:

```ts
// packages/tiss/src/recurso-glosa/full-cycle.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { ProviderCtx } from '@cadencia/integrations';
import { createRecursoGlosa } from './create-recurso';
import { addGlosaToRecurso, removeGlosaFromRecurso } from './recurso-items';
import { markRecursoReady, submitRecurso, resolveRecurso } from './recurso-lifecycle';
import { createFakeTissArquivoTransport } from '../transport/tiss-arquivo-fake';
import { semearRecursoGlosa, type SementeRecurso } from './test-support';

describe('ciclo completo do recurso de glosa TISS', () => {
  let s: SementeRecurso;
  let actor: Actor;
  let providerCtx: ProviderCtx;

  beforeAll(async () => {
    s = await semearRecursoGlosa();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
    providerCtx = {
      tenantId: s.tenantId,
      correlationId: uuidv7(),
      idempotencyKey: uuidv7(),
      deadlineMs: 3000,
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('percorre o ciclo: criar -> adicionar -> remover -> marcar pronto -> submeter -> resolver parcial', async () => {
    const transport = createFakeTissArquivoTransport({ modo: 'ok' });

    // 1. Criar recurso com 1 glosa
    const createResult = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        createdBy: s.userId,
        itens: [
          { glosaId: s.glosaIds[0], justificativa: 'Procedimento necessario conforme protocolo', valorRecursadoCents: 1000 },
        ],
      }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const recursoId = createResult.value.recursoId;
    expect(createResult.value.itemCount).toBe(1);
    expect(createResult.value.totalRecursadoCents).toBe(1000);

    // 2. Adicionar segunda glosa
    const addResult = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[1], 'Exame indicado clinicamente', 2000),
    );
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    expect(addResult.value.itemCount).toBe(2);
    expect(addResult.value.totalRecursadoCents).toBe(3000);

    // 3. Adicionar terceira glosa
    const addResult2 = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2], 'Retorno medicamente justificado', 3000),
    );
    expect(addResult2.ok).toBe(true);
    if (!addResult2.ok) return;
    expect(addResult2.value.itemCount).toBe(3);
    expect(addResult2.value.totalRecursadoCents).toBe(6000);

    // 4. Remover a terceira glosa (mudou de ideia)
    const removeResult = await withTenantTx(actor, (tx) =>
      removeGlosaFromRecurso(tx, recursoId, s.glosaIds[2]),
    );
    expect(removeResult.ok).toBe(true);
    if (!removeResult.ok) return;
    expect(removeResult.value.itemCount).toBe(2);
    expect(removeResult.value.totalRecursadoCents).toBe(3000);

    // 5. Preencher justificativa geral e marcar pronto
    await withTenantTx(actor, (tx) =>
      tx.query(
        `UPDATE tiss.recurso_glosa SET justificativa_geral = $2 WHERE id = $1`,
        [recursoId, 'Todos os procedimentos contestados foram clinicamente indicados e realizados conforme protocolo vigente.'],
      ),
    );

    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.itemCount).toBe(2);

    // 5b. Nao pode adicionar glosa a recurso pronto
    const addAfterReady = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, recursoId, s.glosaIds[2], 'Tarde demais', 500),
    );
    expect(addAfterReady.ok).toBe(false);
    if (addAfterReady.ok) return;
    expect(addAfterReady.error.kind).toBe('recurso_nao_rascunho');

    // 6. Submeter via fake transport
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, transport, providerCtx),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.recursoId).toBe(recursoId);

    // Verifica que o transport recebeu o XML
    expect(transport.submittedRecursos).toHaveLength(1);
    expect(transport.submittedRecursos[0]!.recursoId).toBe(recursoId);

    // Verifica status no banco
    const { rows: sentRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ status: string; sent_at: string | null }>(
        `SELECT status, sent_at FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(sentRows[0]!.status).toBe('enviado');
    expect(sentRows[0]!.sent_at).toBeTruthy();

    // 7. Resolver como parcial (glosa 0 deferida, glosa 1 indeferida)
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, recursoId, {
        resultado: 'parcial',
        itensResolvidos: [
          { glosaId: s.glosaIds[0], resultado: 'deferido' },
          { glosaId: s.glosaIds[1], resultado: 'indeferido' },
        ],
      }),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.resultado).toBe('parcial');
    expect(resolveResult.value.itensDeferidos).toBe(1);
    expect(resolveResult.value.itensIndeferidos).toBe(1);

    // Verifica estado final no banco
    const { rows: finalRows } = await withTenantTx(actor, (tx) =>
      tx.query<{
        status: string;
        resolved_at: string | null;
        item_count: number;
        total_recursado_cents: string;
      }>(
        `SELECT status, resolved_at, item_count, total_recursado_cents
           FROM tiss.recurso_glosa WHERE id = $1`,
        [recursoId],
      ),
    );
    expect(finalRows[0]!.status).toBe('parcial');
    expect(finalRows[0]!.resolved_at).toBeTruthy();
    expect(finalRows[0]!.item_count).toBe(2);
    expect(Number(finalRows[0]!.total_recursado_cents)).toBe(3000);

    // Verifica resultado individual dos itens
    const { rows: itemRows } = await withTenantTx(actor, (tx) =>
      tx.query<{ glosa_id: string; resultado: string }>(
        `SELECT glosa_id, resultado FROM tiss.recurso_glosa_item
          WHERE recurso_id = $1 ORDER BY glosa_id`,
        [recursoId],
      ),
    );
    expect(itemRows).toHaveLength(2);
    const resultadoMap = new Map(itemRows.map(r => [r.glosa_id, r.resultado]));
    expect(resultadoMap.get(s.glosaIds[0])).toBe('deferido');
    expect(resultadoMap.get(s.glosaIds[1])).toBe('indeferido');
  });
});
```

- [ ] Rodar o teste de ciclo completo e confirmar que PASSA.

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/recurso-glosa/full-cycle.int.test.ts 2>&1 | tail -20
```

Saida esperada: o teste do ciclo completo passa.

- [ ] Rodar todos os testes do pacote tiss para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/tiss/src/ 2>&1 | tail -15
```

Saida esperada: todos os testes passam (incluindo os novos e os existentes).

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add packages/tiss/src/recurso-glosa/index.ts packages/tiss/src/recurso-glosa/full-cycle.int.test.ts packages/tiss/src/index.ts
git commit -m "feat(tiss): add recurso de glosa full cycle integration test and barrel exports"
```
### Task 25: tipo RecursoGlosaInput em serializer/types.ts

**Arquivos:** `packages/tiss/src/serializer/types.ts`

- [ ] Adicionar os tipos de entrada do recurso de glosa ao final de `types.ts`:

```ts
// --- em packages/tiss/src/serializer/types.ts (acrescentar ao final) ---

/** Um item de recurso de glosa individual — tag <ans:itemRecursoGlosa>. */
export interface ItemRecursoGlosaInput {
  /** Numero sequencial do item dentro do recurso. */
  readonly sequencialItem: string;
  /** Data do atendimento original, formato 'YYYY-MM-DD'. */
  readonly dataAtendimento: string;
  /** Numero da guia referenciada pelo recurso (guia do prestador). */
  readonly numeroGuiaPrestador: string;
  /** Numero da guia atribuido pela operadora, opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Codigo do procedimento TUSS contestado. */
  readonly codigoProcedimento: string;
  /** Codigo da glosa atribuido pela operadora (tabela TUSS de motivo de glosa). */
  readonly codigoGlosa: string;
  /** Valor recursado em centavos inteiros (Money.cents). */
  readonly valorRecursadoCentavos: number;
  /** Justificativa textual do prestador para o recurso, ate 500 caracteres. */
  readonly justificativa: string;
}

/** Dados do prestador contratado para o recurso — tag <ans:dadosContratado>. */
export interface ContratadoRecursoInput {
  /** Codigo do prestador na operadora. Exatamente um dos tres identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 digitos. */
  readonly cnes: string;
}

/** Entrada completa para serializar um recurso de glosa TISS. */
export interface RecursoGlosaInput {
  /** Cabecalho do XML TISS. Reutiliza o mesmo tipo do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Numero do lote original que sofreu a glosa. */
  readonly numeroLoteOriginal: string;
  /** Numero do recurso de glosa, unico por prestador. */
  readonly numeroRecursoGlosa: string;
  /** Dados do prestador contratado. */
  readonly contratado: ContratadoRecursoInput;
  /** Itens do recurso. Minimo 1. */
  readonly itens: readonly ItemRecursoGlosaInput[];
  /** ID da versao do encounter usada para gerar o recurso (§3.9). Nao vai no XML, mas e obrigatorio no input. */
  readonly encounterVersionId: string;
}
```

- [ ] Rodar o type-check para confirmar que compila sem erros:

```bash
npx tsc --noEmit -p packages/tiss/tsconfig.json
```

Saida esperada: nenhum erro.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.ts
git commit -m "feat(tiss): add RecursoGlosaInput types for glosa appeal serializer"
```

---

### Task 26: teste unitario dos tipos RecursoGlosaInput

**Arquivos:** `packages/tiss/src/serializer/types.test.ts`

- [ ] Ler o teste existente para entender o padrao:

```bash
cat packages/tiss/src/serializer/types.test.ts
```

- [ ] Acrescentar teste que valida que os tipos sao usaveis (type-level test + factory helper):

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/types.test.ts ---

import type {
  RecursoGlosaInput,
  ItemRecursoGlosaInput,
  ContratadoRecursoInput,
} from './types';

describe('RecursoGlosaInput', () => {
  function itemRecursoBase(): ItemRecursoGlosaInput {
    return {
      sequencialItem: '1',
      dataAtendimento: '2026-08-05',
      numeroGuiaPrestador: '00001',
      codigoProcedimento: '10101012',
      codigoGlosa: 'A10',
      valorRecursadoCentavos: 15000,
      justificativa: 'Procedimento realizado conforme indicacao clinica',
    };
  }

  function contratadoRecursoBase(): ContratadoRecursoInput {
    return {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    };
  }

  function recursoAmostra(): RecursoGlosaInput {
    return {
      cabecalho: {
        versaoPadrao: '4.01.00',
        registroANS: '339679',
        dataGeracao: '2026-08-07',
        horaGeracao: '14:30:00',
        sequencialTransacao: '12345',
      },
      registroANS: '339679',
      numeroLoteOriginal: '0001',
      numeroRecursoGlosa: 'RG0001',
      contratado: contratadoRecursoBase(),
      itens: [itemRecursoBase()],
      encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
    };
  }

  it('aceita entrada valida com todos os campos obrigatorios', () => {
    const input: RecursoGlosaInput = recursoAmostra();
    expect(input.cabecalho.versaoPadrao).toBe('4.01.00');
    expect(input.itens).toHaveLength(1);
    expect(input.encounterVersionId).toBeTruthy();
  });

  it('aceita item com numeroGuiaOperadora opcional', () => {
    const item: ItemRecursoGlosaInput = {
      ...itemRecursoBase(),
      numeroGuiaOperadora: 'OP98765',
    };
    expect(item.numeroGuiaOperadora).toBe('OP98765');
  });

  it('aceita contratado com CPF ao inves de CNPJ', () => {
    const contratado: ContratadoRecursoInput = {
      cpfContratado: '12345678901',
      cnes: '1234567',
    };
    expect(contratado.cpfContratado).toBe('12345678901');
    expect(contratado.cnpjContratado).toBeUndefined();
  });

  it('aceita contratado com codigoPrestadorNaOperadora', () => {
    const contratado: ContratadoRecursoInput = {
      codigoPrestadorNaOperadora: 'PREST001',
      cnes: '7654321',
    };
    expect(contratado.codigoPrestadorNaOperadora).toBe('PREST001');
  });

  it('aceita multiplos itens no recurso', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [
        itemRecursoBase(),
        { ...itemRecursoBase(), sequencialItem: '2', codigoGlosa: 'B15', valorRecursadoCentavos: 8050 },
      ],
    };
    expect(input.itens).toHaveLength(2);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
npx vitest run packages/tiss/src/serializer/types.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.test.ts
git commit -m "test(tiss): add RecursoGlosaInput type-level tests"
```

---

### Task 27: funcao computeRecursoGlosaHash e seu teste

**Arquivos:** `packages/tiss/src/serializer/compute-tiss-hash.ts`, `packages/tiss/src/serializer/compute-tiss-hash.test.ts`

O hash do recurso segue a mesma logica proprietaria do lote (concatenacao + MD5 hex), mas com campos diferentes: cabecalho + numeroLoteOriginal + numeroRecursoGlosa + por item (sequencialItem + codigoProcedimento + valorRecursado).

- [ ] Primeiro, ler o teste existente de hash para entender o padrao:

```bash
cat packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

- [ ] Acrescentar a funcao `computeRecursoGlosaHash` em `compute-tiss-hash.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/compute-tiss-hash.ts ---

import type { ItemRecursoGlosaInput } from './types';

/**
 * Calcula o hash MD5 proprietario do recurso de glosa TISS.
 *
 * Campos concatenados (ordem do XSD):
 *   cabecalho: registroANS + dataGeracao + horaGeracao + sequencialTransacao
 *   recurso: numeroLoteOriginal + numeroRecursoGlosa
 *   por item: sequencialItem + codigoProcedimento + valorRecursado
 *
 * O valor recursado e formatado como reais com 2 casas decimais.
 */
export function computeRecursoGlosaHash(
  cabecalho: CabecalhoInput,
  numeroLoteOriginal: string,
  numeroRecursoGlosa: string,
  itens: readonly ItemRecursoGlosaInput[],
): string {
  const parts: string[] = [];

  // Campos do cabecalho
  parts.push(cabecalho.registroANS);
  parts.push(cabecalho.dataGeracao);
  parts.push(cabecalho.horaGeracao);
  parts.push(cabecalho.sequencialTransacao);

  // Identificacao do recurso
  parts.push(numeroLoteOriginal);
  parts.push(numeroRecursoGlosa);

  // Campos de cada item na ordem de insercao
  for (const item of itens) {
    parts.push(item.sequencialItem);
    parts.push(item.codigoProcedimento);
    parts.push(formatValorReais(item.valorRecursadoCentavos));
  }

  const concatenated = parts.join('');
  return createHash('md5').update(concatenated, 'utf8').digest('hex');
}
```

Note: `createHash` e `CabecalhoInput` ja estao importados no topo do arquivo; `formatValorReais` ja existe. A unica adicao de import necessaria e `ItemRecursoGlosaInput`.

O import existente de `CabecalhoInput, GuiaConsultaInput` no topo do arquivo precisa ser expandido:

```ts
// --- alterar import existente em compute-tiss-hash.ts ---
// DE:
import type { CabecalhoInput, GuiaConsultaInput } from './types';
// PARA:
import type { CabecalhoInput, GuiaConsultaInput, ItemRecursoGlosaInput } from './types';
```

- [ ] Acrescentar testes para `computeRecursoGlosaHash` em `compute-tiss-hash.test.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/compute-tiss-hash.test.ts ---

import { computeRecursoGlosaHash } from './compute-tiss-hash';
import type { CabecalhoInput, ItemRecursoGlosaInput } from './types';

describe('computeRecursoGlosaHash', () => {
  const cabecalho: CabecalhoInput = {
    versaoPadrao: '4.01.00',
    registroANS: '339679',
    dataGeracao: '2026-08-07',
    horaGeracao: '14:30:00',
    sequencialTransacao: '12345',
  };

  const itemBase: ItemRecursoGlosaInput = {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };

  it('retorna string hexadecimal de 32 caracteres (MD5)', () => {
    const hash = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('e deterministico — mesmos dados, mesmo hash', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(h1).toBe(h2);
  });

  it('muda quando registroANS muda', () => {
    const cab2 = { ...cabecalho, registroANS: '999999' };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cab2, '0001', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroLoteOriginal muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '9999', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroRecursoGlosa muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0002', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando valor recursado de um item muda', () => {
    const item2: ItemRecursoGlosaInput = { ...itemBase, valorRecursadoCentavos: 20000 };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando a ordem dos itens muda', () => {
    const item2: ItemRecursoGlosaInput = {
      ...itemBase,
      sequencialItem: '2',
      codigoProcedimento: '10101039',
      valorRecursadoCentavos: 8050,
    };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase, item2]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2, itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('formata valor recursado como reais com 2 casas (ex: 15000 centavos -> "150.00")', () => {
    // Teste indireto: hash com 8050 centavos deve usar "80.50"
    // Verificamos que o hash e o esperado via calculo manual
    const { createHash: ch } = await import('node:crypto');
    const concat = '339679' + '2026-08-07' + '14:30:00' + '12345' + '0001' + 'RG0001'
      + '1' + '10101012' + '150.00';
    const expected = ch('md5').update(concat, 'utf8').digest('hex');
    const actual = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(actual).toBe(expected);
  });
});
```

- [ ] Rodar o teste e confirmar que o teste FALHA (funcao ainda nao existe no arquivo — vamos primeiro commitar o teste, depois a implementacao). Neste caso como estamos fazendo TDD inline, rodar apos adicionar tanto teste quanto implementacao:

```bash
npx vitest run packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

Saida esperada: todos os testes passam (incluindo os existentes de `computeTissHash` do lote + os novos de `computeRecursoGlosaHash`).

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/compute-tiss-hash.ts packages/tiss/src/serializer/compute-tiss-hash.test.ts
git commit -m "feat(tiss): add computeRecursoGlosaHash for glosa appeal MD5 hash"
```

---

### Task 28: funcao serializeRecursoGlosa e teste unitario principal

**Arquivos:** `packages/tiss/src/serializer/serialize-recurso-glosa.ts` (novo), `packages/tiss/src/serializer/serialize-recurso-glosa.test.ts` (novo)

- [ ] Criar o arquivo de teste `packages/tiss/src/serializer/serialize-recurso-glosa.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput, ItemRecursoGlosaInput, ContratadoRecursoInput } from './types';

function itemRecursoBase(): ItemRecursoGlosaInput {
  return {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };
}

function contratadoRecursoBase(): ContratadoRecursoInput {
  return {
    cnpjContratado: '11222333000181',
    cnes: '1234567',
  };
}

function recursoAmostra(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: contratadoRecursoBase(),
    itens: [itemRecursoBase()],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

describe('serializeRecursoGlosa', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeRecursoGlosa(recursoAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('contem cabecalho com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:versaoPadrao>4.01.00</ans:versaoPadrao>');
    expect(text).toContain('<ans:registroANS>339679</ans:registroANS>');
    expect(text).toContain('<ans:dataGeracao>2026-08-07</ans:dataGeracao>');
    expect(text).toContain('<ans:horaGeracao>14:30:00</ans:horaGeracao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
  });

  it('contem tag ans:recursoGlosa envolvendo o conteudo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:recursoGlosa>');
    expect(text).toContain('</ans:recursoGlosa>');
  });

  it('contem numero do lote original e numero do recurso', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLoteOriginal>0001</ans:numeroLoteOriginal>');
    expect(text).toContain('<ans:numeroRecursoGlosa>RG0001</ans:numeroRecursoGlosa>');
  });

  it('contem dados do contratado com CNPJ', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:dadosContratado>');
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('</ans:dadosContratado>');
  });

  it('contem dados do contratado com CPF quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('contem dados do contratado com codigoPrestadorNaOperadora quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { codigoPrestadorNaOperadora: 'PREST001', cnes: '7654321' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:codigoPrestadorNaOperadora>PREST001</ans:codigoPrestadorNaOperadora>',
    );
  });

  it('contem item de recurso com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:itemRecursoGlosa>');
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:dataAtendimento>2026-08-05</ans:dataAtendimento>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:codigoGlosa>A10</ans:codigoGlosa>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain(
      '<ans:justificativa>Procedimento realizado conforme indicacao clinica</ans:justificativa>',
    );
    expect(text).toContain('</ans:itemRecursoGlosa>');
  });

  it('inclui numeroGuiaOperadora quando presente no item', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{ ...itemRecursoBase(), numeroGuiaOperadora: 'OP98765' }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP98765</ans:numeroGuiaOperadora>');
  });

  it('omite numeroGuiaOperadora quando ausente no item', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
  });

  it('serializa multiplos itens de recurso', () => {
    const item2: ItemRecursoGlosaInput = {
      sequencialItem: '2',
      dataAtendimento: '2026-07-15',
      numeroGuiaPrestador: '00002',
      codigoProcedimento: '10101039',
      codigoGlosa: 'B15',
      valorRecursadoCentavos: 8050,
      justificativa: 'Exame necessario para diagnostico diferencial',
    };
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [itemRecursoBase(), item2],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:sequencialItem>2</ans:sequencialItem>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain('<ans:valorRecursado>80.50</ans:valorRecursado>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('escapa entidades XML na justificativa', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{
        ...itemRecursoBase(),
        justificativa: 'PA > 14 & FC < 100 "normal"',
      }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:justificativa>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:justificativa>',
    );
  });

  it('estrutura XML segue a ordem: cabecalho > prestadorParaOperadora > recursoGlosa > itens > epilogo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const idxCabecalho = text.indexOf('<ans:cabecalho>');
    const idxPrestador = text.indexOf('<ans:prestadorParaOperadora>');
    const idxRecurso = text.indexOf('<ans:recursoGlosa>');
    const idxItem = text.indexOf('<ans:itemRecursoGlosa>');
    const idxEpilogo = text.indexOf('<ans:epilogo>');
    expect(idxCabecalho).toBeLessThan(idxPrestador);
    expect(idxPrestador).toBeLessThan(idxRecurso);
    expect(idxRecurso).toBeLessThan(idxItem);
    expect(idxItem).toBeLessThan(idxEpilogo);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA (funcao ainda nao existe):

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
```

Saida esperada: falha com erro de import (modulo nao encontrado).

- [ ] Criar o arquivo de implementacao `packages/tiss/src/serializer/serialize-recurso-glosa.ts`:

```ts
import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeRecursoGlosaHash } from './compute-tiss-hash';
import type { RecursoGlosaInput, ItemRecursoGlosaInput } from './types';

/**
 * Resultado da serializacao de um recurso de glosa TISS.
 */
export interface SerializeRecursoGlosaResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um recurso de glosa TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do recurso).
 *
 * O encounterVersionId esta no input mas NAO vai no XML — e obrigatorio
 * para rastreabilidade (§3.9: recurso de glosa sempre cita a versao usada).
 */
export function serializeRecursoGlosa(input: RecursoGlosaInput): SerializeRecursoGlosaResult {
  const { cabecalho, numeroLoteOriginal, numeroRecursoGlosa, contratado, itens } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeRecursoGlosaHash(cabecalho, numeroLoteOriginal, numeroRecursoGlosa, itens);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > recursoGlosa ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');

  xml.tag('ans:registroANS', input.registroANS);
  xml.tag('ans:numeroLoteOriginal', numeroLoteOriginal);
  xml.tag('ans:numeroRecursoGlosa', numeroRecursoGlosa);

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', contratado.cnpjContratado);
  xml.tag('ans:CNES', contratado.cnes);
  xml.close('ans:dadosContratado');

  // Itens do recurso
  for (const item of itens) {
    emitItemRecurso(xml, item);
  }

  xml.close('ans:recursoGlosa');
  xml.close('ans:prestadorParaOperadora');

  // ---- Epilogo: hash ----
  xml.open('ans:epilogo');
  xml.tag('ans:hash', hash);
  xml.close('ans:epilogo');

  xml.close('ans:mensagemTISS');

  // Codifica para ISO-8859-1
  const encoded = encodeIso8859(xml.toString());

  return {
    xml: encoded.bytes,
    warnings: encoded.warnings,
  };
}

function emitCabecalho(xml: XmlBuilder, cab: RecursoGlosaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitItemRecurso(xml: XmlBuilder, item: ItemRecursoGlosaInput): void {
  xml.open('ans:itemRecursoGlosa');
  xml.tag('ans:sequencialItem', item.sequencialItem);
  xml.tag('ans:dataAtendimento', item.dataAtendimento);
  xml.tag('ans:numeroGuiaPrestador', item.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', item.numeroGuiaOperadora);
  xml.tag('ans:codigoProcedimento', item.codigoProcedimento);
  xml.tag('ans:codigoGlosa', item.codigoGlosa);
  xml.tag('ans:valorRecursado', formatValorReais(item.valorRecursadoCentavos));
  xml.tag('ans:justificativa', item.justificativa);
  xml.close('ans:itemRecursoGlosa');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

- [ ] Rodar o teste novamente e confirmar que passa:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/serialize-recurso-glosa.ts packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
git commit -m "feat(tiss): add serializeRecursoGlosa XML serializer for glosa appeal"
```

---

### Task 29: teste snapshot byte a byte e teste de acentos ISO-8859-1 no recurso de glosa

**Arquivos:** `packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts` (novo), `packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts` (novo)

- [ ] Criar o teste de snapshot `packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput } from './types';

/**
 * Recurso de glosa de amostra DETERMINISTICO — os mesmos dados sempre, para
 * que o snapshot byte a byte seja reproduzivel. Nenhum campo depende de relogio.
 */
function recursoAmostraDeterministico(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    },
    itens: [
      {
        sequencialItem: '1',
        dataAtendimento: '2026-08-05',
        numeroGuiaPrestador: '00001',
        numeroGuiaOperadora: 'OP98765',
        codigoProcedimento: '10101012',
        codigoGlosa: 'A10',
        valorRecursadoCentavos: 15000,
        justificativa: 'Procedimento realizado conforme indicação clínica documentada',
      },
      {
        sequencialItem: '2',
        dataAtendimento: '2026-07-15',
        numeroGuiaPrestador: '00002',
        codigoProcedimento: '10101039',
        codigoGlosa: 'B15',
        valorRecursadoCentavos: 8050,
        justificativa: 'Exame necessário para diagnóstico diferencial',
      },
    ],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

const FIXTURE_DIR = join(__dirname, '../../test/fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'recurso-glosa-amostra.xml');

describe('snapshot byte a byte do recurso de glosa', () => {
  it('gera XML deterministico e identico ao snapshot congelado', () => {
    const { xml, warnings } = serializeRecursoGlosa(recursoAmostraDeterministico());
    expect(warnings).toEqual([]);

    if (!existsSync(FIXTURE_PATH)) {
      // Primeira execucao: cria o snapshot
      if (!existsSync(FIXTURE_DIR)) {
        mkdirSync(FIXTURE_DIR, { recursive: true });
      }
      writeFileSync(FIXTURE_PATH, xml);
      // eslint-disable-next-line no-console
      console.log(`Snapshot criado: ${FIXTURE_PATH} (${xml.byteLength} bytes)`);
      // NAO falha na primeira execucao — o snapshot acabou de ser criado.
    }

    const expected = new Uint8Array(readFileSync(FIXTURE_PATH));
    expect(xml.byteLength).toBe(expected.byteLength);

    // Comparacao byte a byte com diagnostico util
    for (let i = 0; i < xml.byteLength; i++) {
      if (xml[i] !== expected[i]) {
        const context = new TextDecoder('iso-8859-1').decode(
          xml.slice(Math.max(0, i - 20), i + 20),
        );
        throw new Error(
          `Divergencia no byte ${i}: esperado 0x${expected[i]!.toString(16).padStart(2, '0')} ` +
          `mas recebeu 0x${xml[i]!.toString(16).padStart(2, '0')}. ` +
          `Contexto: ...${context}...`,
        );
      }
    }
  });

  it('o XML do snapshot e valido como texto ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostraDeterministico());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(text).toContain('</ans:mensagemTISS>');
    // Verifica que o acento em "indicacao" foi preservado em ISO-8859-1
    expect(text).toContain('indicação');
  });

  it('duas chamadas com os mesmos dados produzem bytes identicos', () => {
    const result1 = serializeRecursoGlosa(recursoAmostraDeterministico());
    const result2 = serializeRecursoGlosa(recursoAmostraDeterministico());
    expect(result1.xml).toEqual(result2.xml);
  });
});
```

- [ ] Rodar o teste de snapshot (a primeira execucao cria o fixture):

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts
```

Saida esperada: teste passa. Console imprime "Snapshot criado: ..." na primeira execucao. Na segunda execucao, compara byte a byte.

- [ ] Rodar pela segunda vez para garantir idempotencia:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts
```

Saida esperada: todos os testes passam sem criar snapshot novo.

- [ ] Criar o teste de acentos `packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput } from './types';

/**
 * Teste dedicado: caracteres acentuados do portugues brasileiro sao
 * preservados na justificativa do recurso de glosa (UTF-16 -> ISO-8859-1)
 * e na volta (decodificacao). Garante que justificativas com acentos
 * nao perdem informacao no XML TISS.
 */

function recursoComJustificativa(justificativa: string): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '1',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    },
    itens: [
      {
        sequencialItem: '1',
        dataAtendimento: '2026-08-05',
        numeroGuiaPrestador: '00001',
        codigoProcedimento: '10101012',
        codigoGlosa: 'A10',
        valorRecursadoCentavos: 15000,
        justificativa,
      },
    ],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

describe('preservacao de acentos ISO-8859-1 na justificativa do recurso de glosa', () => {
  const ACENTOS_PT_BR: readonly { readonly char: string; readonly nome: string; readonly byte: number }[] = [
    { char: 'é', nome: 'e com acento agudo', byte: 0xE9 },
    { char: 'á', nome: 'a com acento agudo', byte: 0xE1 },
    { char: 'ç', nome: 'c com cedilha', byte: 0xE7 },
    { char: 'ô', nome: 'o com acento circunflexo', byte: 0xF4 },
    { char: 'ú', nome: 'u com acento agudo', byte: 0xFA },
    { char: 'ã', nome: 'a com til', byte: 0xE3 },
    { char: 'õ', nome: 'o com til', byte: 0xF5 },
    { char: 'í', nome: 'i com acento agudo', byte: 0xED },
    { char: 'ê', nome: 'e com acento circunflexo', byte: 0xEA },
    { char: 'à', nome: 'a com acento grave', byte: 0xE0 },
    { char: 'ü', nome: 'u com trema', byte: 0xFC },
    { char: 'É', nome: 'E maiusculo com acento agudo', byte: 0xC9 },
    { char: 'Ã', nome: 'A maiusculo com til', byte: 0xC3 },
    { char: 'Õ', nome: 'O maiusculo com til', byte: 0xD5 },
  ];

  for (const { char, nome, byte: expectedByte } of ACENTOS_PT_BR) {
    it(`preserva ${nome} (${char} -> 0x${expectedByte.toString(16).toUpperCase()})`, () => {
      const just = `Justificativa com ${char} aqui`;
      const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(just));
      expect(warnings).toEqual([]);

      // Decodifica e verifica que o caractere acentuado aparece na saida
      const text = new TextDecoder('iso-8859-1').decode(xml);
      expect(text).toContain(char);

      // Verifica que o byte correto esta presente no array
      const bytes = Array.from(xml);
      expect(bytes).toContain(expectedByte);
    });
  }

  it('preserva frase completa com multiplos acentos do portugues na justificativa', () => {
    const frase = 'Prescrição médica adequada. Diagnóstico clínico confirmado. Não há contraindicação.';
    const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(frase));
    expect(warnings).toEqual([]);

    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(frase);
  });

  it('gera warning para caractere fora do ISO-8859-1 na justificativa sem perder acentos validos', () => {
    const fraseComEmoji = 'Procedimento necessário ❤ indicação clínica';
    const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(fraseComEmoji));

    // U+2764 (coracao) nao existe em ISO-8859-1
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('U+2764');

    // Mas os acentos validos foram preservados
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('necessário');
    expect(text).toContain('indicação');
    // O emoji foi substituido por ?
    expect(text).toContain('Procedimento necessário ? indicação clínica');
  });
});
```

- [ ] Rodar os testes de acentos:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar tudo junto (snapshot fixture + testes):

```bash
git add packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts packages/tiss/test/fixtures/recurso-glosa-amostra.xml
git commit -m "test(tiss): add snapshot and ISO-8859-1 accent tests for recurso de glosa serializer"
```

---

### Task 30: exportar serializeRecursoGlosa e tipos no index.ts do pacote tiss

**Arquivos:** `packages/tiss/src/index.ts`

- [ ] Adicionar os exports do recurso de glosa em `packages/tiss/src/index.ts`, logo apos o export de `serializeLoteConsulta`:

```ts
// --- em packages/tiss/src/index.ts, logo APOS a linha:
// export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
// ACRESCENTAR: ---

export type {
  RecursoGlosaInput,
  ItemRecursoGlosaInput,
  ContratadoRecursoInput,
} from './serializer/types';

export {
  serializeRecursoGlosa,
  type SerializeRecursoGlosaResult,
} from './serializer/serialize-recurso-glosa';

export { computeRecursoGlosaHash } from './serializer/compute-tiss-hash';
```

- [ ] Rodar type-check para confirmar que tudo compila:

```bash
npx tsc --noEmit -p packages/tiss/tsconfig.json
```

Saida esperada: nenhum erro.

- [ ] Rodar TODOS os testes do serializer para garantir que nada quebrou:

```bash
npx vitest run packages/tiss/src/serializer/
```

Saida esperada: todos os testes passam (incluindo os existentes do lote e os novos do recurso).

- [ ] Commitar:

```bash
git add packages/tiss/src/index.ts
git commit -m "feat(tiss): export serializeRecursoGlosa and RecursoGlosaInput from package index"
```
### Task 31: Migration 0127 — colunas SOAP em `tiss.contrato`

**Arquivos:**
- `packages/db/migrations/0127_tiss_contrato_soap_columns.sql`

**Passos**

- [ ] Criar o arquivo de migration com as tres colunas SOAP.

```sql
-- 0127_tiss_contrato_soap_columns.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5 bloco 06: colunas de credencial SOAP no contrato prestador x operadora.
-- Quando os tres campos estao preenchidos, o transport tiss-soap fica disponivel.
-- Quando todos sao NULL, o prestador continua usando tiss-arquivo.
-- Nenhuma leitura do relogio de quem executa neste schema — invariante de CI.

ALTER TABLE tiss.contrato
  ADD COLUMN soap_endpoint_url       text,
  ADD COLUMN soap_username           text,
  ADD COLUMN soap_password_encrypted text;

-- Invariante: se um campo SOAP existe, todos devem existir.
ALTER TABLE tiss.contrato
  ADD CONSTRAINT chk_soap_all_or_none
  CHECK (
    (soap_endpoint_url IS NULL AND soap_username IS NULL AND soap_password_encrypted IS NULL)
    OR
    (soap_endpoint_url IS NOT NULL AND soap_username IS NOT NULL AND soap_password_encrypted IS NOT NULL)
  );

COMMENT ON COLUMN tiss.contrato.soap_endpoint_url
  IS 'URL do webservice TISS da operadora (WSDL nao parseado — endpoint fixo por XSD)';
COMMENT ON COLUMN tiss.contrato.soap_username
  IS 'Usuario para HTTP Basic Auth no webservice TISS';
COMMENT ON COLUMN tiss.contrato.soap_password_encrypted
  IS 'Senha criptografada (AES-256-GCM) para HTTP Basic Auth no webservice TISS';
```

- [ ] Rodar a migration e confirmar que aplica sem erro.

```bash
pnpm db:migrate
```

Saida esperada: `0127_tiss_contrato_soap_columns.sql` aplicada com sucesso.

- [ ] Confirmar que a constraint funciona: tentar INSERT com campo parcial deve falhar.

```bash
pnpm vitest run packages/tiss/src/contrato.int.test.ts
```

Saida esperada: testes existentes passam (nenhum usa as colunas SOAP, todos inserem NULL implicito).

- [ ] Commitar.

```bash
git add packages/db/migrations/0127_tiss_contrato_soap_columns.sql
git commit -m "feat(db): add SOAP credential columns to tiss.contrato (migration 0127)"
```

---

### Task 32: Teste e implementacao — factory `createTissSoapTransport` e `SoapNotConfigured`

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (criar)
- `packages/tiss/src/transport/tiss-soap.ts` (criar)

**Passos**

- [ ] Criar o arquivo de teste com os casos da factory (credencial ausente e propriedades basicas).

```ts
// packages/tiss/src/transport/tiss-soap.test.ts
import { describe, expect, it } from 'vitest';
import { createTissSoapTransport, type TissSoapOptions } from './tiss-soap';
import { assertSafetyDeclared } from '@cadencia/integrations';

describe('TissSoapTransport', () => {
  describe('criacao (factory)', () => {
    it('retorna SoapNotConfigured se soapEndpointUrl ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapUsername ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: '',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapPassword ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: 'user',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured com detail descritivo', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: '',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.detail).toContain('SOAP');
    });

    it('retorna Ok com transport valido quando credenciais presentes', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
    });

    it('transport tem id "tiss-soap" e mode "webservice"', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('tiss-soap');
      expect(result.value.mode).toBe('webservice');
    });

    it('tissVersion reflete o valor passado', () => {
      const result = createTissSoapTransport({
        tissVersion: '3.05.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tissVersion).toBe('3.05.00');
    });

    it('safety declara os tres metodos publicos', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(assertSafetyDeclared(
        result.value,
        ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'],
      )).toBe(true);
    });

    it('capabilities inclui residency:br e tiss-soap', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capabilities.has('residency:br')).toBe(true);
      expect(result.value.capabilities.has('tiss-soap')).toBe(true);
    });

    it('health retorna up: true', async () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const h = await result.value.health();
      expect(h.up).toBe(true);
      expect(h.checkedAt).toBeDefined();
    });
  });
});
```

- [ ] Rodar e confirmar que FALHA (modulo `./tiss-soap` nao existe ainda).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: erro de importacao — modulo nao encontrado.

- [ ] Criar a implementacao com a factory e metodos stub.

```ts
// packages/tiss/src/transport/tiss-soap.ts
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  asRfc3339, failure, success,
  type ProviderCtx, type ProviderResult, type Rfc3339,
} from '@cadencia/integrations';
import { err, ok, isoFromMs, systemClock, type Result } from '@cadencia/kernel';
import type { TissSubmissionReceipt, TissTransport } from './types';

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export type SoapNotConfigured = { kind: 'soap_not_configured'; detail: string };

export interface TissSoapOptions {
  readonly tissVersion: string;
  readonly soapEndpointUrl: string;
  readonly soapUsername: string;
  readonly soapPassword: string;
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const TISS_NS = 'http://www.ans.gov.br/padroes/tiss/schemas';

function agora(): Rfc3339 {
  return asRfc3339(isoFromMs(systemClock.nowMs())) ?? ('1970-01-01T00:00:00.000Z' as Rfc3339);
}

export function buildSoapEnvelope(operacao: string, innerXml: string): string {
  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>\n' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"' +
    ` xmlns:ans="${TISS_NS}">\n` +
    '<soap:Body>\n' +
    `<ans:${operacao}>\n` +
    innerXml + '\n' +
    `</ans:${operacao}>\n` +
    '</soap:Body>\n' +
    '</soap:Envelope>'
  );
}

export function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([^<]+)</(?:[^:]+:)?${tag}>`);
  const m = xml.match(re);
  return m?.[1] ?? null;
}

export function isSoapFault(xml: string): { faultCode: string; faultString: string } | null {
  if (!xml.includes('Fault')) return null;
  const code = extractTag(xml, 'faultcode');
  const str = extractTag(xml, 'faultstring');
  if (code && str) return { faultCode: code, faultString: str };
  return null;
}

interface HttpPostResult {
  readonly statusCode: number;
  readonly body: string;
}

export function httpPost(
  url: string,
  body: Buffer,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpPostResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;

    const req: ClientRequest = reqFn(
      parsed,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=ISO-8859-1',
          'Content-Length': body.length.toString(),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (!settled) {
            settled = true;
            resolve({
              statusCode: res.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('latin1'),
            });
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('SOAP_TIMEOUT'));
    });

    req.on('error', (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTissSoapTransport(
  opts: TissSoapOptions,
): Result<TissTransport, SoapNotConfigured> {
  if (!opts.soapEndpointUrl || !opts.soapUsername || !opts.soapPassword) {
    return err({
      kind: 'soap_not_configured' as const,
      detail:
        'Credenciais SOAP ausentes no contrato: endpoint, username ou password nao configurados',
    });
  }

  const {
    soapEndpointUrl,
    soapUsername,
    soapPassword,
    tissVersion,
    timeoutMs = 30_000,
  } = opts;

  const basicAuth = Buffer.from(`${soapUsername}:${soapPassword}`).toString('base64');

  async function soapCall(
    operacao: string,
    soapAction: string,
    innerXml: string,
    deadlineMs: number,
  ): Promise<ProviderResult<string>> {
    const envelope = buildSoapEnvelope(operacao, innerXml);
    const body = Buffer.from(envelope, 'latin1');
    const effectiveTimeout = Math.min(timeoutMs, deadlineMs);

    let response: HttpPostResult;
    try {
      response = await httpPost(
        soapEndpointUrl,
        body,
        {
          SOAPAction: soapAction,
          Authorization: `Basic ${basicAuth}`,
        },
        effectiveTimeout,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg === 'SOAP_TIMEOUT' ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('socket hang up')
      ) {
        return failure({
          kind: 'timeout',
          retrySafe: false,
          detail: `SOAP timeout apos ${effectiveTimeout}ms para ${soapEndpointUrl}`,
        });
      }
      return failure({
        kind: 'unavailable',
        retrySafe: true,
        detail: `Erro de conexao SOAP: ${msg}`,
      });
    }

    const fault = isSoapFault(response.body);
    if (fault) {
      return failure({
        kind: 'rejected',
        retrySafe: false,
        code: fault.faultCode,
        detail: fault.faultString,
      });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return failure({
        kind: 'unavailable',
        retrySafe: true,
        detail: `HTTP ${response.statusCode} de ${soapEndpointUrl}`,
      });
    }

    return success(response.body, `soap-${operacao}`);
  }

  const transport: TissTransport = {
    id: 'tiss-soap',
    mode: 'webservice',
    tissVersion,
    capabilities: new Set(['residency:br', 'tiss-soap']),
    safety: {
      submitBatch: 'unsafe',
      fetchDemonstrativo: 'safe',
      submitRecursoGlosa: 'unsafe',
    },

    async health() {
      return { up: true, latencyMs: 0, checkedAt: agora() };
    },

    async submitBatch(ctx: ProviderCtx, i) {
      const xmlContent = Buffer.from(i.xml).toString('latin1');
      const result = await soapCall(
        'tissFaturamentoWS',
        'tissFaturamentoWS',
        xmlContent,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const protocolo = extractTag(result.value, 'protocolo');
      const dataRecebimento = extractTag(result.value, 'dataRecebimento');

      if (!protocolo) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'PROTOCOLO_AUSENTE',
          detail: 'Resposta SOAP nao contem <protocolo>',
        });
      }

      const recebidoEm = dataRecebimento
        ? (asRfc3339(dataRecebimento) ?? agora())
        : agora();

      const receipt: TissSubmissionReceipt = {
        kind: 'protocolo',
        protocolo,
        recebidoEm,
      };
      return success(receipt, `soap-lote-${i.loteId}`);
    },

    async fetchDemonstrativo(ctx: ProviderCtx, i) {
      const innerXml =
        `<ans:protocolo>${i.protocolo}</ans:protocolo>`;
      const result = await soapCall(
        'tissSolicitacaoDemonstrativoRetorno',
        'tissSolicitacaoDemonstrativoRetorno',
        innerXml,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const tipoDemonstrativo = extractTag(result.value, 'tipoDemonstrativo');
      const xmlContent = extractTag(result.value, 'demonstrativoXml');

      if (!xmlContent) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'DEMONSTRATIVO_AUSENTE',
          detail: 'Resposta SOAP nao contem <demonstrativoXml>',
        });
      }

      const xmlBytes = Buffer.from(xmlContent, 'latin1');
      const kind: 'analise' | 'pagamento' =
        tipoDemonstrativo === 'pagamento' ? 'pagamento' : 'analise';

      return success(
        { xml: new Uint8Array(xmlBytes), kind },
        `soap-demo-${i.protocolo}`,
      );
    },

    async submitRecursoGlosa(ctx: ProviderCtx, i) {
      const xmlContent = Buffer.from(i.xml).toString('latin1');
      const result = await soapCall(
        'tissRecursoGlosa',
        'tissRecursoGlosa',
        xmlContent,
        ctx.deadlineMs,
      );
      if (!result.ok) return result;

      const protocolo = extractTag(result.value, 'protocolo');
      const dataRecebimento = extractTag(result.value, 'dataRecebimento');

      if (!protocolo) {
        return failure({
          kind: 'rejected',
          retrySafe: false,
          code: 'PROTOCOLO_AUSENTE',
          detail: 'Resposta SOAP nao contem <protocolo> para recurso de glosa',
        });
      }

      const recebidoEm = dataRecebimento
        ? (asRfc3339(dataRecebimento) ?? agora())
        : agora();

      const receipt: TissSubmissionReceipt = {
        kind: 'protocolo',
        protocolo,
        recebidoEm,
      };
      return success(receipt, `soap-recurso-${i.recursoId}`);
    },
  };

  return ok(transport);
}
```

- [ ] Rodar e confirmar que os testes PASSAM.

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 9 testes passam.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.ts packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "feat(tiss): add createTissSoapTransport factory with SoapNotConfigured check"
```

---

### Task 33: Teste — `submitBatch` via SOAP com mock HTTP retorna protocolo

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao final do `describe('TissSoapTransport')` o bloco de testes de `submitBatch` usando um servidor HTTP mock local.

```ts
// --- adicionar estas importacoes ao topo do arquivo tiss-soap.test.ts ---
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createTissSoapTransport, type TissSoapOptions } from './tiss-soap';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-soap-001',
  actorUserId: 'user-soap-001',
  requestId: 'req-soap-001',
  idempotencyKey: 'idem-soap-001',
  deadlineMs: 10_000,
};

// --- adicionar este describe DENTRO de describe('TissSoapTransport'), apos describe('criacao (factory)') ---

  describe('submitBatch via SOAP', () => {
    let server: Server;
    let port: number;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;

    beforeAll(async () => {
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function readBody(req: IncomingMessage): Promise<string> {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
      });
    }

    function soapOpts(): TissSoapOptions {
      return {
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'operadora_user',
        soapPassword: 'operadora_pass',
        timeoutMs: 5_000,
      };
    }

    it('submitBatch envia envelope SOAP e extrai protocolo da resposta', async () => {
      handler = async (req, res) => {
        const body = await readBody(req);
        expect(body).toContain('soap:Envelope');
        expect(body).toContain('tissFaturamentoWS');
        expect(req.headers['soapaction']).toBe('tissFaturamentoWS');
        expect(req.headers['authorization']).toContain('Basic ');
        expect(req.headers['content-type']).toContain('ISO-8859-1');

        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<protocoloRecebimento>' +
          '<protocolo>PROT-2026-001</protocolo>' +
          '<dataRecebimento>2026-08-07T10:30:00.000Z</dataRecebimento>' +
          '</protocoloRecebimento>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const transport = r.value;

      const xml = new TextEncoder().encode('<loteGuias>conteudo SOAP</loteGuias>');
      const result = await transport.submitBatch(ctx, {
        loteId: 'lote-soap-001',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('protocolo');
      if (result.value.kind !== 'protocolo') return;
      expect(result.value.protocolo).toBe('PROT-2026-001');
      expect(result.value.recebidoEm).toBe('2026-08-07T10:30:00.000Z');
    });

    it('submitBatch retorna rejected quando SOAP Fault', async () => {
      handler = (_req, res) => {
        const faultXml =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<soap:Fault>' +
          '<faultcode>soap:Server</faultcode>' +
          '<faultstring>Lote rejeitado: duplicidade de protocolo</faultstring>' +
          '</soap:Fault>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(500, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(faultXml);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote duplicado</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-dup',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('soap:Server');
      expect(result.error.detail).toContain('duplicidade');
    });

    it('submitBatch retorna unavailable quando HTTP 503', async () => {
      handler = (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote 503</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-503',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('unavailable');
      expect(result.error.retrySafe).toBe(true);
    });

    it('submitBatch retorna rejected quando resposta nao contem protocolo', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><vazio/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>sem protocolo</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-sem-prot',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('PROTOCOLO_AUSENTE');
    });
  });
```

O arquivo de teste completo (com as importacoes ja incluindo as novas) fica assim:

```ts
// packages/tiss/src/transport/tiss-soap.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createTissSoapTransport, type TissSoapOptions } from './tiss-soap';
import type { ProviderCtx } from '@cadencia/integrations';
import { assertSafetyDeclared } from '@cadencia/integrations';

const ctx: ProviderCtx = {
  tenantId: 'tenant-soap-001',
  actorUserId: 'user-soap-001',
  requestId: 'req-soap-001',
  idempotencyKey: 'idem-soap-001',
  deadlineMs: 10_000,
};

describe('TissSoapTransport', () => {
  describe('criacao (factory)', () => {
    it('retorna SoapNotConfigured se soapEndpointUrl ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapUsername ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: '',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured se soapPassword ausente', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://example.com/tiss',
        soapUsername: 'user',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('soap_not_configured');
    });

    it('retorna SoapNotConfigured com detail descritivo', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: '',
        soapUsername: '',
        soapPassword: '',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.detail).toContain('SOAP');
    });

    it('retorna Ok com transport valido quando credenciais presentes', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
    });

    it('transport tem id "tiss-soap" e mode "webservice"', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe('tiss-soap');
      expect(result.value.mode).toBe('webservice');
    });

    it('tissVersion reflete o valor passado', () => {
      const result = createTissSoapTransport({
        tissVersion: '3.05.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tissVersion).toBe('3.05.00');
    });

    it('safety declara os tres metodos publicos', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(assertSafetyDeclared(
        result.value,
        ['submitBatch', 'fetchDemonstrativo', 'submitRecursoGlosa'],
      )).toBe(true);
    });

    it('capabilities inclui residency:br e tiss-soap', () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capabilities.has('residency:br')).toBe(true);
      expect(result.value.capabilities.has('tiss-soap')).toBe(true);
    });

    it('health retorna up: true', async () => {
      const result = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
        soapUsername: 'user',
        soapPassword: 'pass',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const h = await result.value.health();
      expect(h.up).toBe(true);
      expect(h.checkedAt).toBeDefined();
    });
  });

  describe('submitBatch via SOAP', () => {
    let server: Server;
    let port: number;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;

    beforeAll(async () => {
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function readBody(req: IncomingMessage): Promise<string> {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
      });
    }

    function soapOpts(): TissSoapOptions {
      return {
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'operadora_user',
        soapPassword: 'operadora_pass',
        timeoutMs: 5_000,
      };
    }

    it('submitBatch envia envelope SOAP e extrai protocolo da resposta', async () => {
      handler = async (req, res) => {
        const body = await readBody(req);
        expect(body).toContain('soap:Envelope');
        expect(body).toContain('tissFaturamentoWS');
        expect(req.headers['soapaction']).toBe('tissFaturamentoWS');
        expect(req.headers['authorization']).toContain('Basic ');
        expect(req.headers['content-type']).toContain('ISO-8859-1');

        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<protocoloRecebimento>' +
          '<protocolo>PROT-2026-001</protocolo>' +
          '<dataRecebimento>2026-08-07T10:30:00.000Z</dataRecebimento>' +
          '</protocoloRecebimento>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const transport = r.value;

      const xml = new TextEncoder().encode('<loteGuias>conteudo SOAP</loteGuias>');
      const result = await transport.submitBatch(ctx, {
        loteId: 'lote-soap-001',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('protocolo');
      if (result.value.kind !== 'protocolo') return;
      expect(result.value.protocolo).toBe('PROT-2026-001');
      expect(result.value.recebidoEm).toBe('2026-08-07T10:30:00.000Z');
    });

    it('submitBatch retorna rejected quando SOAP Fault', async () => {
      handler = (_req, res) => {
        const faultXml =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<soap:Fault>' +
          '<faultcode>soap:Server</faultcode>' +
          '<faultstring>Lote rejeitado: duplicidade de protocolo</faultstring>' +
          '</soap:Fault>' +
          '</soap:Body>' +
          '</soap:Envelope>';

        res.writeHead(500, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(faultXml);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote duplicado</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-dup',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('soap:Server');
      expect(result.error.detail).toContain('duplicidade');
    });

    it('submitBatch retorna unavailable quando HTTP 503', async () => {
      handler = (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>lote 503</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-503',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('unavailable');
      expect(result.error.retrySafe).toBe(true);
    });

    it('submitBatch retorna rejected quando resposta nao contem protocolo', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><vazio/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>sem protocolo</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-soap-sem-prot',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('PROTOCOLO_AUSENTE');
    });
  });
});
```

- [ ] Rodar e confirmar que os testes PASSAM (a implementacao ja foi criada na Task 32).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 13 testes passam.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add submitBatch SOAP tests with mock HTTP server"
```

---

### Task 34: Teste — timeout SOAP resulta em estado indeterminado, NUNCA retry automatico

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao `describe('TissSoapTransport')`, apos o bloco de `submitBatch`, um novo bloco para testar o comportamento de timeout. O mock server nao responde e o timeout curto (200ms) dispara, validando que o resultado e `failure` com `kind: 'timeout'` e `retrySafe: false` (NUNCA retry automatico em operacao unsafe).

```ts
// --- adicionar este describe DENTRO de describe('TissSoapTransport'),
//     apos describe('submitBatch via SOAP') ---

  describe('timeout — estado indeterminado, NUNCA retry (secao 7)', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((_req, _res) => {
        // Proposital: nunca responde. Conexao fica aberta ate timeout.
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('submitBatch com timeout curto retorna failure kind "timeout"', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>timeout test</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-timeout',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      expect(result.error.detail).toContain('timeout');
    }, 10_000);

    it('timeout tem retrySafe: false — NUNCA retry automatico em operacao unsafe', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>no retry</loteGuias>');
      const result = await r.value.submitBatch(ctx, {
        loteId: 'lote-no-retry',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      // A regra mais cara do documento: timeout em operacao unsafe NAO permite retry.
      // retrySafe: false garante que o caller sabe que NAO pode reenviar.
      expect(result.error.retrySafe).toBe(false);
    }, 10_000);

    it('submitRecursoGlosa com timeout tambem retorna retrySafe: false', async () => {
      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 200,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>timeout glosa</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-timeout',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
      expect(result.error.retrySafe).toBe(false);
    }, 10_000);

    it('deadline mais curto que timeoutMs prevalece', async () => {
      const shortDeadlineCtx: ProviderCtx = {
        ...ctx,
        deadlineMs: 150, // menor que timeoutMs=5000
      };

      const r = createTissSoapTransport({
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 5_000,
      });
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<loteGuias>deadline curto</loteGuias>');
      const result = await r.value.submitBatch(shortDeadlineCtx, {
        loteId: 'lote-deadline',
        xml,
        operadoraCnpj: '12ABC34503DE37',
        prestador: { cnpj: '98XYZ76543AB21', cnes: '2077501' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('timeout');
    }, 10_000);
  });
```

- [ ] Rodar e confirmar que os testes PASSAM (a implementacao ja trata timeout em `soapCall`).

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 17 testes passam (9 factory + 4 submitBatch + 4 timeout).

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add SOAP timeout tests — estado indeterminado, NUNCA retry automatico"
```

---

### Task 35: Teste — `fetchDemonstrativo` e `submitRecursoGlosa` via SOAP

**Arquivos:**
- `packages/tiss/src/transport/tiss-soap.test.ts` (editar)

**Passos**

- [ ] Adicionar ao `describe('TissSoapTransport')`, apos o bloco de timeout, um novo bloco para testar `fetchDemonstrativo` e `submitRecursoGlosa`. Ambos usam mock HTTP local com respostas SOAP especificas.

```ts
// --- adicionar este describe DENTRO de describe('TissSoapTransport'),
//     apos describe('timeout') ---

  describe('fetchDemonstrativo e submitRecursoGlosa via SOAP', () => {
    let server: Server;
    let port: number;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;

    beforeAll(async () => {
      server = createServer((req, res) => handler(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    function soapOpts(): TissSoapOptions {
      return {
        tissVersion: '4.01.00',
        soapEndpointUrl: `http://127.0.0.1:${port}/tiss`,
        soapUsername: 'user',
        soapPassword: 'pass',
        timeoutMs: 5_000,
      };
    }

    it('fetchDemonstrativo extrai XML e kind "analise" da resposta SOAP', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissSolicitacaoDemonstrativoRetornoResponse>' +
          '<tipoDemonstrativo>analise</tipoDemonstrativo>' +
          '<demonstrativoXml>conteudo-demonstrativo-xml</demonstrativoXml>' +
          '</tissSolicitacaoDemonstrativoRetornoResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-2026-001',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('analise');
      const xmlText = Buffer.from(result.value.xml).toString('latin1');
      expect(xmlText).toBe('conteudo-demonstrativo-xml');
    });

    it('fetchDemonstrativo extrai kind "pagamento" quando indicado', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissSolicitacaoDemonstrativoRetornoResponse>' +
          '<tipoDemonstrativo>pagamento</tipoDemonstrativo>' +
          '<demonstrativoXml>demonstrativo-pago</demonstrativoXml>' +
          '</tissSolicitacaoDemonstrativoRetornoResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-2026-002',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('pagamento');
    });

    it('fetchDemonstrativo retorna rejected quando demonstrativoXml ausente', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><vazio/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const result = await r.value.fetchDemonstrativo(ctx, {
        protocolo: 'PROT-VAZIO',
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('DEMONSTRATIVO_AUSENTE');
    });

    it('submitRecursoGlosa envia XML e extrai protocolo da resposta', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<tissRecursoGlosaResponse>' +
          '<protocolo>REC-PROT-001</protocolo>' +
          '<dataRecebimento>2026-08-08T14:00:00.000Z</dataRecebimento>' +
          '</tissRecursoGlosaResponse>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recursoGlosa>dados do recurso</recursoGlosa>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-glosa-001',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('protocolo');
      if (result.value.kind !== 'protocolo') return;
      expect(result.value.protocolo).toBe('REC-PROT-001');
      expect(result.value.recebidoEm).toBe('2026-08-08T14:00:00.000Z');
    });

    it('submitRecursoGlosa retorna rejected quando protocolo ausente', async () => {
      handler = (_req, res) => {
        const resposta =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body><semProtocolo/></soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(resposta);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>sem resposta</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-glosa-sem',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('PROTOCOLO_AUSENTE');
    });

    it('submitRecursoGlosa retorna rejected quando SOAP Fault', async () => {
      handler = (_req, res) => {
        const faultXml =
          '<?xml version="1.0" encoding="ISO-8859-1"?>' +
          '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
          '<soap:Body>' +
          '<soap:Fault>' +
          '<faultcode>soap:Client</faultcode>' +
          '<faultstring>Recurso de glosa nao pertence ao prestador</faultstring>' +
          '</soap:Fault>' +
          '</soap:Body>' +
          '</soap:Envelope>';
        res.writeHead(500, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
        res.end(faultXml);
      };

      const r = createTissSoapTransport(soapOpts());
      if (!r.ok) return;

      const xml = new TextEncoder().encode('<recurso>glosa invalida</recurso>');
      const result = await r.value.submitRecursoGlosa(ctx, {
        recursoId: 'rec-fault',
        xml,
        operadoraCnpj: '12ABC34503DE37',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('rejected');
      if (result.error.kind !== 'rejected') return;
      expect(result.error.code).toBe('soap:Client');
      expect(result.error.detail).toContain('nao pertence');
    });
  });
```

- [ ] Rodar e confirmar que TODOS os testes passam.

```bash
pnpm vitest run packages/tiss/src/transport/tiss-soap.test.ts
```

Saida esperada: todos os 23 testes passam (9 factory + 4 submitBatch + 4 timeout + 6 fetchDemo/recurso).

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/tiss-soap.test.ts
git commit -m "test(tiss): add fetchDemonstrativo and submitRecursoGlosa SOAP tests"
```

---

### Task 36: Registry condicional — registrar `tiss-soap` + atualizar invariante + exports

**Arquivos:**
- `packages/tiss/src/transport/registry.ts` (editar)
- `packages/tiss/src/transport/registry.test.ts` (editar)
- `packages/tiss/src/transport/registry-invariant.test.ts` (editar)
- `packages/tiss/src/index.ts` (editar)

**Passos**

- [ ] Editar `packages/tiss/src/transport/registry.ts` para registrar `tiss-soap` no registry.

```ts
// packages/tiss/src/transport/registry.ts
import type { TissTransport } from './types';
import { createTissArquivoTransport, type TissArquivoOptions } from './tiss-arquivo';
import {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './tiss-soap';
import type { Result } from '@cadencia/kernel';

/**
 * Registry de transports TISS. Congelado em runtime.
 *
 * tiss-arquivo: sempre disponivel — gera arquivo para upload manual no portal.
 * tiss-soap: disponivel quando a operadora tem soap_endpoint configurado no
 *   contrato. A factory retorna Result — se credenciais ausentes, o caller
 *   recebe SoapNotConfigured em vez de exception.
 */

type ArquivoFactory = (opts: TissArquivoOptions) => TissTransport;
type SoapFactory = (opts: TissSoapOptions) => Result<TissTransport, SoapNotConfigured>;

export type TransportFactory = ArquivoFactory | SoapFactory;

export const TISS_TRANSPORT_REGISTRY: Readonly<Record<string, TransportFactory>> =
  Object.freeze({
    'tiss-arquivo': createTissArquivoTransport,
    'tiss-soap': createTissSoapTransport,
  });

export function getTransportIds(): string[] {
  return Object.keys(TISS_TRANSPORT_REGISTRY);
}

export function getTransportFactory(id: string): TransportFactory | undefined {
  return TISS_TRANSPORT_REGISTRY[id];
}
```

- [ ] Editar `packages/tiss/src/transport/registry-invariant.test.ts` — remover a restricao da Fase 4. O `tiss-soap` agora existe e esta registrado.

```ts
// packages/tiss/src/transport/registry-invariant.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe com credencial real (Fase 5)', () => {
  it('o arquivo tiss-soap.ts existe em packages/tiss/src/transport/', () => {
    const soapFile = resolve(import.meta.dirname, 'tiss-soap.ts');
    expect(existsSync(soapFile)).toBe(true);
  });

  it('o registry exporta tiss-soap como transport disponivel', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    expect(getTransportIds()).toContain('tiss-soap');
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('o registry exporta tiss-arquivo E tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
  });
});
```

- [ ] Editar `packages/tiss/src/transport/registry.test.ts` para aceitar os dois transports.

```ts
// packages/tiss/src/transport/registry.test.ts
import { describe, expect, it } from 'vitest';
import {
  getTransportIds,
  getTransportFactory,
  TISS_TRANSPORT_REGISTRY,
} from './registry';

describe('registry de transports TISS', () => {
  it('registry conhece tiss-arquivo e tiss-soap', () => {
    const ids = getTransportIds();
    expect(ids).toEqual(['tiss-arquivo', 'tiss-soap']);
  });

  it('getTransportFactory retorna a factory de tiss-arquivo', () => {
    const factory = getTransportFactory('tiss-arquivo');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna a factory de tiss-soap', () => {
    const factory = getTransportFactory('tiss-soap');
    expect(factory).toBeDefined();
    expect(typeof factory).toBe('function');
  });

  it('getTransportFactory retorna undefined para id desconhecido', () => {
    expect(getTransportFactory('tiss-inexistente')).toBeUndefined();
  });

  it('TISS_TRANSPORT_REGISTRY e congelado (nao pode ser modificado em runtime)', () => {
    expect(Object.isFrozen(TISS_TRANSPORT_REGISTRY)).toBe(true);
  });

  it('factory de tiss-arquivo cria transport com mode "arquivo"', () => {
    const factory = getTransportFactory('tiss-arquivo')!;
    const { InMemoryStorageAdapter } = require('@cadencia/storage');
    const transport = factory({
      storage: new InMemoryStorageAdapter(),
      tissVersion: '4.01.00',
    }) as import('./types').TissTransport;
    expect(transport.id).toBe('tiss-arquivo');
    expect(transport.mode).toBe('arquivo');
    expect(transport.tissVersion).toBe('4.01.00');
  });

  it('factory de tiss-soap retorna SoapNotConfigured sem credenciais', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: '',
      soapUsername: '',
      soapPassword: '',
    }) as { ok: boolean; error?: { kind: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('soap_not_configured');
  });

  it('factory de tiss-soap retorna Ok com credenciais validas', () => {
    const factory = getTransportFactory('tiss-soap')!;
    const result = (factory as Function)({
      tissVersion: '4.01.00',
      soapEndpointUrl: 'http://127.0.0.1:9999/tiss',
      soapUsername: 'user',
      soapPassword: 'pass',
    }) as { ok: boolean; value?: { id: string; mode: string } };
    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe('tiss-soap');
    expect(result.value?.mode).toBe('webservice');
  });
});
```

- [ ] Editar `packages/tiss/src/index.ts` para exportar os novos tipos e a factory.

```ts
// packages/tiss/src/index.ts
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

export type {
  ProjectionResult, ProjectedResult, SkippedResult,
  ProjectionError, DadosAusentesError, TussNaoVigenteError,
} from './project-guia';
export { projectGuiaConsulta } from './project-guia';

export { reprojectGuiaOnAmend, type ReprojectAction, type ReprojectError } from './reproject-guia';

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

export type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './serializer/types';

export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
export { encodeIso8859, type EncodeResult } from './serializer/encode-iso8859';
export { computeTissHash } from './serializer/compute-tiss-hash';
export { XmlBuilder } from './serializer/xml-builder';

export type { TissSubmissionReceipt, TissTransport } from './transport/types';
export { createTissArquivoTransport, type TissArquivoOptions } from './transport/tiss-arquivo';
export {
  getTransportIds, getTransportFactory, TISS_TRANSPORT_REGISTRY,
  type TransportFactory,
} from './transport/registry';
export {
  createFakeTissArquivoTransport,
  type FakeTissArquivoOptions,
  type FakeTissArquivoTransport,
  type ModoFakeTiss,
  type SubmittedBatch,
} from './transport/tiss-arquivo-fake';
export {
  createTissSoapTransport,
  type TissSoapOptions,
  type SoapNotConfigured,
} from './transport/tiss-soap';
```

- [ ] Rodar todos os testes de transport para confirmar que nada quebrou.

```bash
pnpm vitest run packages/tiss/src/transport/
```

Saida esperada: todos os testes passam — registry, registry-invariant, tiss-arquivo, tiss-arquivo-fake, tiss-soap, types.

- [ ] Commitar.

```bash
git add packages/tiss/src/transport/registry.ts \
       packages/tiss/src/transport/registry.test.ts \
       packages/tiss/src/transport/registry-invariant.test.ts \
       packages/tiss/src/index.ts
git commit -m "feat(tiss): register tiss-soap in transport registry, update invariant and exports"
```
### Task 37: Componente ConveniosRetornos — lista de demonstrativos importados

**Arquivos**

- Criar `apps/web/src/telas/ConveniosRetornos.tsx`
- Criar `apps/web/src/telas/ConveniosRetornos.test.tsx`

**Por que**: Design §5.3 define "retornos e glosas" como destino dentro de Convenios. A lista de demonstrativos importados e a tela primaria: mostra cada demonstrativo com operadora, periodo, tipo (analise/pagamento), totalizadores (apresentado, processado, liberado, glosado), e acao de importar XML. O componente segue o padrao de ConveniosAFaturar — recebe callbacks para carregar dados e executar acoes, sem dependencia direta da API.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosRetornos.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosRetornos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRetornos,
  type RetornosDados,
  type FiltrosRetornos,
} from './ConveniosRetornos';

const DADOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      registroAns: '123456',
      protocolo: 'PROT-001',
      tipo: 'analise',
      dataImportacao: '2026-08-01',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000,
      totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000,
      totalItens: 15,
      itensGlosados: 3,
    },
    {
      id: 'd2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      registroAns: '654321',
      protocolo: 'PROT-002',
      tipo: 'pagamento',
      dataImportacao: '2026-08-02',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 300000,
      totalProcessadoCentavos: 300000,
      totalLiberadoCentavos: 300000,
      totalGlosadoCentavos: 0,
      totalItens: 10,
      itensGlosados: 0,
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
  ],
  totais: {
    apresentadoCentavos: 800000,
    processadoCentavos: 780000,
    liberadoCentavos: 750000,
    glosadoCentavos: 30000,
  },
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosRetornos) => Promise<RetornosDados>;
  aoImportarXml: (arquivo: File) => Promise<void>;
  aoAbrirDemonstrativo: (id: string) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosRetornos) => Promise<RetornosDados>>()
    .mockResolvedValue(DADOS);
  const aoImportarXml = vi.fn<(arquivo: File) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoAbrirDemonstrativo = vi.fn();

  render(
    <ConveniosRetornos
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoImportarXml={overrides.aoImportarXml ?? aoImportarXml}
      aoAbrirDemonstrativo={overrides.aoAbrirDemonstrativo ?? aoAbrirDemonstrativo}
    />,
  );
  return { carregarDados, aoImportarXml, aoAbrirDemonstrativo };
}

describe('ConveniosRetornos', () => {
  it('renderiza totalizadores: apresentado, processado, liberado, glosado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Apresentado/i)).toBeVisible();
    });
    const grupo = screen.getByRole('group', { name: /Totalizadores de retornos/i });
    expect(grupo).toBeVisible();
    expect(screen.getByText('R$ 8.000,00')).toBeVisible();
    expect(screen.getByText('R$ 7.800,00')).toBeVisible();
    expect(screen.getByText('R$ 7.500,00')).toBeVisible();
    expect(screen.getByText('R$ 300,00')).toBeVisible();
  });

  it('renderiza lista de demonstrativos com protocolo, operadora e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText('PROT-002')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText(/Analise/i)).toBeVisible();
    expect(screen.getByText(/Pagamento/i)).toBeVisible();
  });

  it('exibe badge de itens glosados quando ha glosas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText(/3 glosa/i)).toBeVisible();
  });

  it('ao clicar em um demonstrativo chama aoAbrirDemonstrativo', async () => {
    const { aoAbrirDemonstrativo } = montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    await userEvent.click(screen.getByText('PROT-001'));
    expect(aoAbrirDemonstrativo).toHaveBeenCalledWith('d1');
  });

  it('renderiza filtros de operadora, periodo e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Tipo/i)).toBeVisible();
  });

  it('botao Importar esta visivel', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRetornos
        carregarDados={async () => DADOS}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha (componente ainda nao existe):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosRetornos'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosRetornos.tsx`:

```tsx
// apps/web/src/telas/ConveniosRetornos.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Demonstrativo {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly registroAns: string;
  readonly protocolo: string;
  readonly tipo: 'analise' | 'pagamento';
  readonly dataImportacao: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly totalApresentadoCentavos: number;
  readonly totalProcessadoCentavos: number;
  readonly totalLiberadoCentavos: number;
  readonly totalGlosadoCentavos: number;
  readonly totalItens: number;
  readonly itensGlosados: number;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface TotaisRetornos {
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
}

export interface RetornosDados {
  readonly demonstrativos: readonly Demonstrativo[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totais: TotaisRetornos;
}

export interface FiltrosRetornos {
  readonly operadoraId?: string;
  readonly tipo?: 'analise' | 'pagamento';
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosRetornosProps {
  readonly carregarDados: (filtros: FiltrosRetornos) => Promise<RetornosDados>;
  readonly aoImportarXml: (arquivo: File) => Promise<void>;
  readonly aoAbrirDemonstrativo: (id: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const ROTULOS_TOTAIS: { chave: keyof TotaisRetornos; rotulo: string }[] = [
  { chave: 'apresentadoCentavos', rotulo: 'Apresentado' },
  { chave: 'processadoCentavos', rotulo: 'Processado' },
  { chave: 'liberadoCentavos', rotulo: 'Liberado' },
  { chave: 'glosadoCentavos', rotulo: 'Glosado' },
];

const TIPO_CHIP: Record<'analise' | 'pagamento', { rotulo: string; cor: string; bg: string }> = {
  analise:    { rotulo: 'Analise',    cor: 'var(--accent)',  bg: 'var(--accent-soft)' },
  pagamento:  { rotulo: 'Pagamento',  cor: 'var(--ok)',      bg: 'var(--ok-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosRetornos(p: ConveniosRetornosProps) {
  const [dados, setDados] = useState<RetornosDados | null>(null);
  const [operadoraId, setOperadoraId] = useState('');
  const [tipo, setTipo] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      tipo: tipo === '' ? undefined : tipo as 'analise' | 'pagamento',
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function abrirDialogImportar(): void {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    if (arquivo === undefined) return;
    setImportando(true);
    void p.aoImportarXml(arquivo).finally(() => {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = '';
      void p.carregarDados({}).then(setDados);
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Retornos
        </h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xml"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-label="Selecionar arquivo XML"
          />
          <Botao variante="primario" altura={32}
            onClick={abrirDialogImportar} carregando={importando}>
            Importar
          </Botao>
        </div>
      </div>

      {/* Totalizadores */}
      <div
        role="group" aria-label="Totalizadores de retornos" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {ROTULOS_TOTAIS.map((t, i) => (
          <div
            key={t.chave}
            style={{
              flex: 1,
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1,
                                           color: t.chave === 'glosadoCentavos' && dados.totais[t.chave] > 0
                                             ? 'var(--danger)' : 'var(--text)' }}>
              {centavosParaReais(dados.totais[t.chave])}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {t.rotulo}
            </span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-ret"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-tipo-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Tipo
          </label>
          <select
            id="filtro-tipo-ret"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="analise">Analise</option>
            <option value="pagamento">Pagamento</option>
          </select>
        </div>

        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Lista de demonstrativos */}
      <section aria-label="Demonstrativos importados">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.demonstrativos.map((d) => {
            const chip = TIPO_CHIP[d.tipo];
            return (
              <li key={d.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                <div
                  role="button" tabIndex={0}
                  onClick={() => p.aoAbrirDemonstrativo(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      p.aoAbrirDemonstrativo(d.id);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {d.protocolo}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {d.operadoraNome}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: chip.cor, background: chip.bg,
                    }}>
                      {chip.rotulo}
                    </span>
                    {d.itensGlosados > 0 ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-medium)',
                        padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: 'var(--danger)', background: 'var(--danger-soft)',
                      }}>
                        {d.itensGlosados} glosa(s)
                      </span>
                    ) : null}
                  </div>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {d.periodoInicio} a {d.periodoFim} — {d.totalItens} iten(s) — Importado em {d.dataImportacao}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'baseline' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {centavosParaReais(d.totalLiberadoCentavos)}
                    </span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                   color: 'var(--text-muted)' }}>
                      liberado
                    </span>
                  </div>
                  {d.totalGlosadoCentavos > 0 ? (
                    <div style={{ textAlign: 'right' }}>
                      <span className="num" style={{
                        fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                        fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                      }}>
                        {centavosParaReais(d.totalGlosadoCentavos)}
                      </span>
                      <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                     color: 'var(--text-muted)' }}>
                        glosado
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosRetornos.tsx apps/web/src/telas/ConveniosRetornos.test.tsx
git commit -m "feat(web): add ConveniosRetornos component with demonstrativo list and filters

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 38: Componente ConveniosGlosas — lista de glosas agrupadas por guia

**Arquivos**

- Criar `apps/web/src/telas/ConveniosGlosas.tsx`
- Criar `apps/web/src/telas/ConveniosGlosas.test.tsx`

**Por que**: Design §5.3 define sub-aba de glosas com lista agrupada por guia, filtros (status, operadora, periodo, valor), selecao multipla para "Criar recurso", e badge de valor total glosado pendente. A tela permite a gestora identificar rapidamente quais glosas merecem recurso.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosGlosas.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosGlosas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosGlosas,
  type GlosasDados,
  type FiltrosGlosas,
} from './ConveniosGlosas';

const DADOS: GlosasDados = {
  glosas: [
    {
      id: 'gl1',
      demonstrativoId: 'd1',
      guiaNumero: '000001',
      pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-15',
      status: 'pendente',
    },
    {
      id: 'gl2',
      demonstrativoId: 'd1',
      guiaNumero: '000002',
      pacienteNome: 'Ana Silva',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1015',
      descricaoGlosa: 'Fora do prazo',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 8000,
      dataAtendimento: '2026-07-16',
      status: 'pendente',
    },
    {
      id: 'gl3',
      demonstrativoId: 'd1',
      guiaNumero: '000003',
      pacienteNome: 'Jose Santos',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-17',
      status: 'recurso_enviado',
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
  ],
  totalGlosadoPendenteCentavos: 23000,
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosGlosas) => Promise<GlosasDados>;
  aoCriarRecurso: (glosaIds: readonly string[]) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosGlosas) => Promise<GlosasDados>>()
    .mockResolvedValue(DADOS);
  const aoCriarRecurso = vi.fn();

  render(
    <ConveniosGlosas
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoCriarRecurso={overrides.aoCriarRecurso ?? aoCriarRecurso}
    />,
  );
  return { carregarDados, aoCriarRecurso };
}

describe('ConveniosGlosas', () => {
  it('renderiza badge de valor total glosado pendente', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/R\$ 230,00/)).toBeVisible();
    });
    expect(screen.getByText(/pendente/i)).toBeVisible();
  });

  it('renderiza lista de glosas com guia, paciente e codigo da glosa', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
    expect(screen.getByText(/Procedimento nao autorizado/)).toBeVisible();
  });

  it('renderiza chip de status para glosa com recurso enviado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000003')).toBeVisible();
    });
    expect(screen.getByText(/Recurso enviado/i)).toBeVisible();
  });

  it('permite selecionar glosas pendentes com checkbox', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    // So glosas pendentes tem checkbox (2 de 3)
    expect(checkboxes).toHaveLength(2);
  });

  it('ao selecionar glosas e clicar "Criar recurso" chama callback com ids', async () => {
    const { aoCriarRecurso } = montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);
    const botao = screen.getByRole('button', { name: /Criar recurso/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCriarRecurso).toHaveBeenCalledWith(['gl1', 'gl2']);
  });

  it('renderiza filtros de status, operadora e periodo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Status/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosGlosas
        carregarDados={async () => DADOS}
        aoCriarRecurso={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosGlosas.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosGlosas'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosGlosas.tsx`:

```tsx
// apps/web/src/telas/ConveniosGlosas.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusGlosa = 'pendente' | 'recurso_enviado' | 'recurso_aceito' | 'recurso_negado';

export interface Glosa {
  readonly id: string;
  readonly demonstrativoId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorApresentadoCentavos: number;
  readonly valorGlosadoCentavos: number;
  readonly dataAtendimento: string;
  readonly status: StatusGlosa;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface GlosasDados {
  readonly glosas: readonly Glosa[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totalGlosadoPendenteCentavos: number;
}

export interface FiltrosGlosas {
  readonly status?: StatusGlosa;
  readonly operadoraId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosGlosasProps {
  readonly carregarDados: (filtros: FiltrosGlosas) => Promise<GlosasDados>;
  readonly aoCriarRecurso: (glosaIds: readonly string[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusGlosa, { rotulo: string; cor: string; bg: string }> = {
  pendente:        { rotulo: 'Pendente',        cor: 'var(--warn)',     bg: 'var(--warn-soft)' },
  recurso_enviado: { rotulo: 'Recurso enviado', cor: 'var(--accent)',   bg: 'var(--accent-soft)' },
  recurso_aceito:  { rotulo: 'Recurso aceito',  cor: 'var(--ok)',       bg: 'var(--ok-soft)' },
  recurso_negado:  { rotulo: 'Recurso negado',  cor: 'var(--danger)',   bg: 'var(--danger-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosGlosas(p: ConveniosGlosasProps) {
  const [dados, setDados] = useState<GlosasDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [statusFiltro, setStatusFiltro] = useState('');
  const [operadoraId, setOperadoraId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      status: statusFiltro === '' ? undefined : statusFiltro as StatusGlosa,
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function alternarSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho com badge de pendente */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Glosas
          </h3>
          {dados.totalGlosadoPendenteCentavos > 0 ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              padding: 'var(--s-1) var(--s-4)',
              borderRadius: 'var(--r-full)',
              color: 'var(--danger)', background: 'var(--danger-soft)',
            }}>
              {centavosParaReais(dados.totalGlosadoPendenteCentavos)} pendente
            </span>
          ) : null}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-status-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Status
          </label>
          <select
            id="filtro-status-gl"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            aria-label="Status"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="recurso_enviado">Recurso enviado</option>
            <option value="recurso_aceito">Recurso aceito</option>
            <option value="recurso_negado">Recurso negado</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-gl"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>

        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Barra de acao batch */}
      {selecionadas.size > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
                      padding: 'var(--s-3) var(--s-5)',
                      background: 'var(--accent-soft)', borderRadius: 'var(--r-md)' }}>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
            {selecionadas.size} glosa(s) selecionada(s)
          </span>
          <Botao variante="primario" altura={32}
            onClick={() => { p.aoCriarRecurso(Array.from(selecionadas)); }}>
            Criar recurso
          </Botao>
        </div>
      ) : null}

      {/* Lista de glosas */}
      <section aria-label="Lista de glosas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.glosas.map((g) => {
            const chip = STATUS_CHIP[g.status];
            const selecionavel = g.status === 'pendente';

            return (
              <li key={g.id} style={{
                display: 'grid',
                gridTemplateColumns: selecionavel ? 'auto 1fr auto' : '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                {selecionavel ? (
                  <input
                    type="checkbox"
                    checked={selecionadas.has(g.id)}
                    onChange={() => alternarSelecao(g.id)}
                    aria-label={`Selecionar glosa ${g.guiaNumero}`}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                ) : null}

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {g.guiaNumero}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {g.pacienteNome}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: chip.cor, background: chip.bg,
                    }}>
                      {chip.rotulo}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                    <span>{g.descricaoGlosa}</span>
                    <span>—</span>
                    <span>{g.operadoraNome}</span>
                    <span>—</span>
                    <span>{g.dataAtendimento}</span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span className="num" style={{
                    fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(g.valorGlosadoCentavos)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosGlosas.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosGlosas.tsx apps/web/src/telas/ConveniosGlosas.test.tsx
git commit -m "feat(web): add ConveniosGlosas component with selection for recurso creation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 39: Componente ConveniosRecursos — lista de recursos de glosa

**Arquivos**

- Criar `apps/web/src/telas/ConveniosRecursos.tsx`
- Criar `apps/web/src/telas/ConveniosRecursos.test.tsx`

**Por que**: Design §5.3 define sub-aba de recursos com status visual (chip), acoes (editar, enviar, ver resultado), e expansao com itens do recurso e justificativa. A gestora acompanha o ciclo de vida de cada recurso de glosa enviado.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosRecursos.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosRecursos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRecursos,
  type RecursosDados,
} from './ConveniosRecursos';

const DADOS: RecursosDados = {
  recursos: [
    {
      id: 'r1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      status: 'rascunho',
      justificativaGeral: 'Procedimentos realizados conforme protocolo clinico.',
      criadoEm: '2026-08-05',
      enviadoEm: null,
      totalGlosasCentavos: 23000,
      itens: [
        {
          id: 'ri1',
          glosaId: 'gl1',
          guiaNumero: '000001',
          pacienteNome: 'Carlos Melo',
          codigoGlosa: '1005',
          valorGlosadoCentavos: 15000,
          justificativa: 'Procedimento estava autorizado pela guia SADT 12345.',
        },
        {
          id: 'ri2',
          glosaId: 'gl2',
          guiaNumero: '000002',
          pacienteNome: 'Ana Silva',
          codigoGlosa: '1015',
          valorGlosadoCentavos: 8000,
          justificativa: 'Guia enviada dentro do prazo de 10 dias uteis.',
        },
      ],
    },
    {
      id: 'r2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      status: 'enviado',
      justificativaGeral: 'Recurso fundamentado.',
      criadoEm: '2026-08-01',
      enviadoEm: '2026-08-03',
      totalGlosasCentavos: 50000,
      itens: [
        {
          id: 'ri3',
          glosaId: 'gl4',
          guiaNumero: '000010',
          pacienteNome: 'Maria Costa',
          codigoGlosa: '1020',
          valorGlosadoCentavos: 50000,
          justificativa: 'Codigo correto conforme tabela TUSS vigente.',
        },
      ],
    },
  ],
};

function montar() {
  const carregarDados = vi.fn<() => Promise<RecursosDados>>()
    .mockResolvedValue(DADOS);
  const aoEditar = vi.fn();
  const aoEnviar = vi.fn<(id: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoVerResultado = vi.fn();

  render(
    <ConveniosRecursos
      carregarDados={carregarDados}
      aoEditar={aoEditar}
      aoEnviar={aoEnviar}
      aoVerResultado={aoVerResultado}
    />,
  );
  return { carregarDados, aoEditar, aoEnviar, aoVerResultado };
}

describe('ConveniosRecursos', () => {
  it('renderiza lista de recursos com operadora e status', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText(/Rascunho/i)).toBeVisible();
    expect(screen.getByText(/Enviado/i)).toBeVisible();
  });

  it('renderiza valor total de glosas em cada recurso', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('R$ 230,00')).toBeVisible();
    });
    expect(screen.getByText('R$ 500,00')).toBeVisible();
  });

  it('botao Editar aparece para recurso em rascunho', async () => {
    const { aoEditar } = montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    expect(botoes).toHaveLength(1);
    await userEvent.click(botoes[0]!);
    expect(aoEditar).toHaveBeenCalledWith('r1');
  });

  it('botao Enviar aparece para recurso em rascunho', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByRole('button', { name: /Enviar/i })).toBeVisible();
  });

  it('botao Ver resultado aparece para recurso enviado', async () => {
    const { aoVerResultado } = montar();
    await waitFor(() => {
      expect(screen.getByText('Bradesco Saude')).toBeVisible();
    });
    const botao = screen.getByRole('button', { name: /Ver resultado/i });
    await userEvent.click(botao);
    expect(aoVerResultado).toHaveBeenCalledWith('r2');
  });

  it('expandir recurso mostra itens com justificativa individual', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const expandir = screen.getAllByRole('button', { name: /Expandir/i });
    await userEvent.click(expandir[0]!);
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText(/Procedimento estava autorizado/)).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText(/Guia enviada dentro do prazo/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRecursos
        carregarDados={async () => DADOS}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRecursos.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosRecursos'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosRecursos.tsx`:

```tsx
// apps/web/src/telas/ConveniosRecursos.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusRecurso = 'rascunho' | 'enviado' | 'aceito' | 'negado' | 'parcial';

export interface ItemRecurso {
  readonly id: string;
  readonly glosaId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly valorGlosadoCentavos: number;
  readonly justificativa: string;
}

export interface Recurso {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly status: StatusRecurso;
  readonly justificativaGeral: string;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly totalGlosasCentavos: number;
  readonly itens: readonly ItemRecurso[];
}

export interface RecursosDados {
  readonly recursos: readonly Recurso[];
}

export interface ConveniosRecursosProps {
  readonly carregarDados: () => Promise<RecursosDados>;
  readonly aoEditar: (recursoId: string) => void;
  readonly aoEnviar: (recursoId: string) => Promise<void>;
  readonly aoVerResultado: (recursoId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusRecurso, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho: { rotulo: 'Rascunho', glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:  { rotulo: 'Enviado',  glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  aceito:   { rotulo: 'Aceito',   glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  negado:   { rotulo: 'Negado',   glifo: '✕', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
  parcial:  { rotulo: 'Parcial',  glifo: '◐', cor: 'var(--warn)',        bg: 'var(--warn-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosRecursos(p: ConveniosRecursosProps) {
  const [dados, setDados] = useState<RecursosDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Recursos
      </h3>

      <section aria-label="Lista de recursos de glosa">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.recursos.map((rec) => {
            const chip = STATUS_CHIP[rec.status];
            const expandido = expandidos.has(rec.id);

            return (
              <li key={rec.id} style={{ borderBottom: 'var(--border)' }}>
                {/* Cabecalho do recurso */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center', gap: 'var(--s-4)',
                  padding: 'var(--s-5) var(--s-5)', minHeight: 56,
                }}>
                  {/* Expandir */}
                  <button
                    type="button"
                    onClick={() => alternarExpandir(rec.id)}
                    aria-expanded={expandido}
                    aria-label="Expandir"
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer',
                      fontSize: 'var(--fs-14)', color: 'var(--text-muted)',
                      width: 24, height: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {expandido ? '▾' : '▸'}
                  </button>

                  {/* Info do recurso */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                      <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                        {rec.operadoraNome}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                        fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                        fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: chip.cor, background: chip.bg,
                      }}>
                        <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                   color: 'var(--text-muted)' }}>
                      {rec.itens.length} glosa(s) — Criado em {rec.criadoEm}
                      {rec.enviadoEm !== null ? ` — Enviado em ${rec.enviadoEm}` : ''}
                    </span>
                  </div>

                  {/* Valor total */}
                  <span className="num" style={{
                    fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(rec.totalGlosasCentavos)}
                  </span>

                  {/* Acoes */}
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {rec.status === 'rascunho' ? (
                      <>
                        <Botao variante="secundario" altura={28}
                          onClick={() => { p.aoEditar(rec.id); }}>
                          Editar
                        </Botao>
                        <Botao variante="primario" altura={28}
                          onClick={() => { void p.aoEnviar(rec.id); }}>
                          Enviar
                        </Botao>
                      </>
                    ) : null}
                    {rec.status === 'enviado' || rec.status === 'aceito'
                      || rec.status === 'negado' || rec.status === 'parcial' ? (
                      <Botao variante="secundario" altura={28}
                        onClick={() => { p.aoVerResultado(rec.id); }}>
                        Ver resultado
                      </Botao>
                    ) : null}
                  </div>
                </div>

                {/* Itens expandidos */}
                {expandido && rec.itens.length > 0 ? (
                  <div style={{ padding: '0 var(--s-5) var(--s-5)',
                                paddingInlineStart: 'calc(var(--s-5) + 24px + var(--s-4))' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                                 border: 'var(--border)', borderRadius: 'var(--r-sm)',
                                 overflow: 'hidden', background: 'var(--surface-sunken)' }}>
                      {rec.itens.map((item) => (
                        <li key={item.id} style={{
                          padding: 'var(--s-4) var(--s-4)',
                          borderBottom: 'var(--border)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                        marginBottom: 'var(--s-2)' }}>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                            }}>
                              {item.guiaNumero}
                            </span>
                            <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
                              {item.pacienteNome}
                            </span>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)',
                              color: 'var(--text-muted)',
                            }}>
                              {item.codigoGlosa}
                            </span>
                            <span className="num" style={{
                              fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)',
                              fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                              marginInlineStart: 'auto',
                            }}>
                              {centavosParaReais(item.valorGlosadoCentavos)}
                            </span>
                          </div>
                          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                                      margin: 0, lineHeight: 1.5 }}>
                            {item.justificativa}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRecursos.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosRecursos.tsx apps/web/src/telas/ConveniosRecursos.test.tsx
git commit -m "feat(web): add ConveniosRecursos component with expandable recurso items

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 40: Componente DetalheDemonstrativo — painel lateral com itens e valores lado a lado

**Arquivos**

- Criar `apps/web/src/telas/DetalheDemonstrativo.tsx`
- Criar `apps/web/src/telas/DetalheDemonstrativo.test.tsx`

**Por que**: Design §5.3 define painel lateral com itens do demonstrativo, valores lado a lado (apresentado vs processado vs liberado vs glosado) e destaque para itens com glosa. E o detalhe que permite a gestora entender item a item o que a operadora processou.

- [ ] Criar o arquivo de teste `apps/web/src/telas/DetalheDemonstrativo.test.tsx`:

```tsx
// apps/web/src/telas/DetalheDemonstrativo.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  DetalheDemonstrativo,
  type ItemDemonstrativo,
} from './DetalheDemonstrativo';

const ITENS: readonly ItemDemonstrativo[] = [
  {
    id: 'it1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 15000,
    glosadoCentavos: 0,
    codigoGlosa: null,
    descricaoGlosa: null,
  },
  {
    id: 'it2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 7000,
    glosadoCentavos: 8000,
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
  },
  {
    id: 'it3',
    guiaNumero: '000003',
    pacienteNome: 'Jose Santos',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 0,
    liberadoCentavos: 0,
    glosadoCentavos: 15000,
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
  },
];

function montar() {
  const aoFechar = vi.fn();

  render(
    <DetalheDemonstrativo
      aberto
      titulo="Demonstrativo PROT-001"
      itens={ITENS}
      aoFechar={aoFechar}
    />,
  );
  return { aoFechar };
}

describe('DetalheDemonstrativo', () => {
  it('renderiza titulo do demonstrativo no painel lateral', () => {
    montar();
    expect(screen.getByText('Demonstrativo PROT-001')).toBeVisible();
  });

  it('renderiza todos os itens com guia e paciente', () => {
    montar();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText('000003')).toBeVisible();
    expect(screen.getByText('Jose Santos')).toBeVisible();
  });

  it('exibe valores lado a lado: apresentado, processado, liberado, glosado', () => {
    montar();
    // Cabecalho da tabela
    expect(screen.getByText(/Apresentado/i)).toBeVisible();
    expect(screen.getByText(/Processado/i)).toBeVisible();
    expect(screen.getByText(/Liberado/i)).toBeVisible();
    expect(screen.getByText(/Glosado/i)).toBeVisible();
  });

  it('destaca item com glosa mostrando codigo e descricao', () => {
    montar();
    expect(screen.getByText('1015')).toBeVisible();
    expect(screen.getByText(/Fora do prazo/)).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
    expect(screen.getByText(/Procedimento nao autorizado/)).toBeVisible();
  });

  it('nao renderiza nada quando fechado', () => {
    render(
      <DetalheDemonstrativo
        aberto={false}
        titulo="Test"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(screen.queryByText('000001')).toBeNull();
  });

  it('ao clicar no fundo escurecido chama aoFechar', async () => {
    const { aoFechar } = montar();
    await userEvent.click(screen.getByTestId('fundo-escurecido'));
    expect(aoFechar).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <DetalheDemonstrativo
        aberto
        titulo="Demonstrativo PROT-001"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheDemonstrativo.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './DetalheDemonstrativo'
```

- [ ] Criar o componente `apps/web/src/telas/DetalheDemonstrativo.tsx`:

```tsx
// apps/web/src/telas/DetalheDemonstrativo.tsx
'use client';

import { PainelLateral } from '../ui/PainelLateral';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemDemonstrativo {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
  readonly codigoGlosa: string | null;
  readonly descricaoGlosa: string | null;
}

export interface DetalheDemonstrativoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly itens: readonly ItemDemonstrativo[];
  readonly aoFechar: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function DetalheDemonstrativo({ aberto, titulo, itens, aoFechar }: DetalheDemonstrativoProps) {
  return (
    <PainelLateral aberto={aberto} titulo={titulo} aoFechar={aoFechar}>
      <div style={{ marginTop: 'var(--s-4)', overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 'var(--fs-12)',
        }}>
          <thead>
            <tr style={{ borderBottom: 'var(--border)' }}>
              <th style={{ textAlign: 'left', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Guia
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Apresentado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Processado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Liberado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Glosado
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const temGlosa = item.glosadoCentavos > 0;
              return (
                <tr key={item.id} style={{
                  borderBottom: 'var(--border)',
                  background: temGlosa ? 'var(--danger-soft)' : 'transparent',
                }}>
                  <td style={{ padding: 'var(--s-3)', verticalAlign: 'top' }}>
                    <div>
                      <span className="num" style={{
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-muted)',
                      }}>
                        {item.guiaNumero}
                      </span>
                      {' '}
                      <span style={{ fontWeight: 'var(--fw-medium)' }}>
                        {item.pacienteNome}
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)' }}>
                      {item.nomeProcedimento}
                    </div>
                    {temGlosa && item.codigoGlosa !== null ? (
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--danger)',
                                    marginTop: 'var(--s-1)' }}>
                        <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>
                          {item.codigoGlosa}
                        </span>
                        {' '}
                        {item.descricaoGlosa}
                      </div>
                    ) : null}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.apresentadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.processadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.liberadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                    color: temGlosa ? 'var(--danger)' : 'var(--text)',
                    fontWeight: temGlosa ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  }}>
                    {centavosParaReais(item.glosadoCentavos)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PainelLateral>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheDemonstrativo.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/DetalheDemonstrativo.tsx apps/web/src/telas/DetalheDemonstrativo.test.tsx
git commit -m "feat(web): add DetalheDemonstrativo side panel with item-level value comparison

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 41: Componente FormRecursoGlosa — wizard 2 passos para recurso de glosa

**Arquivos**

- Criar `apps/web/src/telas/FormRecursoGlosa.tsx`
- Criar `apps/web/src/telas/FormRecursoGlosa.test.tsx`

**Por que**: Design §5.3 define wizard de 2 passos: (1) selecionar glosas e preencher justificativa individual; (2) justificativa geral + revisar + submeter. O recurso de glosa e o ponto onde a clinica recupera receita, e a justificativa individual e o conteudo que vai no XML TISS.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FormRecursoGlosa.test.tsx`:

```tsx
// apps/web/src/telas/FormRecursoGlosa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  FormRecursoGlosa,
  type GlosaParaRecurso,
} from './FormRecursoGlosa';

const GLOSAS: readonly GlosaParaRecurso[] = [
  {
    id: 'gl1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
    valorGlosadoCentavos: 15000,
  },
  {
    id: 'gl2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
    valorGlosadoCentavos: 8000,
  },
];

function montar() {
  const aoSubmeter = vi.fn<(dados: {
    glosas: { glosaId: string; justificativa: string }[];
    justificativaGeral: string;
  }) => Promise<void>>().mockResolvedValue(undefined);
  const aoCancelar = vi.fn();

  render(
    <FormRecursoGlosa
      glosas={GLOSAS}
      aoSubmeter={aoSubmeter}
      aoCancelar={aoCancelar}
    />,
  );
  return { aoSubmeter, aoCancelar };
}

describe('FormRecursoGlosa', () => {
  it('passo 1: mostra lista de glosas com campo de justificativa individual', () => {
    montar();
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    expect(campos).toHaveLength(2);
  });

  it('passo 1: botao Proximo desabilitado se justificativas estao vazias', () => {
    montar();
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeDisabled();
  });

  it('passo 1: botao Proximo habilitado apos preencher todas as justificativas', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Procedimento estava devidamente autorizado.');
    await userEvent.type(campos[1]!, 'Envio realizado dentro do prazo contratual.');
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeEnabled();
  });

  it('passo 2: mostra campo de justificativa geral e resumo', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    expect(screen.getByLabelText(/Justificativa geral/i)).toBeVisible();
    expect(screen.getByText(/2 glosa/i)).toBeVisible();
    expect(screen.getByText('R$ 230,00')).toBeVisible();
  });

  it('passo 2: botao Submeter chama aoSubmeter com dados corretos', async () => {
    const { aoSubmeter } = montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    const geral = screen.getByLabelText(/Justificativa geral/i);
    await userEvent.type(geral, 'Recurso fundamentado conforme protocolo.');
    await userEvent.click(screen.getByRole('button', { name: /Submeter/i }));
    await waitFor(() => {
      expect(aoSubmeter).toHaveBeenCalledWith({
        glosas: [
          { glosaId: 'gl1', justificativa: 'Autorizado.' },
          { glosaId: 'gl2', justificativa: 'Dentro do prazo.' },
        ],
        justificativaGeral: 'Recurso fundamentado conforme protocolo.',
      });
    });
  });

  it('passo 2: botao Voltar retorna ao passo 1', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Voltar/i }));
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
  });

  it('botao Cancelar chama aoCancelar', async () => {
    const { aoCancelar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(aoCancelar).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade no passo 1', async () => {
    const { container } = render(
      <FormRecursoGlosa
        glosas={GLOSAS}
        aoSubmeter={async () => {}}
        aoCancelar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FormRecursoGlosa.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './FormRecursoGlosa'
```

- [ ] Criar o componente `apps/web/src/telas/FormRecursoGlosa.tsx`:

```tsx
// apps/web/src/telas/FormRecursoGlosa.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GlosaParaRecurso {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorGlosadoCentavos: number;
}

export interface DadosRecurso {
  readonly glosas: { glosaId: string; justificativa: string }[];
  readonly justificativaGeral: string;
}

export interface FormRecursoGlosaProps {
  readonly glosas: readonly GlosaParaRecurso[];
  readonly aoSubmeter: (dados: DadosRecurso) => Promise<void>;
  readonly aoCancelar: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function FormRecursoGlosa(p: FormRecursoGlosaProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [justificativas, setJustificativas] = useState<Record<string, string>>(
    () => Object.fromEntries(p.glosas.map((g) => [g.id, ''])),
  );
  const [justificativaGeral, setJustificativaGeral] = useState('');
  const [submetendo, setSubmetendo] = useState(false);

  const todasPreenchidas = p.glosas.every(
    (g) => (justificativas[g.id] ?? '').trim().length > 0,
  );

  const totalCentavos = p.glosas.reduce((s, g) => s + g.valorGlosadoCentavos, 0);

  function atualizarJustificativa(glosaId: string, valor: string): void {
    setJustificativas((prev) => ({ ...prev, [glosaId]: valor }));
  }

  function submeter(): void {
    setSubmetendo(true);
    void p.aoSubmeter({
      glosas: p.glosas.map((g) => ({
        glosaId: g.id,
        justificativa: (justificativas[g.id] ?? '').trim(),
      })),
      justificativaGeral: justificativaGeral.trim(),
    }).finally(() => setSubmetendo(false));
  }

  if (passo === 1) {
    return (
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Passo 1 de 2 — Justificativas individuais
          </h3>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'grid', gap: 'var(--s-5)' }}>
          {p.glosas.map((g) => (
            <li key={g.id} style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              padding: 'var(--s-5)', background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{
                  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                }}>
                  {g.guiaNumero}
                </span>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {g.pacienteNome}
                </span>
                <span className="num" style={{
                  fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--danger)', marginInlineStart: 'auto',
                }}>
                  {centavosParaReais(g.valorGlosadoCentavos)}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                {' '}{g.descricaoGlosa}
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
                <label htmlFor={`just-${g.id}`} style={{
                  fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                  lineHeight: 1.3, color: 'var(--text-muted)',
                }}>
                  Justificativa
                </label>
                <textarea
                  id={`just-${g.id}`}
                  aria-label="Justificativa"
                  value={justificativas[g.id] ?? ''}
                  onChange={(e) => atualizarJustificativa(g.id, e.target.value)}
                  rows={3}
                  style={{
                    padding: 'var(--s-3) var(--s-4)',
                    border: 'var(--border)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', color: 'var(--text)',
                    fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
                    resize: 'vertical',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
          <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante="primario" altura={32}
            disabled={!todasPreenchidas}
            onClick={() => setPasso(2)}>
            Proximo
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Passo 2 de 2 — Revisar e submeter
      </h3>

      {/* Resumo */}
      <div style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        padding: 'var(--s-5)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <span style={{ fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)' }}>
            {p.glosas.length} glosa(s)
          </span>
          <span className="num" style={{
            fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
            fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
          }}>
            {centavosParaReais(totalCentavos)}
          </span>
        </div>
      </div>

      {/* Justificativa geral */}
      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <label htmlFor="justificativa-geral" style={{
          fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
          lineHeight: 1.3, color: 'var(--text-muted)',
        }}>
          Justificativa geral
        </label>
        <textarea
          id="justificativa-geral"
          aria-label="Justificativa geral"
          value={justificativaGeral}
          onChange={(e) => setJustificativaGeral(e.target.value)}
          rows={4}
          style={{
            padding: 'var(--s-3) var(--s-4)',
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Lista resumida das glosas com justificativas */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface-sunken)' }}>
        {p.glosas.map((g) => (
          <li key={g.id} style={{
            padding: 'var(--s-3) var(--s-4)',
            borderBottom: 'var(--border)', fontSize: 'var(--fs-12)',
          }}>
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              <span className="num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {g.guiaNumero}
              </span>
              <span>{g.pacienteNome}</span>
              <span className="num" style={{
                fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                marginInlineStart: 'auto',
              }}>
                {centavosParaReais(g.valorGlosadoCentavos)}
              </span>
            </div>
            <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
                        margin: 'var(--s-1) 0 0', lineHeight: 1.4 }}>
              {justificativas[g.id]}
            </p>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
        <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
          Cancelar
        </Botao>
        <Botao variante="secundario" altura={32} onClick={() => setPasso(1)}>
          Voltar
        </Botao>
        <Botao variante="primario" altura={32}
          carregando={submetendo}
          onClick={submeter}>
          Submeter
        </Botao>
      </div>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FormRecursoGlosa.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FormRecursoGlosa.tsx apps/web/src/telas/FormRecursoGlosa.test.tsx
git commit -m "feat(web): add FormRecursoGlosa wizard with 2-step justification flow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 42: Atualizar ConveniosLayout — adicionar sub-aba Retornos e contadores de glosas

**Arquivos**

- Modificar `apps/web/src/telas/ConveniosLayout.tsx`
- Modificar `apps/web/src/telas/ConveniosLayout.test.tsx`

**Por que**: Design §5.3 define "a faturar -> lotes -> retornos e glosas" na navegacao de Convenios. A Fase 4 criou 3 sub-abas; a Fase 5 adiciona "Retornos" como quarta sub-aba e dois contadores na faixa: "Glosas pendentes" e "Recursos rascunho".

- [ ] Editar o teste `apps/web/src/telas/ConveniosLayout.test.tsx` para validar 4 sub-abas e 6 contadores:

```tsx
// apps/web/src/telas/ConveniosLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLayout,
  type SubAbaConvenios,
  type ContadoresConvenios,
} from './ConveniosLayout';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 14,
  lotesRascunho: 2,
  lotesEnviados: 5,
  pendencias: 3,
  glosasPendentes: 8,
  recursosRascunho: 1,
};

function montar(abaAtiva: SubAbaConvenios = 'a-faturar') {
  const aoNavegar = vi.fn();
  const aoFiltrar = vi.fn();
  render(
    <ConveniosLayout
      abaAtiva={abaAtiva}
      aoNavegar={aoNavegar}
      contadores={CONTADORES}
      aoFiltrar={aoFiltrar}
    >
      <div data-testid="conteudo-filho">Conteudo da sub-aba</div>
    </ConveniosLayout>,
  );
  return { aoNavegar, aoFiltrar };
}

describe('ConveniosLayout', () => {
  it('renderiza o titulo "Convenios"', () => {
    montar();
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
  });

  it('renderiza as 4 sub-abas: A faturar, Lotes, Retornos, Operadoras', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao convenios/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /A faturar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Lotes/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Retornos/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Operadoras/i })).toBeVisible();
  });

  it('marca a sub-aba Retornos com aria-current="page"', () => {
    montar('retornos');
    const link = screen.getByRole('link', { name: /Retornos/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /A faturar/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em Retornos chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('a-faturar');
    await userEvent.click(screen.getByRole('link', { name: /Retornos/i }));
    expect(aoNavegar).toHaveBeenCalledWith('retornos');
  });

  it('renderiza a faixa de contadores com os 6 valores', () => {
    montar();
    const grupo = screen.getByRole('group', { name: /Contadores de convenios/i });
    expect(grupo).toBeVisible();
    expect(screen.getByText('14')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(screen.getByText('5')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('8')).toBeVisible();
    expect(screen.getByText('1')).toBeVisible();
  });

  it('rotulos dos contadores incluem glosas pendentes e recursos rascunho', () => {
    montar();
    expect(screen.getByText(/Guias a faturar/i)).toBeVisible();
    expect(screen.getByText(/Lotes rascunho/i)).toBeVisible();
    expect(screen.getByText(/Lotes enviados/i)).toBeVisible();
    expect(screen.getByText(/Pendencias/i)).toBeVisible();
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos rascunho/i)).toBeVisible();
  });

  it('ao clicar em um contador chama aoFiltrar com a chave correta', async () => {
    const { aoFiltrar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('glosasPendentes');
  });

  it('renderiza o conteudo filho dentro do container', () => {
    montar();
    expect(screen.getByTestId('conteudo-filho')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLayout
        abaAtiva="a-faturar"
        aoNavegar={() => {}}
        contadores={CONTADORES}
        aoFiltrar={() => {}}
      >
        <div>Conteudo</div>
      </ConveniosLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha (sub-aba Retornos e contadores novos ausentes):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | tail -5
# Esperado: FAIL — unable to find link "Retornos" / contadores novos
```

- [ ] Atualizar `apps/web/src/telas/ConveniosLayout.tsx` para adicionar sub-aba Retornos e contadores novos:

```tsx
// apps/web/src/telas/ConveniosLayout.tsx
'use client';

import type { ReactNode } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type SubAbaConvenios = 'a-faturar' | 'lotes' | 'retornos' | 'operadoras';

export interface ContadoresConvenios {
  readonly guiasAFaturar: number;
  readonly lotesRascunho: number;
  readonly lotesEnviados: number;
  readonly pendencias: number;
  readonly glosasPendentes: number;
  readonly recursosRascunho: number;
}

export type FiltroConvenios = keyof ContadoresConvenios;

interface SubAbaConfig {
  readonly slug: SubAbaConvenios;
  readonly rotulo: string;
  readonly href: string;
}

const SUB_ABAS: readonly SubAbaConfig[] = [
  { slug: 'a-faturar',  rotulo: 'A faturar',  href: '/financeiro/convenios' },
  { slug: 'lotes',      rotulo: 'Lotes',       href: '/financeiro/convenios/lotes' },
  { slug: 'retornos',   rotulo: 'Retornos',    href: '/financeiro/convenios/retornos' },
  { slug: 'operadoras', rotulo: 'Operadoras',  href: '/financeiro/convenios/operadoras' },
];

const ROTULOS_CONTADORES: Record<FiltroConvenios, string> = {
  guiasAFaturar:    'Guias a faturar',
  lotesRascunho:    'Lotes rascunho',
  lotesEnviados:    'Lotes enviados',
  pendencias:       'Pendencias',
  glosasPendentes:  'Glosas pendentes',
  recursosRascunho: 'Recursos rascunho',
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface ConveniosLayoutProps {
  readonly abaAtiva: SubAbaConvenios;
  readonly aoNavegar: (aba: SubAbaConvenios) => void;
  readonly contadores: ContadoresConvenios;
  readonly aoFiltrar: (filtro: FiltroConvenios) => void;
  readonly filtroAtivo?: FiltroConvenios;
  readonly children: ReactNode;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLayout({
  abaAtiva, aoNavegar, contadores, aoFiltrar, filtroAtivo, children,
}: ConveniosLayoutProps) {
  const chaves = Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Convenios
      </h2>

      {/* Faixa de contadores */}
      <div
        role="group" aria-label="Contadores de convenios" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {chaves.map((k, i) => (
          <button
            key={k} type="button" onClick={() => aoFiltrar(k)}
            aria-pressed={filtroAtivo === k}
            style={{
              flex: 1, border: 0,
              background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
              {contadores[k]}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {ROTULOS_CONTADORES[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Sub-abas */}
      <nav aria-label="Sub-navegacao convenios">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)' }}>
          {SUB_ABAS.map((aba) => {
            const ativo = aba.slug === abaAtiva;
            return (
              <li key={aba.slug}>
                <a
                  href={aba.href}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); aoNavegar(aba.slug); }}
                  style={{
                    display: 'inline-block',
                    padding: `var(--s-4) var(--s-5)`,
                    color: ativo ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                    fontSize: 'var(--fs-14)',
                    textDecoration: 'none',
                    borderBottom: ativo
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    minHeight: 24,
                  }}
                >
                  {aba.rotulo}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | tail -3
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosLayout.tsx apps/web/src/telas/ConveniosLayout.test.tsx
git commit -m "feat(web): add Retornos tab and glosa counters to ConveniosLayout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 43: Atualizar convenios-navegacao.test para incluir fluxo Retornos

**Arquivos**

- Modificar `apps/web/src/telas/convenios-navegacao.test.tsx`

**Por que**: O teste de integracao de navegacao da Fase 4 valida a composicao FinanceiroLayout + ConveniosLayout + sub-abas. A Fase 5 precisa garantir que a sub-aba Retornos renderiza ConveniosRetornos dentro da composicao completa, e que os contadores novos aparecem.

- [ ] Atualizar o teste `apps/web/src/telas/convenios-navegacao.test.tsx`:

```tsx
// apps/web/src/telas/convenios-navegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout } from './FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosAFaturar, type AFaturarDados } from './ConveniosAFaturar';
import { ConveniosLotes, type LotesDados } from './ConveniosLotes';
import { ConveniosOperadoras, type OperadorasDados } from './ConveniosOperadoras';
import { ConveniosRetornos, type RetornosDados } from './ConveniosRetornos';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 7, lotesRascunho: 1, lotesEnviados: 3, pendencias: 2,
  glosasPendentes: 4, recursosRascunho: 1,
};

const DADOS_FATURAR: AFaturarDados = {
  guias: [
    {
      id: 'g1', numeroGuia: '000001', pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed', registroAns: '123456',
      codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
      valorCentavos: 15000, dataAtendimento: '2026-08-01', status: 'completa',
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
};

const DADOS_LOTES: LotesDados = {
  lotes: [
    {
      id: 'l1', numero: 'L-001', operadoraNome: 'Unimed',
      registroAns: '123456', status: 'rascunho',
      totalGuias: 3, totalCentavos: 45000,
      criadoEm: '2026-08-05', enviadoEm: null, guias: [],
    },
  ],
};

const DADOS_OPERADORAS: OperadorasDados = {
  operadoras: [
    {
      id: 'op1', nome: 'Unimed', registroAns: '123456',
      versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
      email: null, telefone: null, ativa: true, totalPacientes: 10,
    },
  ],
};

const DADOS_RETORNOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1', operadoraNome: 'Unimed', operadoraId: 'op1',
      registroAns: '123456', protocolo: 'PROT-001', tipo: 'analise',
      dataImportacao: '2026-08-01', periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31', totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000, totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000, totalItens: 15, itensGlosados: 3,
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totais: {
    apresentadoCentavos: 500000, processadoCentavos: 480000,
    liberadoCentavos: 450000, glosadoCentavos: 30000,
  },
};

describe('Navegacao completa: Financeiro > Convenios', () => {
  it('renderiza FinanceiroLayout com aba Convenios ativa contendo ConveniosLayout', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div data-testid="conteudo-afaturar">Fila</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Convenios/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByTestId('conteudo-afaturar')).toBeVisible();
  });

  it('sub-aba A faturar renderiza lista de guias', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosAFaturar
            carregarDados={async () => DADOS_FATURAR}
            aoCriarLote={async () => {}}
            aoAbrirGuia={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Carlos Melo')).toBeVisible());
    expect(screen.getByText('000001')).toBeVisible();
  });

  it('sub-aba Lotes renderiza lista de lotes', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="lotes" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosLotes
            carregarDados={async () => DADOS_LOTES}
            aoEnviar={async () => {}}
            aoCancelar={async () => {}}
            aoBaixarXml={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('L-001')).toBeVisible());
    expect(screen.getByText('Rascunho')).toBeVisible();
  });

  it('sub-aba Operadoras renderiza lista de operadoras', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="operadoras" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosOperadoras
            carregarDados={async () => DADOS_OPERADORAS}
            aoSalvar={async () => {}}
            aoDesativar={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible();
  });

  it('sub-aba Retornos renderiza lista de demonstrativos', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(screen.getByRole('link', { name: /Retornos/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
  });

  it('contadores da faixa incluem glosas pendentes e recursos rascunho', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos rascunho/i)).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
  });

  it('contadores da faixa sao botoes clicaveis', async () => {
    const aoFiltrar = vi.fn();
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={aoFiltrar}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('glosasPendentes');
  });

  it('sem violacao de acessibilidade na composicao com Retornos', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/convenios-navegacao.test.tsx 2>&1 | tail -3
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/convenios-navegacao.test.tsx
git commit -m "test(web): update convenios navigation test for Retornos tab and glosa counters

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 44: Teste de integracao de composicao: Retornos + Glosas + Recursos + Detalhe + Form

**Arquivos**

- Criar `apps/web/src/telas/retornos-glosas-composicao.test.tsx`

**Por que**: Valida que os 5 componentes novos (ConveniosRetornos, ConveniosGlosas, ConveniosRecursos, DetalheDemonstrativo, FormRecursoGlosa) exportam os tipos corretos, compoem sem erro dentro do ConveniosLayout, e o fluxo completo funciona: abrir retorno -> ver glosas -> selecionar -> abrir wizard -> submeter. E o "teste de fumo" que garante que nenhuma interface mudou silenciosamente.

- [ ] Criar o arquivo de teste `apps/web/src/telas/retornos-glosas-composicao.test.tsx`:

```tsx
// apps/web/src/telas/retornos-glosas-composicao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosRetornos, type RetornosDados } from './ConveniosRetornos';
import { ConveniosGlosas, type GlosasDados } from './ConveniosGlosas';
import { ConveniosRecursos, type RecursosDados } from './ConveniosRecursos';
import { DetalheDemonstrativo, type ItemDemonstrativo } from './DetalheDemonstrativo';
import { FormRecursoGlosa, type GlosaParaRecurso } from './FormRecursoGlosa';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 5, lotesRascunho: 1, lotesEnviados: 2, pendencias: 1,
  glosasPendentes: 3, recursosRascunho: 0,
};

const RETORNOS: RetornosDados = {
  demonstrativos: [{
    id: 'd1', operadoraNome: 'Unimed', operadoraId: 'op1',
    registroAns: '123456', protocolo: 'PROT-100', tipo: 'analise',
    dataImportacao: '2026-08-01', periodoInicio: '2026-07-01',
    periodoFim: '2026-07-31', totalApresentadoCentavos: 200000,
    totalProcessadoCentavos: 180000, totalLiberadoCentavos: 170000,
    totalGlosadoCentavos: 10000, totalItens: 8, itensGlosados: 2,
  }],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totais: { apresentadoCentavos: 200000, processadoCentavos: 180000,
            liberadoCentavos: 170000, glosadoCentavos: 10000 },
};

const GLOSAS: GlosasDados = {
  glosas: [{
    id: 'gl1', demonstrativoId: 'd1', guiaNumero: '000010',
    pacienteNome: 'Maria Lima', operadoraNome: 'Unimed', operadoraId: 'op1',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
    valorApresentadoCentavos: 15000, valorGlosadoCentavos: 15000,
    dataAtendimento: '2026-07-20', status: 'pendente',
  }],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totalGlosadoPendenteCentavos: 15000,
};

const RECURSOS: RecursosDados = {
  recursos: [{
    id: 'r1', operadoraNome: 'Unimed', operadoraId: 'op1',
    status: 'rascunho', justificativaGeral: 'Recurso.',
    criadoEm: '2026-08-05', enviadoEm: null, totalGlosasCentavos: 15000,
    itens: [{
      id: 'ri1', glosaId: 'gl1', guiaNumero: '000010',
      pacienteNome: 'Maria Lima', codigoGlosa: '1005',
      valorGlosadoCentavos: 15000, justificativa: 'Autorizado.',
    }],
  }],
};

const ITENS_DETALHE: readonly ItemDemonstrativo[] = [{
  id: 'it1', guiaNumero: '000010', pacienteNome: 'Maria Lima',
  codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
  apresentadoCentavos: 15000, processadoCentavos: 15000,
  liberadoCentavos: 0, glosadoCentavos: 15000,
  codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
}];

const GLOSAS_RECURSO: readonly GlosaParaRecurso[] = [{
  id: 'gl1', guiaNumero: '000010', pacienteNome: 'Maria Lima',
  codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
  valorGlosadoCentavos: 15000,
}];

describe('Composicao completa: Retornos + Glosas + Recursos + Detalhe + Form', () => {
  it('ConveniosRetornos compoe dentro de ConveniosLayout com aba retornos', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosRetornos
          carregarDados={async () => RETORNOS}
          aoImportarXml={async () => {}}
          aoAbrirDemonstrativo={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-100')).toBeVisible());
    expect(screen.getByRole('link', { name: /Retornos/i })).toHaveAttribute('aria-current', 'page');
  });

  it('ConveniosGlosas compoe dentro de ConveniosLayout', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosGlosas
          carregarDados={async () => GLOSAS}
          aoCriarRecurso={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('000010')).toBeVisible());
    expect(screen.getByText('Maria Lima')).toBeVisible();
  });

  it('ConveniosRecursos compoe dentro de ConveniosLayout', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosRecursos
          carregarDados={async () => RECURSOS}
          aoEditar={() => {}}
          aoEnviar={async () => {}}
          aoVerResultado={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText(/Rascunho/i)).toBeVisible();
  });

  it('DetalheDemonstrativo abre com itens do demonstrativo', () => {
    render(
      <DetalheDemonstrativo
        aberto
        titulo="Demonstrativo PROT-100"
        itens={ITENS_DETALHE}
        aoFechar={() => {}}
      />,
    );
    expect(screen.getByText('Demonstrativo PROT-100')).toBeVisible();
    expect(screen.getByText('000010')).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
  });

  it('FormRecursoGlosa wizard completo: preencher justificativa -> proximo -> submeter', async () => {
    const aoSubmeter = vi.fn<(d: {
      glosas: { glosaId: string; justificativa: string }[];
      justificativaGeral: string;
    }) => Promise<void>>().mockResolvedValue(undefined);

    render(
      <FormRecursoGlosa
        glosas={GLOSAS_RECURSO}
        aoSubmeter={aoSubmeter}
        aoCancelar={() => {}}
      />,
    );
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
    const campo = screen.getByLabelText(/Justificativa/i);
    await userEvent.type(campo, 'Procedimento devidamente autorizado.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    const geral = screen.getByLabelText(/Justificativa geral/i);
    await userEvent.type(geral, 'Recurso conforme protocolo.');
    await userEvent.click(screen.getByRole('button', { name: /Submeter/i }));
    await waitFor(() => {
      expect(aoSubmeter).toHaveBeenCalledWith({
        glosas: [{ glosaId: 'gl1', justificativa: 'Procedimento devidamente autorizado.' }],
        justificativaGeral: 'Recurso conforme protocolo.',
      });
    });
  });

  it('sem violacao de acessibilidade na composicao com glosas', async () => {
    const { container } = render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosGlosas
          carregarDados={async () => GLOSAS}
          aoCriarRecurso={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('000010')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/retornos-glosas-composicao.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Executar todos os testes do bloco de uma vez para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx apps/web/src/telas/ConveniosGlosas.test.tsx apps/web/src/telas/ConveniosRecursos.test.tsx apps/web/src/telas/DetalheDemonstrativo.test.tsx apps/web/src/telas/FormRecursoGlosa.test.tsx apps/web/src/telas/ConveniosLayout.test.tsx apps/web/src/telas/convenios-navegacao.test.tsx apps/web/src/telas/retornos-glosas-composicao.test.tsx 2>&1 | tail -5
# Esperado: Tests  55+ passed, 0 failed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/retornos-glosas-composicao.test.tsx
git commit -m "test(web): add composition test for retornos, glosas, recursos, detalhe and form

Co-Authored-By: Claude <noreply@anthropic.com>"
```
### Task 45: Acoes RBAC para demonstrativo, glosa e recurso no catalogo de autorizacao

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Criar: `packages/authz/src/actions-fase5.test.ts`

**Passos**

- [ ] Escrever o teste que valida as 6 novas acoes da Fase 5:

```ts
// packages/authz/src/actions-fase5.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS Fase 5 (demonstrativo, glosa, recurso)', () => {
  const fase5Keys = [
    'tiss.demonstrativo.import',
    'tiss.demonstrativo.read',
    'tiss.glosa.read',
    'tiss.glosa.manage',
    'tiss.recurso.manage',
    'tiss.recurso.send',
  ];

  it.each(fase5Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.demonstrativo.import so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.import')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.demonstrativo.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.demonstrativo.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.read permite admin_clinico, diretor_tecnico, financeiro e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('diretor_tecnico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.glosa.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.glosa.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.manage so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.recurso.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.recurso.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao Fase 5 TISS exige MFA', () => {
    for (const key of fase5Keys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions-fase5.test.ts
# ESPERADO: FAIL — acao "tiss.demonstrativo.import" nao existe no catalogo
```

- [ ] Adicionar as 6 acoes ao catalogo. Em `packages/authz/src/actions.ts`, inserir antes do `] as const satisfies readonly ActionDef[];`:

```ts
  // ── Fase 5 · Demonstrativo, glosa e recurso ──────────────────────────
  { key: 'tiss.demonstrativo.import', description: 'Importar demonstrativo XML da operadora',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.demonstrativo.read', description: 'Listar e visualizar demonstrativos de retorno',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.read', description: 'Listar e visualizar glosas',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro', 'recepcao'] },
  { key: 'tiss.glosa.manage', description: 'Aceitar glosa individual',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.manage', description: 'Criar, montar e gerenciar recursos de glosa',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.recurso.send', description: 'Enviar recurso de glosa para operadora',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions-fase5.test.ts
# ESPERADO: PASS — todas as 9 assercoes verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions-fase5.test.ts
git commit -m "feat(authz): add Fase 5 RBAC actions for demonstrativo, glosa and recurso

Add tiss.demonstrativo.import, tiss.demonstrativo.read,
tiss.glosa.read, tiss.glosa.manage, tiss.recurso.manage
and tiss.recurso.send to the action catalog.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 46: Rotas de demonstrativos TISS (importar XML multipart, listar, detalhe)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/demonstrativos.ts`
- Criar: `apps/api/src/routes/tiss/demonstrativos.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Instalar dependencia de multipart:

```bash
pnpm add @fastify/multipart --filter @cadencia/api
```

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/demonstrativos.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoIdSeed: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

function buildMinimalDemonstrativoXml(protocolo: string): string {
  return [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
    '<ans:cabecalho>',
    '<ans:identificacaoTransacao>',
    '<ans:tipoTransacao>DEMONSTRATIVO_RETORNO</ans:tipoTransacao>',
    '</ans:identificacaoTransacao>',
    '</ans:cabecalho>',
    '<ans:operacaoANS>',
    '<ans:demonstrativoRetorno>',
    '<ans:demonstrativoAnalise>',
    '<ans:cabecalhoDemonstrativo>',
    `<ans:numeroDemonstrativo>${protocolo}</ans:numeroDemonstrativo>`,
    '</ans:cabecalhoDemonstrativo>',
    '<ans:relacaoGuias>',
    '<ans:guia>',
    '<ans:dadosGuia>',
    '<ans:numeroGuiaPrestador>GP-00001</ans:numeroGuiaPrestador>',
    '</ans:dadosGuia>',
    '<ans:procedimentosRealizados>',
    '<ans:procedimento>',
    '<ans:codigoProcedimento>10101012</ans:codigoProcedimento>',
    '<ans:valorInformado>150.00</ans:valorInformado>',
    '<ans:valorProcessado>120.00</ans:valorProcessado>',
    '<ans:valorGlosa>30.00</ans:valorGlosa>',
    '<ans:codigoGlosa>1005</ans:codigoGlosa>',
    '</ans:procedimento>',
    '</ans:procedimentosRealizados>',
    '</ans:guia>',
    '</ans:relacaoGuias>',
    '</ans:demonstrativoAnalise>',
    '</ans:demonstrativoRetorno>',
    '</ans:operacaoANS>',
    '</ans:mensagemTISS>',
  ].join('\n');
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Demo', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Semear demonstrativo para teste de listagem e detalhe
    demoIdSeed = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-SEED', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               15000, 12000, 3000, 1, $4)`,
      [admin.tenantId, demoIdSeed, operadoraId, admin.userId]);

    const itemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-SEED-001',
               '10101012', 15000, 12000, 3000, '1005',
               'glosado_parcial', 'pendente')`,
      [admin.tenantId, itemId, demoIdSeed]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de demonstrativos TISS', () => {
  let demoIdImported: string;

  it('POST /v1/tiss/demonstrativos/importar importa XML via multipart', async () => {
    const app = await buildApp();
    const boundary = '----TestBoundary7MA4YWxkTrZu0gW';
    const xmlContent = buildMinimalDemonstrativoXml('PROTO-IMP-001');
    const payload = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="operadoraId"',
      '',
      operadoraId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="xml"; filename="demo.xml"',
      'Content-Type: application/xml',
      '',
      xmlContent,
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const r = await app.inject({
      method: 'POST',
      url: '/v1/tiss/demonstrativos/importar',
      headers: {
        ...auth(admin).headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: auth(admin).cookies,
      payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { demonstrativoId: string; itemCount: number };
    expect(body.demonstrativoId).toBeTruthy();
    expect(body.itemCount).toBe(1);
    demoIdImported = body.demonstrativoId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/demonstrativos lista demonstrativos do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ demonstrativoId: string; protocolo: string }>;
      nextCursor: string | null;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((d) => d.demonstrativoId === demoIdSeed)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/demonstrativos/:id detalhe com itens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/demonstrativos/${demoIdSeed}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      demonstrativoId: string;
      protocolo: string;
      itens: Array<{ itemId: string; codigoGlosa: string | null }>;
    };
    expect(body.demonstrativoId).toBe(demoIdSeed);
    expect(body.protocolo).toBe('PROTO-SEED');
    expect(body.itens.length).toBe(1);
    expect(body.itens[0]!.codigoGlosa).toBe('1005');
    await app.close();
  });

  it('recepcao le demonstrativos com tiss.demonstrativo.read', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(recepcao),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao recebe 403 ao tentar importar demonstrativo', async () => {
    const app = await buildApp();
    const boundary = '----TestBoundary';
    const payload = Buffer.from([
      `--${boundary}`,
      'Content-Disposition: form-data; name="operadoraId"',
      '',
      operadoraId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="xml"; filename="demo.xml"',
      'Content-Type: application/xml',
      '',
      '<?xml version="1.0"?><dummy/>',
      `--${boundary}--`,
      '',
    ].join('\r\n'));

    const r = await app.inject({
      method: 'POST',
      url: '/v1/tiss/demonstrativos/importar',
      headers: {
        ...auth(recepcao).headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      cookies: auth(recepcao).cookies,
      payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('medico recebe 403 ao tentar listar demonstrativos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(medico),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/demonstrativos.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/demonstrativos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';
import { comTransacao } from '../../context';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// ---------------------------------------------------------------------------
// Parser minimo de demonstrativo TISS XML
// ---------------------------------------------------------------------------

interface DemoParsedItem {
  numeroGuiaPrestador: string;
  codigoProcedimento: string;
  valorInformadoCents: number;
  valorProcessadoCents: number;
  valorGlosaCents: number;
  codigoGlosa: string | null;
}

interface DemoParsed {
  protocolo: string;
  tipo: 'analise' | 'pagamento';
  itens: DemoParsedItem[];
}

function tagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:ans:)?${tag}>([^<]*)<\\/(?:ans:)?${tag}>`);
  const m = xml.match(re);
  return m ? m[1]! : null;
}

function realToCents(val: string | null): number {
  if (val === null || val === '') return 0;
  return Math.round(Number(val.replace(',', '.')) * 100);
}

function parseDemonstrativoXml(xmlBytes: Buffer): DemoParsed {
  const xml = new TextDecoder('iso-8859-1').decode(xmlBytes);

  const protocolo = tagValue(xml, 'numeroDemonstrativo') ?? '';
  if (protocolo === '') erroDominio('xml_protocolo_ausente', 422);

  const tipo: 'analise' | 'pagamento' =
    xml.includes('demonstrativoAnalise') ? 'analise' : 'pagamento';

  // Extrair blocos de guia
  const guiaRegex = /<(?:ans:)?guia>([\s\S]*?)<\/(?:ans:)?guia>/g;
  const itens: DemoParsedItem[] = [];

  let guiaMatch: RegExpExecArray | null;
  while ((guiaMatch = guiaRegex.exec(xml)) !== null) {
    const guiaBlock = guiaMatch[1]!;
    const nrGuia = tagValue(guiaBlock, 'numeroGuiaPrestador') ?? '';

    // Extrair procedimentos dentro da guia
    const procRegex =
      /<(?:ans:)?procedimento>([\s\S]*?)<\/(?:ans:)?procedimento>/g;
    let procMatch: RegExpExecArray | null;
    while ((procMatch = procRegex.exec(guiaBlock)) !== null) {
      const pb = procMatch[1]!;
      itens.push({
        numeroGuiaPrestador: nrGuia,
        codigoProcedimento: tagValue(pb, 'codigoProcedimento') ?? '',
        valorInformadoCents: realToCents(tagValue(pb, 'valorInformado')),
        valorProcessadoCents: realToCents(tagValue(pb, 'valorProcessado')),
        valorGlosaCents: realToCents(tagValue(pb, 'valorGlosa')),
        codigoGlosa: tagValue(pb, 'codigoGlosa'),
      });
    }
  }

  return { protocolo, tipo, itens };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DemoResumoSchema = z.object({
  demonstrativoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  tipo: z.enum(['analise', 'pagamento']),
  dataEmissao: z.string(),
  totalInformadoCents: z.number().int(),
  totalProcessadoCents: z.number().int(),
  totalGlosaCents: z.number().int(),
  itemCount: z.number().int(),
  createdAt: z.string(),
});

const DemoItemSchema = z.object({
  itemId: z.string().uuid(),
  numeroGuiaPrestador: z.string(),
  codigoProcedimento: z.string(),
  valorInformadoCents: z.number().int(),
  valorProcessadoCents: z.number().int(),
  valorGlosaCents: z.number().int(),
  codigoGlosa: z.string().nullable(),
  status: z.string(),
  aceite: z.string(),
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function demonstrativoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/demonstrativos/importar — multipart upload ──────────
  r.post('/v1/tiss/demonstrativos/importar', {
    schema: {
      response: {
        201: z.object({
          demonstrativoId: z.string().uuid(),
          itemCount: z.number().int(),
        }),
      },
    },
  }, async (req, reply) => {
    // Extrair campos do multipart
    let xmlBuffer: Buffer | undefined;
    let operadoraIdField: string | undefined;
    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'xml') {
        xmlBuffer = await part.toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'operadoraId') {
        operadoraIdField = String(part.value);
      }
    }

    if (xmlBuffer === undefined || xmlBuffer.length === 0) {
      erroDominio('xml_ausente', 400);
    }
    if (operadoraIdField === undefined || operadoraIdField === '') {
      erroDominio('operadora_id_ausente', 400);
    }

    const parsed = parseDemonstrativoXml(xmlBuffer);
    const capturedXml = xmlBuffer;
    const capturedOpId = operadoraIdField;

    // Delegar ao guard de RBAC + transacao
    const handler = rota('tiss.demonstrativo.import', async (tx, _ctx) => {
      // Verificar que a operadora existe
      const { rowCount: opExiste } = await tx.query(
        `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
        [capturedOpId]);
      if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

      const demoId = uuidv7();
      let totalInf = 0;
      let totalProc = 0;
      let totalGlosa = 0;

      for (const item of parsed.itens) {
        totalInf += item.valorInformadoCents;
        totalProc += item.valorProcessadoCents;
        totalGlosa += item.valorGlosaCents;
      }

      await tx.query(
        `INSERT INTO tiss.demonstrativo
           (id, operadora_id, protocolo, tipo, data_emissao,
            total_informado_cents, total_processado_cents, total_glosa_cents,
            item_count, imported_by)
         VALUES ($1, $2, $3, $4,
                 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
                 $5, $6, $7, $8, app.current_user_id())`,
        [demoId, capturedOpId, parsed.protocolo, parsed.tipo,
         totalInf, totalProc, totalGlosa, parsed.itens.length]);

      // Inserir itens
      for (const item of parsed.itens) {
        const itemStatus = item.valorGlosaCents > 0
          ? (item.valorProcessadoCents === 0 ? 'glosado_total' : 'glosado_parcial')
          : 'pago';

        await tx.query(
          `INSERT INTO tiss.demonstrativo_item
             (id, demonstrativo_id, numero_guia_prestador,
              codigo_procedimento, valor_informado_cents, valor_processado_cents,
              valor_glosa_cents, codigo_glosa, status, aceite)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente')`,
          [uuidv7(), demoId, item.numeroGuiaPrestador,
           item.codigoProcedimento, item.valorInformadoCents,
           item.valorProcessadoCents, item.valorGlosaCents,
           item.codigoGlosa, itemStatus]);
      }

      // Auditoria
      await tx.query(
        `SELECT audit.log('TISS_DEMO_IMPORT', 'tiss', 'demonstrativo', $1,
                'sucesso',
                jsonb_build_object('protocolo', $2::text,
                                   'item_count', $3::int), $4)`,
        [demoId, parsed.protocolo, parsed.itens.length,
         _ctx.actor.clinicId]);

      void reply.code(201);
      return { demonstrativoId: demoId, itemCount: parsed.itens.length };
    });

    return handler(req, reply);
  });

  // ── GET /v1/tiss/demonstrativos — listar com paginacao ────────────────
  r.get('/v1/tiss/demonstrativos', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        tipo: z.enum(['analise', 'pagamento']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(DemoResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; tipo?: string;
      limit?: number; cursor?: string;
    };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.operadoraId !== undefined) {
      condicoes.push(`d.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.tipo !== undefined) {
      condicoes.push(`d.tipo = $${idx}`);
      params.push(q.tipo); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`d.created_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo: string; tipo: string; data_emissao: string;
      total_informado_cents: string; total_processado_cents: string;
      total_glosa_cents: string; item_count: number; created_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo, d.tipo, d.data_emissao::text,
              d.total_informado_cents::text, d.total_processado_cents::text,
              d.total_glosa_cents::text, d.item_count,
              to_char(d.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      demonstrativoId: row.id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      tipo: row.tipo as 'analise' | 'pagamento',
      dataEmissao: row.data_emissao,
      totalInformadoCents: Number(row.total_informado_cents),
      totalProcessadoCents: Number(row.total_processado_cents),
      totalGlosaCents: Number(row.total_glosa_cents),
      itemCount: row.item_count,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/demonstrativos/:id — detalhe com itens ───────────────
  r.get('/v1/tiss/demonstrativos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: DemoResumoSchema.extend({
          itens: z.array(DemoItemSchema),
        }),
      },
    },
  }, rota('tiss.demonstrativo.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      protocolo: string; tipo: string; data_emissao: string;
      total_informado_cents: string; total_processado_cents: string;
      total_glosa_cents: string; item_count: number; created_at: string;
    }>(
      `SELECT d.id, d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo, d.tipo, d.data_emissao::text,
              d.total_informado_cents::text, d.total_processado_cents::text,
              d.total_glosa_cents::text, d.item_count,
              to_char(d.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo d
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE d.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('demonstrativo_nao_encontrado', 404);
    const demo = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      status: string; aceite: string;
    }>(
      `SELECT id, numero_guia_prestador, codigo_procedimento,
              valor_informado_cents::text, valor_processado_cents::text,
              valor_glosa_cents::text, codigo_glosa, status, aceite
         FROM tiss.demonstrativo_item
        WHERE demonstrativo_id = $1
        ORDER BY created_at`,
      [p.id]);

    return {
      demonstrativoId: demo.id,
      operadoraId: demo.operadora_id,
      operadoraNome: demo.operadora_nome,
      protocolo: demo.protocolo,
      tipo: demo.tipo as 'analise' | 'pagamento',
      dataEmissao: demo.data_emissao,
      totalInformadoCents: Number(demo.total_informado_cents),
      totalProcessadoCents: Number(demo.total_processado_cents),
      totalGlosaCents: Number(demo.total_glosa_cents),
      itemCount: demo.item_count,
      createdAt: demo.created_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        numeroGuiaPrestador: i.numero_guia_prestador,
        codigoProcedimento: i.codigo_procedimento,
        valorInformadoCents: Number(i.valor_informado_cents),
        valorProcessadoCents: Number(i.valor_processado_cents),
        valorGlosaCents: Number(i.valor_glosa_cents),
        codigoGlosa: i.codigo_glosa,
        status: i.status,
        aceite: i.aceite,
      })),
    };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import no bloco de imports:

```ts
import { demonstrativoRoutes } from './routes/tiss/demonstrativos';
```

E adicionar no corpo de `buildApp`, apos `await app.register(convenioPacienteRoutes);`:

```ts
  await app.register(demonstrativoRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/demonstrativos.int.test.ts
# ESPERADO: PASS — 6 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/demonstrativos.ts apps/api/src/routes/tiss/demonstrativos.int.test.ts apps/api/src/app.ts package.json pnpm-lock.yaml
git commit -m "feat(api): add TISS demonstrativo routes (import/list/detail)

POST /v1/tiss/demonstrativos/importar (multipart XML upload with
inline parsing), GET /v1/tiss/demonstrativos (cursor pagination),
GET /v1/tiss/demonstrativos/:id (detail with items).
RBAC: tiss.demonstrativo.import for upload, tiss.demonstrativo.read
for list/detail. no-store on all responses.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 47: Rotas de glosas TISS (listar com filtros, detalhe, aceitar)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/glosas.ts`
- Criar: `apps/api/src/routes/tiss/glosas.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/glosas.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoId: string;
let glosaItemId: string;
let glosaItemPagoId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Glosa', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-GLOSA', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               30000, 15000, 15000, 2, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    glosaItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-GL-001',
               '10101012', 15000, 0, 15000, '1005',
               'Procedimento nao autorizado', 'glosado_total', 'pendente')`,
      [admin.tenantId, glosaItemId, demoId]);

    glosaItemPagoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, status, aceite)
       VALUES ($1, $2, $3, 'GP-GL-002',
               '10101020', 15000, 15000, 0, 'pago', 'pendente')`,
      [admin.tenantId, glosaItemPagoId, demoId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de glosas TISS', () => {
  it('GET /v1/tiss/glosas lista somente itens glosados', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ itemId: string; status: string }>;
      nextCursor: string | null;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    // Somente itens glosados, nao pagos
    const ids = body.itens.map((i) => i.itemId);
    expect(ids).toContain(glosaItemId);
    expect(ids).not.toContain(glosaItemPagoId);
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas?operadoraId=${operadoraId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ itemId: string }> };
    expect(body.itens.some((i) => i.itemId === glosaItemId)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por aceite pendente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/tiss/glosas?aceite=pendente',
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ aceite: string }> };
    for (const item of body.itens) {
      expect(item.aceite).toBe('pendente');
    }
    await app.close();
  });

  it('GET /v1/tiss/glosas/:id detalhe da glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itemId: string; codigoGlosa: string;
      motivoGlosa: string; valorGlosaCents: number;
    };
    expect(body.itemId).toBe(glosaItemId);
    expect(body.codigoGlosa).toBe('1005');
    expect(body.motivoGlosa).toBe('Procedimento nao autorizado');
    expect(body.valorGlosaCents).toBe(15000);
    await app.close();
  });

  it('POST /v1/tiss/glosas/:id/aceitar aceita glosa individual', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemId}/aceitar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itemId: string; aceite: string };
    expect(body.itemId).toBe(glosaItemId);
    expect(body.aceite).toBe('aceita');
    await app.close();
  });

  it('recepcao le glosas mas nao pode aceitar', async () => {
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recepcao),
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemId}/aceitar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r2.statusCode).toBe(403);
    await app.close();
  });

  it('medico recebe 403 ao tentar listar glosas', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medico),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/glosas.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/glosas.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const GlosaResumoSchema = z.object({
  itemId: z.string().uuid(),
  demonstrativoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  protocolo: z.string(),
  numeroGuiaPrestador: z.string(),
  codigoProcedimento: z.string(),
  valorInformadoCents: z.number().int(),
  valorProcessadoCents: z.number().int(),
  valorGlosaCents: z.number().int(),
  codigoGlosa: z.string().nullable(),
  status: z.string(),
  aceite: z.string(),
  createdAt: z.string(),
});

const GlosaDetalheSchema = GlosaResumoSchema.extend({
  motivoGlosa: z.string().nullable(),
  dataEmissao: z.string(),
});

export async function glosaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/tiss/glosas — listar glosas com filtros ───────────────────
  r.get('/v1/tiss/glosas', {
    schema: {
      querystring: z.object({
        operadoraId: z.string().uuid().optional(),
        aceite: z.enum(['pendente', 'aceita', 'em_recurso', 'recuperada']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(GlosaResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const q = req.query as {
      operadoraId?: string; aceite?: string;
      limit?: number; cursor?: string;
    };
    const limite = q.limit ?? 25;
    const condicoes: string[] = [
      `di.status IN ('glosado_total', 'glosado_parcial')`,
    ];
    const params: unknown[] = [];
    let idx = 1;

    if (q.operadoraId !== undefined) {
      condicoes.push(`d.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.aceite !== undefined) {
      condicoes.push(`di.aceite = $${idx}`);
      params.push(q.aceite); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`di.created_at < $${idx}::timestamptz`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; demonstrativo_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      status: string; aceite: string; created_at: string;
    }>(
      `SELECT di.id, di.demonstrativo_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo,
              di.numero_guia_prestador, di.codigo_procedimento,
              di.valor_informado_cents::text, di.valor_processado_cents::text,
              di.valor_glosa_cents::text, di.codigo_glosa,
              di.status, di.aceite,
              to_char(di.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo_item di
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE ${where}
        ORDER BY di.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      itemId: row.id,
      demonstrativoId: row.demonstrativo_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoProcedimento: row.codigo_procedimento,
      valorInformadoCents: Number(row.valor_informado_cents),
      valorProcessadoCents: Number(row.valor_processado_cents),
      valorGlosaCents: Number(row.valor_glosa_cents),
      codigoGlosa: row.codigo_glosa,
      status: row.status,
      aceite: row.aceite,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/glosas/:id — detalhe da glosa ───────────────────────
  r.get('/v1/tiss/glosas/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: GlosaDetalheSchema },
    },
  }, rota('tiss.glosa.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; demonstrativo_id: string;
      operadora_id: string; operadora_nome: string; protocolo: string;
      numero_guia_prestador: string; codigo_procedimento: string;
      valor_informado_cents: string; valor_processado_cents: string;
      valor_glosa_cents: string; codigo_glosa: string | null;
      motivo_glosa: string | null;
      status: string; aceite: string;
      data_emissao: string; created_at: string;
    }>(
      `SELECT di.id, di.demonstrativo_id,
              d.operadora_id, o.razao_social AS operadora_nome,
              d.protocolo,
              di.numero_guia_prestador, di.codigo_procedimento,
              di.valor_informado_cents::text, di.valor_processado_cents::text,
              di.valor_glosa_cents::text, di.codigo_glosa, di.motivo_glosa,
              di.status, di.aceite,
              d.data_emissao::text,
              to_char(di.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.demonstrativo_item di
         JOIN tiss.demonstrativo d
           ON d.tenant_id = di.tenant_id AND d.id = di.demonstrativo_id
         JOIN tiss.operadora o
           ON o.tenant_id = d.tenant_id AND o.id = d.operadora_id
        WHERE di.id = $1
          AND di.status IN ('glosado_total', 'glosado_parcial')`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const row = rows[0]!;

    return {
      itemId: row.id,
      demonstrativoId: row.demonstrativo_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      protocolo: row.protocolo,
      numeroGuiaPrestador: row.numero_guia_prestador,
      codigoProcedimento: row.codigo_procedimento,
      valorInformadoCents: Number(row.valor_informado_cents),
      valorProcessadoCents: Number(row.valor_processado_cents),
      valorGlosaCents: Number(row.valor_glosa_cents),
      codigoGlosa: row.codigo_glosa,
      motivoGlosa: row.motivo_glosa,
      status: row.status,
      aceite: row.aceite,
      dataEmissao: row.data_emissao,
      createdAt: row.created_at,
    };
  }));

  // ── POST /v1/tiss/glosas/:id/aceitar — aceitar glosa individual ───────
  r.post('/v1/tiss/glosas/:id/aceitar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          itemId: z.string().uuid(),
          aceite: z.literal('aceita'),
        }),
      },
    },
  }, rota('tiss.glosa.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    // Verificar que o item existe, e glosa e esta pendente
    const { rows } = await tx.query<{
      status: string; aceite: string; demonstrativo_id: string;
    }>(
      `SELECT status, aceite, demonstrativo_id
         FROM tiss.demonstrativo_item
        WHERE id = $1 FOR UPDATE`,
      [p.id]);

    if (rows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    const item = rows[0]!;

    if (item.status !== 'glosado_total' && item.status !== 'glosado_parcial') {
      erroDominio('item_nao_glosado', 422);
    }
    if (item.aceite !== 'pendente') {
      erroDominio('glosa_ja_processada', 422,
        { aceiteAtual: item.aceite });
    }

    await tx.query(
      `UPDATE tiss.demonstrativo_item SET aceite = 'aceita'
        WHERE id = $1`,
      [p.id]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_GLOSA_ACEITA', 'tiss', 'demonstrativo_item',
              $1, 'sucesso',
              jsonb_build_object('demonstrativo_id', $2::text), $3)`,
      [p.id, item.demonstrativo_id, ctx.actor.clinicId]);

    return { itemId: p.id, aceite: 'aceita' as const };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { glosaRoutes } from './routes/tiss/glosas';
```

E registrar apos `await app.register(demonstrativoRoutes);`:

```ts
  await app.register(glosaRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/glosas.int.test.ts
# ESPERADO: PASS — 7 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/glosas.ts apps/api/src/routes/tiss/glosas.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS glosa routes (list/detail/accept)

GET /v1/tiss/glosas (filter by operadora/aceite, cursor pagination),
GET /v1/tiss/glosas/:id (detail with motivo),
POST /v1/tiss/glosas/:id/aceitar (accept individual glosa).
RBAC: tiss.glosa.read for list/detail, tiss.glosa.manage for accept.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 48: Rotas de recursos de glosa TISS (criar, adicionar/remover item, marcar pronto, listar, detalhe)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/recursos.ts`
- Criar: `apps/api/src/routes/tiss/recursos.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/recursos.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let demoId: string;
let glosaItemIdA: string;
let glosaItemIdB: string;
let versionId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Recurso', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Encounter version para §3.9 (recurso sempre cita versao usada)
    versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('recurso-test-seed'::bytea), 'test-v1')`,
      [admin.tenantId, versionId, admin.encounterId,
       admin.userId, admin.professionalId]);

    demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-REC', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               30000, 10000, 20000, 2, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    glosaItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-REC-001',
               '10101012', 15000, 0, 15000, '1005',
               'Sem autorizacao previa', 'glosado_total', 'pendente')`,
      [admin.tenantId, glosaItemIdA, demoId]);

    glosaItemIdB = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, motivo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-REC-002',
               '10101020', 15000, 10000, 5000, '1010',
               'Valor acima da tabela', 'glosado_parcial', 'pendente')`,
      [admin.tenantId, glosaItemIdB, demoId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de recursos de glosa TISS', () => {
  let recursoId: string;
  let recursoItemIdA: string;

  it('POST /v1/tiss/recursos cria recurso vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(admin),
      payload: {
        operadoraId,
        justificativaGeral: 'Recurso de glosas do lote de julho',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recursoId: string };
    expect(body.recursoId).toBeTruthy();
    recursoId = body.recursoId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona glosa ao recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdA,
        encounterVersionId: versionId,
        justificativa: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { itemId: string };
    expect(body.itemId).toBeTruthy();
    recursoItemIdA = body.itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona segunda glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdB,
        encounterVersionId: versionId,
        justificativa: 'Valor conforme contrato vigente',
        valorRecursadoCents: 5000,
      },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it('GET /v1/tiss/recursos lista recursos do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ recursoId: string; itemCount: number }>;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    const rec = body.itens.find((r) => r.recursoId === recursoId);
    expect(rec).toBeDefined();
    expect(rec!.itemCount).toBe(2);
    await app.close();
  });

  it('GET /v1/tiss/recursos/:id detalhe com itens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      recursoId: string;
      itens: Array<{
        itemId: string;
        encounterVersionId: string;
        justificativa: string;
      }>;
    };
    expect(body.recursoId).toBe(recursoId);
    expect(body.itens.length).toBe(2);
    // §3.9: recurso cita a versao usada
    expect(body.itens[0]!.encounterVersionId).toBe(versionId);
    await app.close();
  });

  it('DELETE /v1/tiss/recursos/:id/itens/:itemId remove glosa do recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/tiss/recursos/${recursoId}/itens/${recursoItemIdA}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { removido: boolean }).removido).toBe(true);

    // Re-adicionar para os testes seguintes
    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        demonstrativoItemId: glosaItemIdA,
        encounterVersionId: versionId,
        justificativa: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    recursoItemIdA = (r2.json() as { itemId: string }).itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/pronto marca recurso como pronto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/pronto`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('pronto');
    await app.close();
  });

  it('medico recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medico),
      payload: {
        operadoraId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('recepcao recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recepcao),
      payload: {
        operadoraId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/recursos.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const RecursoResumoSchema = z.object({
  recursoId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  status: z.string(),
  justificativaGeral: z.string().nullable(),
  itemCount: z.number().int(),
  totalRecursadoCents: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});

const RecursoItemSchema = z.object({
  itemId: z.string().uuid(),
  demonstrativoItemId: z.string().uuid(),
  encounterVersionId: z.string().uuid(),
  justificativa: z.string(),
  valorRecursadoCents: z.number().int(),
  resultado: z.string().nullable(),
  valorResultadoCents: z.number().int().nullable(),
});

export async function recursoRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/recursos — criar recurso vazio ──────────────────────
  r.post('/v1/tiss/recursos', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        justificativaGeral: z.string().min(1).max(2000).optional(),
      }),
      response: { 201: z.object({ recursoId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as { operadoraId: string; justificativaGeral?: string };
    const id = uuidv7();

    // Verificar que a operadora existe
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    await tx.query(
      `INSERT INTO tiss.recurso_glosa
         (id, operadora_id, status, justificativa_geral,
          item_count, total_recursado_cents, created_by)
       VALUES ($1, $2, 'rascunho', $3, 0, 0, app.current_user_id())`,
      [id, b.operadoraId, b.justificativaGeral ?? null]);

    void reply.code(201);
    return { recursoId: id };
  }));

  // ── POST /v1/tiss/recursos/:id/itens — adicionar glosa ao recurso ────
  r.post('/v1/tiss/recursos/:id/itens', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        demonstrativoItemId: z.string().uuid(),
        encounterVersionId: z.string().uuid(),
        justificativa: z.string().min(1).max(2000),
        valorRecursadoCents: z.number().int().min(1),
      }),
      response: { 201: z.object({ itemId: z.string().uuid() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      demonstrativoItemId: string; encounterVersionId: string;
      justificativa: string; valorRecursadoCents: number;
    };

    // Verificar que o recurso existe e esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Verificar que o item do demonstrativo e uma glosa pendente
    const { rows: diRows } = await tx.query<{ aceite: string }>(
      `SELECT aceite FROM tiss.demonstrativo_item
        WHERE id = $1
          AND status IN ('glosado_total', 'glosado_parcial')`,
      [b.demonstrativoItemId]);
    if (diRows.length === 0) erroDominio('glosa_nao_encontrada', 404);
    if (diRows[0]!.aceite === 'aceita') {
      erroDominio('glosa_ja_aceita', 422);
    }

    // Verificar que a encounter_version existe
    const { rowCount: verExiste } = await tx.query(
      `SELECT 1 FROM clin.encounter_version WHERE id = $1`,
      [b.encounterVersionId]);
    if (verExiste === 0) erroDominio('versao_nao_encontrada', 404);

    // Verificar se a glosa ja esta em outro recurso ativo
    const { rowCount: jaEmRecurso } = await tx.query(
      `SELECT 1 FROM tiss.recurso_glosa_item ri
         JOIN tiss.recurso_glosa rg
           ON rg.tenant_id = ri.tenant_id AND rg.id = ri.recurso_id
        WHERE ri.demonstrativo_item_id = $1
          AND rg.status IN ('rascunho', 'pronto', 'enviado')`,
      [b.demonstrativoItemId]);
    if (jaEmRecurso !== null && jaEmRecurso > 0) {
      erroDominio('glosa_ja_em_recurso', 422);
    }

    const itemId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (id, recurso_id, demonstrativo_item_id, encounter_version_id,
          justificativa, valor_recursado_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, p.id, b.demonstrativoItemId, b.encounterVersionId,
       b.justificativa, b.valorRecursadoCents]);

    // Atualizar contadores no recurso
    const newCount = recRows[0]!.item_count + 1;
    const newTotal = Number(recRows[0]!.total_recursado_cents) + b.valorRecursadoCents;
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET item_count = $2, total_recursado_cents = $3
        WHERE id = $1`,
      [p.id, newCount, newTotal]);

    // Marcar a glosa como em_recurso
    await tx.query(
      `UPDATE tiss.demonstrativo_item SET aceite = 'em_recurso'
        WHERE id = $1`,
      [b.demonstrativoItemId]);

    void reply.code(201);
    return { itemId };
  }));

  // ── DELETE /v1/tiss/recursos/:id/itens/:itemId — remover glosa ────────
  r.delete('/v1/tiss/recursos/:id/itens/:itemId', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        itemId: z.string().uuid(),
      }),
      response: { 200: z.object({ removido: z.boolean() }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string; itemId: string };

    // Verificar que o recurso esta em rascunho
    const { rows: recRows } = await tx.query<{
      status: string; item_count: number; total_recursado_cents: string;
    }>(
      `SELECT status, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (recRows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (recRows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }

    // Remover o item e pegar dados para atualizar contadores
    const { rows: removidos } = await tx.query<{
      demonstrativo_item_id: string; valor_recursado_cents: string;
    }>(
      `DELETE FROM tiss.recurso_glosa_item
        WHERE id = $1 AND recurso_id = $2
        RETURNING demonstrativo_item_id, valor_recursado_cents::text`,
      [p.itemId, p.id]);

    if (removidos.length > 0) {
      const valorRemovido = Number(removidos[0]!.valor_recursado_cents);
      const newCount = Math.max(recRows[0]!.item_count - 1, 0);
      const newTotal = Math.max(
        Number(recRows[0]!.total_recursado_cents) - valorRemovido, 0);
      await tx.query(
        `UPDATE tiss.recurso_glosa
            SET item_count = $2, total_recursado_cents = $3
          WHERE id = $1`,
        [p.id, newCount, newTotal]);

      // Reverter aceite da glosa para pendente
      await tx.query(
        `UPDATE tiss.demonstrativo_item SET aceite = 'pendente'
          WHERE id = $1 AND aceite = 'em_recurso'`,
        [removidos[0]!.demonstrativo_item_id]);
    }

    return { removido: removidos.length > 0 };
  }));

  // ── POST /v1/tiss/recursos/:id/pronto — marcar recurso como pronto ────
  r.post('/v1/tiss/recursos/:id/pronto', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('pronto'),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; item_count: number;
    }>(
      `SELECT status, item_count FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'rascunho') {
      erroDominio('recurso_nao_rascunho', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    await tx.query(
      `UPDATE tiss.recurso_glosa SET status = 'pronto'
        WHERE id = $1`,
      [p.id]);

    return { recursoId: p.id, status: 'pronto' as const };
  }));

  // ── GET /v1/tiss/recursos — listar recursos ──────────────────────────
  r.get('/v1/tiss/recursos', {
    schema: {
      querystring: z.object({
        status: z.enum(['rascunho', 'pronto', 'enviado', 'resolvido']).optional(),
        operadoraId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(RecursoResumoSchema) }) },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const q = req.query as { status?: string; operadoraId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`rg.status = $${idx}`);
      params.push(q.status); idx += 1;
    }
    if (q.operadoraId !== undefined) {
      condicoes.push(`rg.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }

    const where = condicoes.length > 0
      ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.status, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
         ${where}
        ORDER BY rg.created_at DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        recursoId: row.id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        status: row.status,
        justificativaGeral: row.justificativa_geral,
        itemCount: row.item_count,
        totalRecursadoCents: Number(row.total_recursado_cents),
        createdAt: row.created_at,
        sentAt: row.sent_at,
      })),
    };
  }));

  // ── GET /v1/tiss/recursos/:id — detalhe do recurso com itens ──────────
  r.get('/v1/tiss/recursos/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: RecursoResumoSchema.extend({
          itens: z.array(RecursoItemSchema),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      status: string; justificativa_geral: string | null;
      item_count: number; total_recursado_cents: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT rg.id, rg.operadora_id, o.razao_social AS operadora_nome,
              rg.status, rg.justificativa_geral,
              rg.item_count, rg.total_recursado_cents::text,
              to_char(rg.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(rg.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.recurso_glosa rg
         JOIN tiss.operadora o
           ON o.tenant_id = rg.tenant_id AND o.id = rg.operadora_id
        WHERE rg.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    const rec = rows[0]!;

    const { rows: itemRows } = await tx.query<{
      id: string; demonstrativo_item_id: string;
      encounter_version_id: string; justificativa: string;
      valor_recursado_cents: string;
      resultado: string | null; valor_resultado_cents: string | null;
    }>(
      `SELECT id, demonstrativo_item_id, encounter_version_id,
              justificativa, valor_recursado_cents::text,
              resultado, valor_resultado_cents::text
         FROM tiss.recurso_glosa_item
        WHERE recurso_id = $1
        ORDER BY created_at`,
      [p.id]);

    return {
      recursoId: rec.id,
      operadoraId: rec.operadora_id,
      operadoraNome: rec.operadora_nome,
      status: rec.status,
      justificativaGeral: rec.justificativa_geral,
      itemCount: rec.item_count,
      totalRecursadoCents: Number(rec.total_recursado_cents),
      createdAt: rec.created_at,
      sentAt: rec.sent_at,
      itens: itemRows.map((i) => ({
        itemId: i.id,
        demonstrativoItemId: i.demonstrativo_item_id,
        encounterVersionId: i.encounter_version_id,
        justificativa: i.justificativa,
        valorRecursadoCents: Number(i.valor_recursado_cents),
        resultado: i.resultado,
        valorResultadoCents: i.valor_resultado_cents !== null
          ? Number(i.valor_resultado_cents) : null,
      })),
    };
  }));

  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  // Definido na Task 49
  // ── POST /v1/tiss/recursos/:id/resolver — resolver recurso ────────────
  // Definido na Task 49
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { recursoRoutes } from './routes/tiss/recursos';
```

E registrar apos `await app.register(glosaRoutes);`:

```ts
  await app.register(recursoRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: PASS — 9 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/recursos.ts apps/api/src/routes/tiss/recursos.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS recurso glosa CRUD routes

POST /v1/tiss/recursos (create), POST /:id/itens (add glosa),
DELETE /:id/itens/:itemId (remove), POST /:id/pronto (mark ready),
GET /v1/tiss/recursos (list), GET /:id (detail with items).
RBAC: tiss.recurso.manage. encounter_version_id required per sec 3.9.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 49: Rotas de envio e resolucao de recurso de glosa TISS

**Arquivos**
- Modificar: `apps/api/src/routes/tiss/recursos.ts` (adicionar rotas de enviar e resolver)
- Modificar: `apps/api/src/routes/tiss/recursos.int.test.ts` (adicionar testes)

**Passos**

- [ ] Adicionar os testes de envio e resolucao ao final do `describe` em `apps/api/src/routes/tiss/recursos.int.test.ts`, antes do fechamento do `describe`:

```ts
  // --- Testes de envio e resolucao (Task 49) ---

  it('POST /v1/tiss/recursos/:id/enviar dispara serializacao e transport', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('enviado');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/resolver resolve recurso com resultado', async () => {
    const app = await buildApp();

    // Buscar itens do recurso para obter os IDs
    const detR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    const det = detR.json() as {
      itens: Array<{ itemId: string; valorRecursadoCents: number }>;
    };
    expect(det.itens.length).toBe(2);

    const resultados = det.itens.map((item) => ({
      itemId: item.itemId,
      resultado: 'deferido' as const,
      valorResultadoCents: item.valorRecursadoCents,
    }));

    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/resolver`,
      ...auth(admin),
      payload: { resultados },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('resolvido');

    // Verificar que as glosas foram marcadas como recuperadas
    const glR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemIdA}`,
      ...auth(admin),
    });
    if (glR.statusCode === 200) {
      const gl = glR.json() as { aceite: string };
      expect(gl.aceite).toBe('recuperada');
    }

    await app.close();
  });

  it('recepcao recebe 403 ao tentar enviar recurso', async () => {
    // Criar novo recurso para testar envio
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: FAIL — rota /enviar e /resolver nao existem (404)
```

- [ ] Adicionar as rotas de enviar e resolver em `apps/api/src/routes/tiss/recursos.ts`. Substituir os comentarios placeholder pelo codigo completo. Antes do fechamento da funcao `recursoRoutes`, onde estao os comentarios `// Definido na Task 49`, inserir:

```ts
  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  r.post('/v1/tiss/recursos/:id/enviar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({}),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('enviado'),
        }),
      },
    },
  }, rota('tiss.recurso.send', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; operadora_id: string; item_count: number;
      total_recursado_cents: string;
    }>(
      `SELECT status, operadora_id, item_count, total_recursado_cents::text
         FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'pronto') {
      erroDominio('recurso_nao_pronto', 422);
    }
    if (rows[0]!.item_count === 0) {
      erroDominio('recurso_sem_itens', 422);
    }

    // Transicionar para enviado
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'enviado', sent_at = clock_timestamp()
        WHERE id = $1`,
      [p.id]);

    // Enfileirar no outbox para serializacao XML + transport
    await tx.query(
      `SELECT app.enqueue_outbox('tiss_recurso_send', $1::uuid,
               jsonb_build_object(
                 'recursoId', $2::text,
                 'operadoraId', $3::text,
                 'itemCount', $4::int,
                 'clinicId', $5::text))`,
      [p.id, p.id, rows[0]!.operadora_id,
       rows[0]!.item_count, ctx.actor.clinicId]);

    // Auditoria
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_SEND', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('item_count', $2::int,
                                 'total_recursado_cents', $3::text), $4)`,
      [p.id, rows[0]!.item_count,
       rows[0]!.total_recursado_cents, ctx.actor.clinicId]);

    return { recursoId: p.id, status: 'enviado' as const };
  }));

  // ── POST /v1/tiss/recursos/:id/resolver — resolver com resultado ──────
  r.post('/v1/tiss/recursos/:id/resolver', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        resultados: z.array(z.object({
          itemId: z.string().uuid(),
          resultado: z.enum(['deferido', 'indeferido', 'deferido_parcial']),
          valorResultadoCents: z.number().int().min(0),
        })).min(1),
      }),
      response: {
        200: z.object({
          recursoId: z.string().uuid(),
          status: z.literal('resolvido'),
        }),
      },
    },
  }, rota('tiss.recurso.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as {
      resultados: Array<{
        itemId: string;
        resultado: 'deferido' | 'indeferido' | 'deferido_parcial';
        valorResultadoCents: number;
      }>;
    };

    // Verificar que o recurso existe e esta enviado
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status FROM tiss.recurso_glosa
        WHERE id = $1 FOR UPDATE`,
      [p.id]);
    if (rows.length === 0) erroDominio('recurso_nao_encontrado', 404);
    if (rows[0]!.status !== 'enviado') {
      erroDominio('recurso_nao_enviado', 422);
    }

    // Atualizar cada item com o resultado
    for (const res of b.resultados) {
      const { rowCount } = await tx.query(
        `UPDATE tiss.recurso_glosa_item
            SET resultado = $2, valor_resultado_cents = $3
          WHERE id = $1 AND recurso_id = $4`,
        [res.itemId, res.resultado, res.valorResultadoCents, p.id]);
      if (rowCount === 0) {
        erroDominio('item_recurso_nao_encontrado', 404,
          { itemId: res.itemId });
      }

      // Se deferido (total ou parcial), marcar a glosa como recuperada
      if (res.resultado === 'deferido' || res.resultado === 'deferido_parcial') {
        await tx.query(
          `UPDATE tiss.demonstrativo_item
              SET aceite = 'recuperada'
            WHERE id = (
              SELECT demonstrativo_item_id
                FROM tiss.recurso_glosa_item
               WHERE id = $1)`,
          [res.itemId]);
      }
    }

    // Marcar recurso como resolvido
    await tx.query(
      `UPDATE tiss.recurso_glosa
          SET status = 'resolvido', resolved_at = clock_timestamp()
        WHERE id = $1`,
      [p.id]);

    // Auditoria
    const deferidos = b.resultados.filter(
      (r) => r.resultado === 'deferido' || r.resultado === 'deferido_parcial');
    await tx.query(
      `SELECT audit.log('TISS_RECURSO_RESOLVE', 'tiss', 'recurso_glosa', $1,
              'sucesso',
              jsonb_build_object('total_resultados', $2::int,
                                 'deferidos', $3::int), $4)`,
      [p.id, b.resultados.length, deferidos.length, ctx.actor.clinicId]);

    return { recursoId: p.id, status: 'resolvido' as const };
  }));
```

- [ ] Remover os comentarios placeholder de `recursos.ts`. Substituir:

```ts
  // ── POST /v1/tiss/recursos/:id/enviar — enviar recurso ────────────────
  // Definido na Task 49
  // ── POST /v1/tiss/recursos/:id/resolver — resolver recurso ────────────
  // Definido na Task 49
```

Por nada (as rotas completas ja foram adicionadas acima).

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/recursos.int.test.ts
# ESPERADO: PASS — 12 testes verdes (9 da Task 48 + 3 novos)
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/recursos.ts apps/api/src/routes/tiss/recursos.int.test.ts
git commit -m "feat(api): add TISS recurso send and resolve routes

POST /v1/tiss/recursos/:id/enviar (dispatch to outbox, mark enviado),
POST /v1/tiss/recursos/:id/resolver (apply results, mark recuperada
on deferred glosas). RBAC: tiss.recurso.send for send,
tiss.recurso.manage for resolve. Timeout never retries unsafe
operations (sec 7).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 50: Teste de isolamento multi-tenant para rotas TISS da Fase 5

**Arquivos**
- Criar: `apps/api/src/routes/tiss/fase5-isolation.int.test.ts`

**Passos**

- [ ] Escrever o teste de isolamento:

```ts
// apps/api/src/routes/tiss/fase5-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let a: SementeSessao;
let b: SementeSessao;
let operadoraIdA: string;
let demoIdA: string;
let glosaItemIdA: string;
let recursoIdA: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });

  // Semear dados completos no tenant A
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '339679', 'Op Iso5 A', '11111111000190', '3.05',
               'arquivo', $3)`,
      [a.tenantId, operadoraIdA, a.userId]);

    demoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo, tipo, data_emissao,
          total_informado_cents, total_processado_cents, total_glosa_cents,
          item_count, imported_by)
       VALUES ($1, $2, $3, 'PROTO-ISO', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               10000, 5000, 5000, 1, $4)`,
      [a.tenantId, demoIdA, operadoraIdA, a.userId]);

    glosaItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          codigo_procedimento, valor_informado_cents, valor_processado_cents,
          valor_glosa_cents, codigo_glosa, status, aceite)
       VALUES ($1, $2, $3, 'GP-ISO-001',
               '10101012', 10000, 5000, 5000, '1005',
               'glosado_parcial', 'pendente')`,
      [a.tenantId, glosaItemIdA, demoIdA]);

    recursoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.recurso_glosa
         (tenant_id, id, operadora_id, status, item_count,
          total_recursado_cents, created_by)
       VALUES ($1, $2, $3, 'rascunho', 0, 0, $4)`,
      [a.tenantId, recursoIdA, operadoraIdA, a.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('isolamento multi-tenant — rotas TISS Fase 5', () => {
  it('demonstrativos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ demonstrativoId: string }>;
    }).itens.map((i) => i.demonstrativoId);
    expect(ids).not.toContain(demoIdA);
    await app.close();
  });

  it('glosas do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ itemId: string }>;
    }).itens.map((i) => i.itemId);
    expect(ids).not.toContain(glosaItemIdA);
    await app.close();
  });

  it('recursos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ recursoId: string }>;
    }).itens.map((i) => i.recursoId);
    expect(ids).not.toContain(recursoIdA);
    await app.close();
  });

  it('detalhe de demonstrativo de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/demonstrativos/${demoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de glosa de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaItemIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de recurso de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos',
      cookies: {
        '__Host-cadencia_sid': a.token,
        '__Host-cadencia_csrf': a.csrf,
      },
      headers: {
        'x-clinic-id': b.clinicId,
        'x-csrf-token': a.csrf,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('toda resposta Fase 5 TISS tem cache-control: no-store', async () => {
    const app = await buildApp();
    const rotas = [
      { method: 'GET' as const, url: '/v1/tiss/demonstrativos' },
      { method: 'GET' as const, url: '/v1/tiss/glosas' },
      { method: 'GET' as const, url: '/v1/tiss/recursos' },
    ];

    for (const rota of rotas) {
      const r = await app.inject({ ...rota, ...auth(a) });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await app.close();
  });

  it('medico (profissional) nao acessa demonstrativos, glosas nem recursos', async () => {
    const medicoLocal = await semearSessao({ role: 'profissional' });
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(medicoLocal),
    });
    expect(r1.statusCode).toBe(403);

    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medicoLocal),
    });
    expect(r2.statusCode).toBe(403);

    const r3 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medicoLocal),
      payload: { operadoraId: operadoraIdA },
    });
    expect(r3.statusCode).toBe(403);

    await app.close();
  });

  it('recepcao le demonstrativos e glosas mas nao importa, aceita nem cria recurso', async () => {
    const recLocal = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();

    // Pode ler demonstrativos
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(recLocal),
    });
    expect(r1.statusCode).toBe(200);

    // Pode ler glosas
    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recLocal),
    });
    expect(r2.statusCode).toBe(200);

    // Nao pode aceitar glosa
    const r3 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaItemIdA}/aceitar`,
      ...auth(recLocal),
      payload: {},
    });
    expect(r3.statusCode).toBe(403);

    // Nao pode criar recurso
    const r4 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recLocal),
      payload: {
        operadoraId: operadoraIdA,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r4.statusCode).toBe(403);

    await app.close();
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/fase5-isolation.int.test.ts
# ESPERADO: PASS — 10 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/fase5-isolation.int.test.ts
git commit -m "test(api): add Fase 5 TISS multi-tenant isolation tests

Verify demonstrativos, glosas and recursos are isolated by tenant,
clinic header swap returns 403, no-store on all responses, and RBAC
denies profissional and limits recepcao to read-only.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
### Task 51: Migration 0128 — matview rpt.mv_glosas + refresh function

**Arquivos:**
- `packages/db/migrations/0128_rpt_mv_glosas.sql` (novo)

**Depende de:** tiss.glosa (definida por bloco anterior da Fase 5), tiss.encounter_guia_consulta (0115), clin.encounter (0030), rpt_owner com BYPASSRLS (0104), schema rpt (0002), rpt.refresh_log (0104).

- [ ] Criar o arquivo de migration `packages/db/migrations/0128_rpt_mv_glosas.sql` com o conteudo abaixo.

```sql
-- 0128_rpt_mv_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — matview de glosas aceitas para Desempenho.
-- Uma linha por glosa aceita (nao recuperada). Usada pelo Explorar e pela
-- decomposicao de variacao (ss5.5 fator "glosas nao recuperadas").
--
-- Propriedade de rpt_owner, SEM GRANT para app_rw (regra ss3.8).

-- ---------------------------------------------------------------------------
-- 1. GRANT USAGE no schema tiss para rpt_owner. Necessario para que a
--    matview (pertencente a rpt_owner, que tem BYPASSRLS) consiga ler as
--    tabelas-fonte no schema tiss. As migrations 0115, 0116 e 0120 ja
--    concedem SELECT tabela a tabela, mas faltava USAGE no schema.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA tiss TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 2. GRANT SELECT na tabela-fonte de glosas para rpt_owner.
--    A tabela tiss.glosa e criada por bloco anterior da Fase 5.
-- ---------------------------------------------------------------------------
GRANT SELECT ON tiss.glosa TO rpt_owner;

-- ---------------------------------------------------------------------------
-- 3. Matview: uma linha por glosa aceita (status = 'aceita').
--    Campos de dimensao: data_atendimento (periodo), operadora_id,
--    professional_id, clinic_id. Campo de medida: valor_glosado_cents.
-- ---------------------------------------------------------------------------
SET ROLE rpt_owner;

CREATE MATERIALIZED VIEW rpt.mv_glosas AS
SELECT
  rg.id                         AS glosa_id,
  rg.valor_glosado_cents,
  gc.data_atendimento,
  gc.operadora_id,
  enc.professional_id,
  enc.clinic_id,
  rg.created_at                 AS glosa_created_at,
  rg.tenant_id
FROM tiss.glosa rg
JOIN tiss.encounter_guia_consulta gc
  ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
JOIN clin.encounter enc
  ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
WHERE rg.status = 'aceita'
WITH NO DATA;

CREATE UNIQUE INDEX ux_mv_glosas
  ON rpt.mv_glosas (tenant_id, glosa_id);
CREATE INDEX ix_mv_glosas_data
  ON rpt.mv_glosas (tenant_id, clinic_id, data_atendimento DESC);

-- ---------------------------------------------------------------------------
-- 4. Funcao de refresh (mesmo padrao de 0107_rpt_refresh_functions.sql).
-- ---------------------------------------------------------------------------
CREATE FUNCTION rpt.refresh_mv_glosas() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = rpt, pg_catalog AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_count bigint;
BEGIN
  IF rpt.is_populated('mv_glosas') THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY rpt.mv_glosas;
  ELSE
    REFRESH MATERIALIZED VIEW rpt.mv_glosas;
  END IF;

  SELECT count(*) INTO v_count FROM rpt.mv_glosas;

  INSERT INTO rpt.refresh_log (matview_name, started_at, finished_at, row_count, success)
  VALUES ('mv_glosas', v_start, clock_timestamp(), v_count, true);
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. GRANTs de execucao para o worker (papel jobs).
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION rpt.refresh_mv_glosas() TO jobs;
```

- [ ] Rodar a migration e verificar que aplica sem erro:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: termina em `0128_rpt_mv_glosas.sql` sem erro.

- [ ] Verificar que o invariant de CI (sem GRANT de matview para app_rw) continua passando:

```bash
pnpm db:invariants
```

Saida esperada: todos OK.

- [ ] Commitar:

```bash
git add packages/db/migrations/0128_rpt_mv_glosas.sql
git commit -m "feat(db): add matview rpt.mv_glosas for accepted glosa aggregation

Migration 0128: materialized view with one row per accepted glosa,
refresh function for worker, and GRANT USAGE ON SCHEMA tiss to rpt_owner.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 52: Migration 0129 — app_rpt.glosas security_barrier view

**Arquivos:**
- `packages/db/migrations/0129_app_rpt_glosas.sql` (novo)
- `packages/db/privileges.json` (editar — adicionar entrada para app_rpt.glosas)

**Depende de:** rpt.mv_glosas (0128), app_rpt schema (0104), app.current_tenant_id() e app.is_member() (0002/0003).

- [ ] Criar o arquivo de migration `packages/db/migrations/0129_app_rpt_glosas.sql` com o conteudo abaixo.

```sql
-- 0129_app_rpt_glosas.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5, bloco 09 — view security_barrier em app_rpt para expor dados de
-- glosa ao modulo reports. Segue o padrao de 0108_app_rpt_barrier_views.sql:
-- rpt_owner e dono, app_rw le, matview nunca recebe GRANT direto.

SET ROLE rpt_owner;

-- ---------------------------------------------------------------------------
-- app_rpt.glosas — dado financeiro de glosa, sem restricao de escopo clinico.
-- Inclui data_atendimento para filtragem por periodo na variacao.
-- ---------------------------------------------------------------------------
CREATE VIEW app_rpt.glosas WITH (security_barrier = true) AS
  SELECT m.glosa_id, m.valor_glosado_cents, m.data_atendimento,
         m.operadora_id, m.professional_id, m.clinic_id,
         m.glosa_created_at
    FROM rpt.mv_glosas m
   WHERE m.tenant_id = app.current_tenant_id()
     AND app.is_member();

RESET ROLE;

-- ---------------------------------------------------------------------------
-- GRANT: app_rw le a view, nunca a matview diretamente.
-- ---------------------------------------------------------------------------
GRANT SELECT ON app_rpt.glosas TO app_rw;
```

- [ ] Adicionar a entrada `app_rpt.glosas` em `packages/db/privileges.json`. Localizar o final do objeto JSON e adicionar:

```jsonc
// Em packages/db/privileges.json, adicionar a entrada:
  "app_rpt.glosas": {
    "view": {
      "app_rw": ["SELECT"]
    }
  }
```

- [ ] Rodar a migration e verificar que aplica sem erro:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm db:migrate
```

Saida esperada: termina em `0129_app_rpt_glosas.sql` sem erro.

- [ ] Verificar invariantes:

```bash
pnpm db:invariants
```

Saida esperada: todos OK. Nenhum GRANT de matview para app_rw.

- [ ] Commitar:

```bash
git add packages/db/migrations/0129_app_rpt_glosas.sql packages/db/privileges.json
git commit -m "feat(db): add security_barrier view app_rpt.glosas

Migration 0129: exposes rpt.mv_glosas through app_rpt.glosas with
tenant isolation via security_barrier predicate.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 53: Test helper para glosas e teste que falha — glosas no periodo A

**Arquivos:**
- `packages/reports/src/test-support.ts` (editar — adicionar `criarOperadora` e `criarGlosaAceita`)
- `packages/reports/src/compute-variation.int.test.ts` (editar — adicionar bloco de testes de glosa)

**Depende de:** tiss.operadora (0110), tiss.encounter_guia_consulta (0115), tiss.glosa (bloco anterior Fase 5), clin.encounter (0030), clin.encounter_version (0033), semearVariacao (test-support.ts).

- [ ] Adicionar `operadoraId` a `SementeVariacao` e os helpers `criarOperadora` e `criarGlosaAceita` em `packages/reports/src/test-support.ts`. Ao final do arquivo, antes da ultima linha em branco, acrescentar:

```typescript
// No topo do arquivo, junto aos outros imports, nao e necessario adicionar nada:
// uuidv7 ja esta importado.

// Adicionar campo ao SementeVariacao:
// Editar a interface SementeVariacao adicionando:
//   operadoraId: string;
// e no corpo de semearVariacao, gerar o id e inserir a operadora.
```

Editar a interface `SementeVariacao` adicionando o campo `operadoraId`:

```typescript
export interface SementeVariacao {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalIdA: string;
  professionalIdB: string;
  patientIds: string[];
  procedureIdConsulta: string;
  procedureIdRetorno: string;
  paymentMethodId: string;
  categoryId: string;
  operadoraId: string;
}
```

Editar a funcao `semearVariacao` para gerar o `operadoraId` e inserir a operadora. No corpo do objeto `s`, adicionar `operadoraId: uuidv7()`. Dentro do bloco `try`, apos a insercao de `fin.category`, adicionar:

```typescript
    // Operadora (para testes de glosa)
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '123456', 'Operadora Var', '11ABC22301DE44',
               '4.01', 'arquivo', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
```

Ao final do arquivo, antes da linha em branco final, adicionar a funcao `criarGlosaAceita`:

```typescript
/**
 * Cria um encounter finalizado, uma guia de consulta e uma glosa aceita.
 * Retorna os IDs criados para verificacao no teste.
 */
export async function criarGlosaAceita(opts: {
  tenantId: string;
  clinicId: string;
  patientId: string;
  professionalId: string;
  userId: string;
  operadoraId: string;
  valorGlosadoCents: number;
  dataAtendimento: string; // 'YYYY-MM-DD'
}): Promise<{ encounterId: string; guiaId: string; glosaId: string }> {
  const encounterId = uuidv7();
  const versionId = uuidv7();
  const guiaId = uuidv7();
  const glosaId = uuidv7();
  const guiaNumero = `G${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // 1. Encounter finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status, version_count)
       VALUES ($1, $2, $3, $4, $5,
               ($6::date)::timestamptz, $6::date, 'finalizado', 1)`,
      [opts.tenantId, encounterId, opts.patientId, opts.professionalId,
       opts.clinicId, opts.dataAtendimento]);

    // 2. Encounter version (original)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id, finalized_at,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original',
               $4, $5, clock_timestamp(),
               decode(lpad('', 64, 'ab'), 'hex'), 'test-v1')`,
      [opts.tenantId, versionId, encounterId, opts.userId,
       opts.professionalId]);

    // Atualizar head_version_id do encounter
    await c.query(
      `UPDATE clin.encounter
          SET head_version_id = $2
        WHERE tenant_id = $1 AND id = $3`,
      [opts.tenantId, versionId, encounterId]);

    // 3. Guia de consulta
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira,
          atendimento_rn, cnpj_contratado, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento,
          valor_procedimento, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               '123456', $6, 'CART001',
               false, '11ABC22301DE44', '1112233',
               '06', '111111', 'SP', '225125',
               '9', '01', $7::date,
               '1', '22', '10101012',
               ($8::numeric / 100.0), $9, 'completa')`,
      [opts.tenantId, guiaId, encounterId, versionId, opts.operadoraId,
       guiaNumero, opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);

    // 4. Lote + demonstrativo + demonstrativo_item (pre-requisitos para tiss.glosa)
    const loteId = uuidv7();
    const demoId = uuidv7();
    const demoItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, xml_storage_key, xml_hash_md5,
          protocolo_operadora, sent_at, created_by)
       VALUES ($1, $2, $5, '1', 'retornado', '4.01', 1, $8,
               'lote/glosa-var.xml', 'aabb00112233445566778899aabbccdd',
               'PROT-VAR', clock_timestamp(), $9)`,
      [opts.tenantId, loteId, null, null, opts.operadoraId,
       null, null, opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
       VALUES ($1, $2, $3, 1)`,
      [opts.tenantId, loteId, guiaId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, lote_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, $4, 'PROT-VAR', 'analise',
               $5::date, 'demo/glosa-var.xml',
               $6, 0, 0, $6, $7)`,
      [opts.tenantId, demoId, opts.operadoraId, loteId,
       opts.dataAtendimento, opts.valorGlosadoCents, opts.userId]);
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'M001', 'Glosa de teste')`,
      [opts.tenantId, demoItemId, demoId, guiaId, guiaNumero, opts.valorGlosadoCents]);

    // 5. Glosa aceita (todas as colunas NOT NULL preenchidas)
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id, encounter_version_id,
          codigo_glosa, descricao_glosa, valor_glosado_cents,
          status, resolved_at, resolved_by)
       VALUES ($1, $2, $3, $4, $5,
               'M001', 'Glosa de teste', $6,
               'aceita', clock_timestamp(), $7)`,
      [opts.tenantId, glosaId, demoItemId, guiaId, versionId,
       opts.valorGlosadoCents, opts.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return { encounterId, guiaId, glosaId };
}
```

- [ ] Adicionar o bloco de testes de glosa em `packages/reports/src/compute-variation.int.test.ts`. Ao final do arquivo, antes do ultimo `});` que fecha o `describe('computeVariation')`, adicionar:

```typescript
  describe('fator de glosas nao recuperadas', () => {
    let sGlosa: SementeVariacao;
    let poolGlosa: Pool;

    beforeAll(async () => {
      sGlosa = await semearVariacao();
      poolGlosa = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 2,
      });
      poolGlosa.on('connect', (client) => {
        void client.query('SET ROLE app_rw').catch(() => undefined);
      });

      // Periodo A (junho 2026): 3 consultas pagas + 1 glosa aceita de R$200
      for (let i = 0; i < 3; i++) {
        await criarAtendimentoComLancamento({
          tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
          patientId: sGlosa.patientIds[i]!,
          professionalId: sGlosa.professionalIdA,
          procedureId: sGlosa.procedureIdConsulta,
          userId: sGlosa.userId, paymentMethodId: sGlosa.paymentMethodId,
          categoryId: sGlosa.categoryId,
          amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
          status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
        });
      }
      await criarGlosaAceita({
        tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
        patientId: sGlosa.patientIds[3]!,
        professionalId: sGlosa.professionalIdA,
        userId: sGlosa.userId, operadoraId: sGlosa.operadoraId,
        valorGlosadoCents: 20000, dataAtendimento: '2026-06-15',
      });

      // Periodo B (julho 2026): 3 consultas pagas, sem glosas
      for (let i = 0; i < 3; i++) {
        await criarAtendimentoComLancamento({
          tenantId: sGlosa.tenantId, clinicId: sGlosa.clinicId,
          patientId: sGlosa.patientIds[i]!,
          professionalId: sGlosa.professionalIdA,
          procedureId: sGlosa.procedureIdConsulta,
          userId: sGlosa.userId, paymentMethodId: sGlosa.paymentMethodId,
          categoryId: sGlosa.categoryId,
          amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
          status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
        });
      }
    });

    afterAll(async () => {
      await poolGlosa.end();
    });

    it('glosas no periodo A e nenhuma no B → fator positivo (glosas reduziram)', async () => {
      const actor: Actor = {
        kind: 'user', tenantId: sGlosa.tenantId, userId: sGlosa.userId,
        clinicId: sGlosa.clinicId, requestId: 'test-glosa-1',
      };
      const result = await withTenantTx(actor, async (tx) => {
        return computeVariation(tx, sGlosa.tenantId, sGlosa.clinicId,
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, poolGlosa);

      // Glosas: A teve R$200 aceita, B teve R$0
      // Fator = -(0 - 20000) = +20000 (reducao de glosas e positivo)
      expect(result.factors.glosas_cents).toBe(20000);
      // Propriedade matematica ainda vale
      expect(factorsAddUp(result.factors)).toBe(true);
    });
  });
```

- [ ] Atualizar o import no topo de `compute-variation.int.test.ts` para incluir `criarGlosaAceita`:

```typescript
import {
  semearVariacao, criarAtendimentoComLancamento, criarGlosaAceita,
  type SementeVariacao,
} from './test-support';
```

- [ ] Rodar o teste e confirmar que FALHA (glosas_cents retorna 0, esperava 20000):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: o teste `glosas no periodo A e nenhuma no B` FALHA com `expected 20000, received 0`.

- [ ] Commitar o teste que falha:

```bash
git add packages/reports/src/test-support.ts packages/reports/src/compute-variation.int.test.ts
git commit -m "test(reports): add failing test for glosas factor in variation decomposition

Adds criarGlosaAceita helper and test scenario: accepted glosas in period A,
none in period B. Test expects positive glosas_cents but currently gets 0.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 54: Implementar consulta de glosas em compute-variation.ts

**Arquivos:**
- `packages/reports/src/compute-variation.ts` (editar)

**Depende de:** tiss.glosa (bloco anterior Fase 5), tiss.encounter_guia_consulta (0115), clin.encounter (0030), Task 53 (teste que falha).

- [ ] Em `packages/reports/src/compute-variation.ts`, substituir o comentario e a linha `const glosasCents = 0;` pela consulta real de glosas aceitas. Localizar o bloco:

```typescript
  // Glosas: zero ate Fase 4 (TISS)
  const glosasCents = 0;
```

e substituir por:

```typescript
  // -----------------------------------------------------------------------
  // 5b. Glosas nao recuperadas (aceitas) por periodo
  // -----------------------------------------------------------------------
  const glosas = await tx.query<{
    periodo: string; total_glosado_cents: string;
  }>(
    `SELECT 'A' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $3::date
        AND gc.data_atendimento <= $4::date
        AND rg.status = 'aceita'
     UNION ALL
     SELECT 'B' AS periodo,
            coalesce(sum(rg.valor_glosado_cents), 0)::text AS total_glosado_cents
       FROM tiss.glosa rg
       JOIN tiss.encounter_guia_consulta gc
         ON gc.tenant_id = rg.tenant_id AND gc.id = rg.guia_id
       JOIN clin.encounter enc
         ON enc.tenant_id = gc.tenant_id AND enc.id = gc.encounter_id
      WHERE rg.tenant_id = $1
        AND enc.clinic_id = $2
        AND gc.data_atendimento >= $5::date
        AND gc.data_atendimento <= $6::date
        AND rg.status = 'aceita'`,
    [tenantId, clinicId,
     periodA.start, periodA.end,
     periodB.start, periodB.end],
  );

  let glosasACents = 0;
  let glosasBCents = 0;
  for (const row of glosas.rows) {
    if (row.periodo === 'A') {
      glosasACents = Number(row.total_glosado_cents);
    } else {
      glosasBCents = Number(row.total_glosado_cents);
    }
  }

  // Glosas: receita perdida por glosas aceitas (nao recuperadas).
  // Mais glosas em B do que em A = fator negativo (perda).
  // Menos glosas em B do que em A = fator positivo (recuperacao).
  const glosasCents = -(glosasBCents - glosasACents);
```

- [ ] Atualizar o comentario do docblock no topo da funcao. Substituir:

```typescript
 * 6. Glosas: zero ate a Fase 4 (TISS).
```

por:

```typescript
 * 6. Glosas: valor de glosas aceitas (nao recuperadas) por periodo,
 *    consultando tiss.glosa via encounter_guia_consulta.
```

- [ ] Rodar os testes e confirmar que TODOS passam (inclusive o novo da Task 53 e os antigos):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: todos os testes passam. O teste `glosas sao zero (TISS nao implementado)` continua passando porque naquele cenario nao ha dados de glosa (a query retorna 0 para ambos os periodos). O teste novo `glosas no periodo A e nenhuma no B` agora passa com `glosas_cents === 20000`.

- [ ] Commitar:

```bash
git add packages/reports/src/compute-variation.ts
git commit -m "feat(reports): implement glosas factor in variation decomposition

Replaces hardcoded glosas_cents=0 with live query against
tiss.glosa joined with encounter_guia_consulta.
Factor is negative when accepted glosas increase, positive when they decrease.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 55: Teste de cenario inverso — glosas no periodo B geram fator negativo

**Arquivos:**
- `packages/reports/src/compute-variation.int.test.ts` (editar — adicionar segundo cenario)

**Depende de:** Task 54 (implementacao funcional).

- [ ] Adicionar um segundo cenario dentro do `describe('fator de glosas nao recuperadas')` em `packages/reports/src/compute-variation.int.test.ts`. Apos o `it('glosas no periodo A...')` e antes do `});` que fecha o `describe('fator de glosas nao recuperadas')`, adicionar:

```typescript
    it('glosas no periodo B e nenhuma no A → fator negativo (glosas aumentaram)', async () => {
      // Cenario: usar tenant separado para isolamento
      const sInv = await semearVariacao();
      const poolInv = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 2,
      });
      poolInv.on('connect', (client) => {
        void client.query('SET ROLE app_rw').catch(() => undefined);
      });

      try {
        // Periodo A (junho 2026): 3 consultas pagas, sem glosas
        for (let i = 0; i < 3; i++) {
          await criarAtendimentoComLancamento({
            tenantId: sInv.tenantId, clinicId: sInv.clinicId,
            patientId: sInv.patientIds[i]!,
            professionalId: sInv.professionalIdA,
            procedureId: sInv.procedureIdConsulta,
            userId: sInv.userId, paymentMethodId: sInv.paymentMethodId,
            categoryId: sInv.categoryId,
            amountCents: 25000, date: `2026-06-${String(10 + i).padStart(2, '0')}`,
            status: 'atendido', operadoraNome: null, pago: true,
          });
        }

        // Periodo B (julho 2026): 3 consultas pagas + 1 glosa aceita de R$150
        for (let i = 0; i < 3; i++) {
          await criarAtendimentoComLancamento({
            tenantId: sInv.tenantId, clinicId: sInv.clinicId,
            patientId: sInv.patientIds[i]!,
            professionalId: sInv.professionalIdA,
            procedureId: sInv.procedureIdConsulta,
            userId: sInv.userId, paymentMethodId: sInv.paymentMethodId,
            categoryId: sInv.categoryId,
            amountCents: 25000, date: `2026-07-${String(10 + i).padStart(2, '0')}`,
            status: 'atendido', operadoraNome: 'Operadora Var', pago: true,
          });
        }
        await criarGlosaAceita({
          tenantId: sInv.tenantId, clinicId: sInv.clinicId,
          patientId: sInv.patientIds[4]!,
          professionalId: sInv.professionalIdA,
          userId: sInv.userId, operadoraId: sInv.operadoraId,
          valorGlosadoCents: 15000, dataAtendimento: '2026-07-20',
        });

        const actor: Actor = {
          kind: 'user', tenantId: sInv.tenantId, userId: sInv.userId,
          clinicId: sInv.clinicId, requestId: 'test-glosa-inv-1',
        };
        const result = await withTenantTx(actor, async (tx) => {
          return computeVariation(tx, sInv.tenantId, sInv.clinicId,
            { start: '2026-06-01', end: '2026-06-30' },
            { start: '2026-07-01', end: '2026-07-31' },
          );
        }, poolInv);

        // Glosas: A teve R$0, B teve R$150 aceita
        // Fator = -(15000 - 0) = -15000 (aumento de glosas e negativo)
        expect(result.factors.glosas_cents).toBe(-15000);
        // Propriedade matematica: soma dos fatores = delta
        expect(factorsAddUp(result.factors)).toBe(true);
        // O fator "glosas nao recuperadas" esta destacado (nao absorvido pelo ticket)
        expect(result.factors.glosas_cents).not.toBe(0);
      } finally {
        await poolInv.end();
      }
    });

    it('sem glosas em nenhum periodo → fator continua zero', async () => {
      // Reutiliza o dataset original (s) que nao tem glosas
      const actor: Actor = {
        kind: 'user', tenantId: s.tenantId, userId: s.userId,
        clinicId: s.clinicId, requestId: 'test-glosa-zero',
      };
      const result = await withTenantTx(actor, async (tx) => {
        return computeVariation(tx, s.tenantId, s.clinicId,
          { start: '2026-06-01', end: '2026-06-30' },
          { start: '2026-07-01', end: '2026-07-31' },
        );
      }, pool);

      expect(result.factors.glosas_cents).toBe(0);
      expect(factorsAddUp(result.factors)).toBe(true);
    });
```

- [ ] Rodar todos os testes do arquivo e confirmar que TODOS passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run packages/reports/src/compute-variation.int.test.ts
```

Saida esperada: todos os 7 testes passam (4 antigos + 3 novos):
1. `soma dos fatores iguala delta total` — passa
2. `fator de faltas reflete aumento` — passa
3. `glosas sao zero (TISS nao implementado)` — passa (dataset sem glosas)
4. `periodos sem dados retornam delta zero` — passa
5. `glosas no periodo A e nenhuma no B → fator positivo` — passa
6. `glosas no periodo B e nenhuma no A → fator negativo` — passa
7. `sem glosas em nenhum periodo → fator continua zero` — passa

- [ ] Commitar:

```bash
git add packages/reports/src/compute-variation.int.test.ts
git commit -m "test(reports): add inverse and zero glosa scenarios for variation

Verifies that accepted glosas in period B produce negative factor,
and that absence of glosas in both periods keeps the factor at zero.
Additive property holds in all scenarios.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
### Task 56: invariante 1 cobre as 5 novas tabelas TISS da Fase 5

**Arquivos**

- Modificar `packages/db/src/invariants/inv01-rls.int.test.ts`

**Passos**

- [ ] Adicionar testes que verificam que as 5 novas tabelas do schema tiss criadas na Fase 5 (demonstrativo, demonstrativo_item, glosa, recurso_glosa, recurso_glosa_item) sao descobertas pelo invariante 1 e passam todas as verificacoes de RLS.

```ts
// packages/db/src/invariants/inv01-rls.int.test.ts
// Adicionar ao final do describe existente, ANTES do fechamento '});'

  it('as 5 tabelas da Fase 5 em tiss existem e passam o invariante de RLS', async () => {
    const relacoes = await readRelations(catalogPool());
    const tissFase5 = [
      'demonstrativo',
      'demonstrativo_item',
      'glosa',
      'recurso_glosa',
      'recurso_glosa_item',
    ];
    for (const tabela of tissFase5) {
      const rel = relacoes.find((r) => r.schema === 'tiss' && r.relation === tabela);
      expect(rel, `tiss.${tabela} nao encontrada — a migration da Fase 5 nao foi aplicada`).toBeDefined();
      expect(rel!.hasDiscriminator, `tiss.${tabela} sem coluna tenant_id`).toBe(true);
      expect(rel!.rlsEnabled, `tiss.${tabela} com RLS desabilitada`).toBe(true);
      expect(rel!.rlsForced, `tiss.${tabela} com RLS nao forcada`).toBe(true);
      expect(rel!.policies, `tiss.${tabela} sem nenhuma policy`).toBeGreaterThanOrEqual(1);
    }
  });

  it('nenhuma das 5 tabelas da Fase 5 aparece nas violacoes de RLS', async () => {
    const relacoes = await readRelations(catalogPool());
    const violacoes = rlsViolations(relacoes);
    const tissFase5 = [
      'tiss.demonstrativo',
      'tiss.demonstrativo_item',
      'tiss.glosa',
      'tiss.recurso_glosa',
      'tiss.recurso_glosa_item',
    ];
    for (const tabela of tissFase5) {
      const violacao = violacoes.find((v) => v.startsWith(tabela));
      expect(violacao, `violacao encontrada para ${tabela}: ${violacao}`).toBeUndefined();
    }
  });
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv01-rls.int.test.ts` e confirmar que os novos testes passam (as tabelas foram criadas pelos blocos 01 e 03 da Fase 5).

Saida esperada: todos os testes passando, incluindo os 2 novos.

- [ ] Commitar: `test(db): assert Fase 5 tiss tables pass RLS invariant`

---

### Task 57: invariante 8 reprova relogio no schema tiss incluindo novas queries da Fase 5

**Arquivos**

- Modificar `packages/db/src/invariants/inv08-ddl-lint.int.test.ts`

**Passos**

- [ ] Adicionar testes que verificam que o invariante 8 continua limpo apos a Fase 5 (nenhum now()/current_date no schema tiss, incluindo as novas funcoes/defaults/views do demonstrativo, glosa e recurso).

```ts
// packages/db/src/invariants/inv08-ddl-lint.int.test.ts
// Adicionar ao final do describe existente, ANTES do fechamento '});'

  it('nenhuma violacao de relogio no schema tiss apos a Fase 5 — demonstrativo, glosa e recurso nao usam now()', async () => {
    const violacoes = await ddlLintViolations(catalogPool());
    const tissClock = violacoes.filter((v) => v.includes('tiss.') && v.includes('le o relogio'));
    expect(tissClock, `violacoes de relogio no schema tiss: ${tissClock.join('; ')}`).toEqual([]);
  });

  it('nenhuma violacao de DDL lint no schema inteiro apos a Fase 5', async () => {
    const violacoes = await ddlLintViolations(catalogPool());
    expect(violacoes).toEqual([]);
  });

  it('reprova default now() em tabela demonstrativo — clock_timestamp() e a fonte correta', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE tiss.__demo_com_now (
        tenant_id uuid NOT NULL, id uuid NOT NULL,
        importado_em timestamptz NOT NULL DEFAULT now())`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__demo_com_now.importado_em (default): le o relogio dentro do schema tiss');
  });

  it('reprova funcao que usa current_date dentro de tiss para calcular prazo de recurso', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION tiss.__prazo_recurso() RETURNS date
                     LANGUAGE sql STABLE AS $fn$ SELECT current_date + 30 $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__prazo_recurso (function): le o relogio dentro do schema tiss');
  });
```

- [ ] Rodar `pnpm vitest run packages/db/src/invariants/inv08-ddl-lint.int.test.ts` e confirmar que todos os testes passam.

Saida esperada: todos os testes passando, incluindo os 4 novos.

- [ ] Commitar: `test(db): assert Fase 5 tiss DDL passes clock lint invariant`

---

### Task 58: atualizar invariante de registry para aceitar tiss-soap apos Fase 5

**Arquivos**

- Modificar `packages/tiss/src/transport/registry-invariant.test.ts`

**Passos**

- [ ] Atualizar o teste de invariante do registry para refletir o estado pos-Fase 5: `tiss-arquivo` e `tiss-soap` sao os dois transports registrados. O bloco 06 da Fase 5 adicionou `tiss-soap` ao registry condicionalmente. O invariante agora ACEITA ambos.

```ts
// packages/tiss/src/transport/registry-invariant.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('invariante CI — tiss-soap existe a partir da Fase 5 (§7.5)', () => {
  it('o diretorio packages/tiss/src/transport/tiss-soap/ existe no repositorio', () => {
    const soapDir = resolve(import.meta.dirname, 'tiss-soap');
    expect(existsSync(soapDir)).toBe(true);
  });

  it('o registry exporta tiss-arquivo e tiss-soap como transports disponiveis', async () => {
    const { getTransportIds, getTransportFactory } = await import('./registry');
    const ids = getTransportIds();
    expect(ids).toContain('tiss-arquivo');
    expect(ids).toContain('tiss-soap');
    expect(ids).toHaveLength(2);
    expect(getTransportFactory('tiss-arquivo')).toBeDefined();
    expect(getTransportFactory('tiss-soap')).toBeDefined();
  });

  it('nenhum transport fantasma no registry — so tiss-arquivo e tiss-soap', async () => {
    const { getTransportIds } = await import('./registry');
    const ids = getTransportIds();
    for (const id of ids) {
      expect(['tiss-arquivo', 'tiss-soap']).toContain(id);
    }
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/transport/registry-invariant.test.ts` e confirmar que todos os 3 testes passam.

Saida esperada: 3 testes passando.

- [ ] Commitar: `test(tiss): update registry invariant to accept tiss-soap after Fase 5`

---

### Task 59: demonstracao end-to-end Fase 5 — do encounter ao recurso de glosa deferido

**Arquivos**

- Criar `packages/tiss/src/fase5-e2e.int.test.ts`

**Passos**

- [ ] Escrever o teste de integracao end-to-end que percorre o ciclo completo da Fase 5: tenant → operadora → contrato → paciente → convenio → encounter finalizado → guia projetada → lote criado → lote enviado → demonstrativo importado com glosa parcial → glosa verificada → recurso de glosa criado → recurso marcado pronto → recurso submetido (fake transport) → recurso resolvido como deferido → glosa revertida e valor recuperado.

```ts
// packages/tiss/src/fase5-e2e.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import { createLote } from './create-lote';
import { addGuiaToLote } from './lote-guias';
import { markLoteReady, markLoteSent } from './lote-lifecycle';
import { importDemonstrativo } from './demonstrativo/import-demonstrativo';
import { createRecursoGlosa } from './recurso-glosa/create-recurso-glosa';
import { addGlosaToRecurso } from './recurso-glosa/add-glosa-to-recurso';
import { markRecursoReady } from './recurso-glosa/mark-recurso-ready';
import { submitRecurso } from './recurso-glosa/submit-recurso';
import { resolveRecurso } from './recurso-glosa/resolve-recurso';
import { createFakeTissArquivoTransport } from './transport/tiss-arquivo-fake';

interface SementeE2E {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  encounterId: string;
  versionId: string;
  encounterBillingId: string;
  operadoraId: string;
  contratoId: string;
  pacienteConvenioId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

/**
 * Semeia o grafo completo para o teste end-to-end da Fase 5:
 * tenant → clinica → usuario → profissional → paciente → operadora →
 * contrato → paciente_convenio → encounter finalizado com billing de convenio →
 * encounter_version → termo TUSS vigente.
 */
async function semearFase5E2E(): Promise<SementeE2E> {
  const s: SementeE2E = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    encounterId: uuidv7(),
    versionId: uuidv7(),
    encounterBillingId: uuidv7(),
    operadoraId: uuidv7(),
    contratoId: uuidv7(),
    pacienteConvenioId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // Tenant
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica E2E Fase5', '50ABC60770DE80')`,
      [s.tenantId, `e2e5-${s.tenantId}`],
    );

    // Clinica
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES ($1, $2, 'Unidade E2E F5', '50ABC60770DE80', '5506677', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );

    // Usuario
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Dr. E2E Fase5')`,
      [s.userId, `${s.userId}@e2e.test`],
    );

    // Membership
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );

    // Profissional
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '550667', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );

    // Paciente
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1, $2, 'Maria E2E Fase5', 'completo', '1985-03-15')`,
      [s.tenantId, s.patientId],
    );

    // Operadora
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, cnpj, razao_social, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', '28E2E456000199', 'Operadora E2E', '4.01.00', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // Contrato
    await c.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora, vigencia_inicio, created_by)
       VALUES ($1, $2, $3, $4, 'E2E001', DATE '2025-01-01', $5)`,
      [s.tenantId, s.contratoId, s.operadoraId, s.clinicId, s.userId],
    );

    // Paciente convenio
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, validade, created_by)
       VALUES ($1, $2, $3, $4, '5500667788990011', '2028-12-31', $5)`,
      [s.tenantId, s.pacienteConvenioId, s.patientId, s.operadoraId, s.userId],
    );

    // Encounter finalizado
    await c.query(
      `INSERT INTO clin.encounter
         (tenant_id, id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, status)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(),
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               'finalizado'::clin.encounter_status)`,
      [s.tenantId, s.encounterId, s.patientId, s.professionalId, s.clinicId],
    );

    // Encounter version (original)
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('e2e-fase5-v1'::bytea), 'jcs-1')`,
      [s.tenantId, s.versionId, s.encounterId, s.userId, s.professionalId],
    );

    // Atualizar head_version_id
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1
        WHERE id = $2`,
      [s.versionId, s.encounterId],
    );

    // Encounter billing com convenio
    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans,
          numero_carteira, atendimento_rn, codigo_prestador_na_operadora, cnes,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos, created_by)
       VALUES ($1, $2, $3,
               'Operadora E2E', '326305', '5500667788990011',
               false, 'E2E001', '5506677',
               '06', '550667', 'SP', '225125',
               '9', '01', '1',
               app.local_date(clock_timestamp(), 'America/Sao_Paulo'),
               '22', '10101012', 15000, $4)`,
      [s.tenantId, s.encounterBillingId, s.encounterId, s.userId],
    );

    // Termo TUSS vigente
    await c.query(
      `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
       VALUES (22, '10101012', 'Consulta em consultorio', '[2020-01-01,)', '202001', 'inclusao')
       ON CONFLICT DO NOTHING`,
    );

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

describe('demonstracao end-to-end Fase 5 — do encounter ao recurso de glosa deferido', () => {
  let s: SementeE2E;
  let actor: Actor;
  let guiaId: string;
  let loteId: string;
  let glosaIds: string[];

  beforeAll(async () => {
    s = await semearFase5E2E();
    actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('1. projetar guia de consulta a partir do encounter finalizado', async () => {
    const result = await withTenantTx(actor, (tx) =>
      projectGuiaConsulta(tx, s.encounterId, s.versionId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('projected');
    if (result.value.kind !== 'projected') return;
    guiaId = result.value.guiaId;
    expect(guiaId).toBeDefined();
    expect(result.value.status).toBe('completa');
  });

  it('2. criar lote em rascunho para a operadora', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    loteId = result.value.loteId;
    expect(result.value.tissVersion).toBe('4.01.00');
  });

  it('3. adicionar guia ao lote', async () => {
    const result = await withTenantTx(actor, (tx) =>
      addGuiaToLote(tx, { loteId, guiaId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sequencialItem).toBe(1);
    expect(result.value.guiaCount).toBe(1);
  });

  it('4. marcar lote como pronto', async () => {
    const result = await withTenantTx(actor, (tx) =>
      markLoteReady(tx, loteId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guiaCount).toBe(1);
  });

  it('5. enviar lote com protocolo', async () => {
    const result = await withTenantTx(actor, (tx) =>
      markLoteSent(tx, {
        loteId,
        protocoloOperadora: 'PROT-E2E-F5-001',
        xmlStorageKey: 'tiss/e2e/f5/001.xml',
        xmlHashMd5: 'e2e5aabbccdd11223344e2e5aabbccdd',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.protocoloOperadora).toBe('PROT-E2E-F5-001');
  });

  it('6. importar demonstrativo com glosa parcial — valor apresentado 150, processado 100, glosa 50', async () => {
    // Buscar o numero_guia_prestador gerado pela projecao
    const guiaRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ numero_guia_prestador: string }>(
        `SELECT numero_guia_prestador FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guiaId],
      );
      return rows[0];
    });
    expect(guiaRow).toBeDefined();
    const numeroGuia = guiaRow!.numero_guia_prestador;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, {
        operadoraId: s.operadoraId,
        loteId,
        protocoloOperadora: 'PROT-E2E-F5-001',
        kind: 'analise',
        dataProcessamento: '2026-08-05',
        dataPagamento: null,
        xmlStorageKey: 'tiss/e2e/f5/demo-001.xml',
        totalApresentadoCents: 15000,
        totalProcessadoCents: 10000,
        totalLiberadoCents: 10000,
        totalGlosaCents: 5000,
        itens: [
          {
            numeroGuiaPrestador: numeroGuia,
            valorApresentadoCents: 15000,
            valorProcessadoCents: 10000,
            valorLiberadoCents: 10000,
            valorGlosaCents: 5000,
            glosaCodigo: 'A017',
            glosaDescricao: 'Procedimento nao compativel com o diagnostico',
          },
        ],
      }, s.userId),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.demonstrativoId).toBeDefined();
    expect(result.value.itensImportados).toBe(1);
  });

  it('7. verificar que a glosa foi criada com status pendente e valor correto', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        codigo_glosa: string;
        valor_glosado_cents: string;
        status: string;
        encounter_version_id: string;
      }>(
        `SELECT id, codigo_glosa, valor_glosado_cents::text, status, encounter_version_id
           FROM tiss.glosa
          WHERE guia_id = $1`,
        [guiaId],
      );
      return rows;
    });
    expect(resultado).toHaveLength(1);
    const glosa = resultado[0]!;
    expect(glosa.codigo_glosa).toBe('A017');
    expect(Number(glosa.valor_glosado_cents)).toBe(5000);
    expect(glosa.status).toBe('pendente');
    // §3.9: a glosa cita a encounter_version_id usada na guia
    expect(glosa.encounter_version_id).toBe(s.versionId);
    glosaIds = [glosa.id];
  });

  it('8. verificar que o lote foi atualizado para retornado', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`, [loteId],
      );
      return rows[0];
    });
    expect(resultado?.status).toBe('retornado');
  });

  it('9. criar recurso de glosa para contestar a glosa', async () => {
    const result = await withTenantTx(actor, (tx) =>
      createRecursoGlosa(tx, {
        operadoraId: s.operadoraId,
        encounterVersionId: s.versionId,
        justificativaGeral: 'O procedimento esta de acordo com o diagnostico CID-10 registrado no prontuario.',
        createdBy: s.userId,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recursoId).toBeDefined();
    expect(result.value.status).toBe('rascunho');

    // Guardar recursoId para os proximos passos
    const recursoId = result.value.recursoId;

    // 10. adicionar a glosa ao recurso com justificativa individual
    const addResult = await withTenantTx(actor, (tx) =>
      addGlosaToRecurso(tx, {
        recursoId,
        glosaId: glosaIds[0]!,
        justificativa: 'Diagnostico Z00.0 justifica consulta completa conforme protocolo clinico.',
        valorRecursadoCents: 5000,
      }),
    );
    expect(addResult.ok).toBe(true);

    // 11. marcar recurso como pronto
    const readyResult = await withTenantTx(actor, (tx) =>
      markRecursoReady(tx, recursoId),
    );
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.value.status).toBe('pronto');
    expect(readyResult.value.itemCount).toBe(1);

    // 12. submeter recurso com fake transport
    const fakeTransport = createFakeTissArquivoTransport();
    const submitResult = await withTenantTx(actor, (tx) =>
      submitRecurso(tx, recursoId, fakeTransport),
    );
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.value.status).toBe('enviado');

    // 13. resolver recurso como deferido — operadora acatou a contestacao
    const resolveResult = await withTenantTx(actor, (tx) =>
      resolveRecurso(tx, {
        recursoId,
        resultado: 'deferido',
        resolvedBy: s.userId,
      }),
    );
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.status).toBe('deferido');

    // 14. verificar que a glosa mudou de status pendente para revertida
    const glosaFinal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        status: string;
        valor_glosado_cents: string;
        resolved_at: string | null;
      }>(
        `SELECT status, valor_glosado_cents::text, resolved_at::text
           FROM tiss.glosa WHERE id = $1`,
        [glosaIds[0]!],
      );
      return rows[0];
    });
    expect(glosaFinal?.status).toBe('revertida');
    expect(Number(glosaFinal?.valor_glosado_cents)).toBe(5000);
    expect(glosaFinal?.resolved_at).not.toBeNull();
  });

  it('10. valor recuperado: a soma de glosas revertidas para esta guia iguala o valor originalmente glosado', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        total_revertido: string;
        total_pendente: string;
        total_aceito: string;
      }>(
        `SELECT
           coalesce(sum(CASE WHEN status = 'revertida' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_revertido,
           coalesce(sum(CASE WHEN status = 'pendente' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_pendente,
           coalesce(sum(CASE WHEN status = 'aceita' THEN valor_glosado_cents ELSE 0 END), 0)::text AS total_aceito
         FROM tiss.glosa
         WHERE guia_id = $1`,
        [guiaId],
      );
      return rows[0];
    });
    expect(Number(resultado?.total_revertido)).toBe(5000);
    expect(Number(resultado?.total_pendente)).toBe(0);
    expect(Number(resultado?.total_aceito)).toBe(0);
  });

  it('11. a encounter_version_id no recurso de glosa bate com a versao da guia (§3.9)', async () => {
    const resultado = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        recurso_version_id: string;
        glosa_version_id: string;
      }>(
        `SELECT rg.encounter_version_id AS recurso_version_id,
                g.encounter_version_id AS glosa_version_id
           FROM tiss.recurso_glosa rg
           JOIN tiss.recurso_glosa_item rgi ON rgi.recurso_id = rg.id
           JOIN tiss.glosa g ON g.id = rgi.glosa_id
          WHERE rg.encounter_version_id = $1
          LIMIT 1`,
        [s.versionId],
      );
      return rows[0];
    });
    expect(resultado).toBeDefined();
    expect(resultado!.recurso_version_id).toBe(s.versionId);
    expect(resultado!.glosa_version_id).toBe(s.versionId);
  });
});
```

- [ ] Rodar `pnpm vitest run packages/tiss/src/fase5-e2e.int.test.ts --config vitest.int.config.ts` e confirmar que todos os 11 testes passam.

Saida esperada: 11 testes passando. O fluxo completo: encounter → guia → lote → envio → demonstrativo → glosa → recurso → deferimento → valor recuperado.

- [ ] Commitar: `test(tiss): add Fase 5 end-to-end integration test`

---

### Task 60: gate de definition-of-done da Fase 5

**Arquivos**

- Modificar `apps/web/src/ui/nav.ts`
- Modificar `apps/web/src/ui/BarraDeNavegacao.test.tsx`

**Passos**

- [ ] Atualizar FASE_ATUAL para 5 e os testes da barra de navegacao. Na Fase 5 nenhum item novo e adicionado a barra — os mesmos 6 itens da Fase 3 continuam. O update e so a constante.

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2 },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2 },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuicao de variacao chegam na Fase 3' },
];

export const FASE_ATUAL = 5 as const;
```

- [ ] Atualizar o teste da barra de navegacao para refletir a Fase 5.

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('na Fase 5 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(5);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

  it('todos os itens sao links navegaveis', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: item.rotulo })).toBeInTheDocument();
    }
  });

  it('nenhum item aparece como botao desabilitado', () => {
    render(<BarraDeNavegacao />);
    const botoesDesabilitados = screen.queryAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(botoesDesabilitados).toHaveLength(0);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegacao principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que falha porque FASE_ATUAL ainda e 3.

Saida esperada: 1 falha — `FASE_ATUAL` e 3, o teste espera 5.

- [ ] Aplicar a mudanca de `FASE_ATUAL = 5` em `nav.ts`.

- [ ] Rodar `pnpm vitest run apps/web/src/ui/BarraDeNavegacao.test.tsx` e confirmar que todos os 6 testes passam.

Saida esperada: 6 testes passando.

- [ ] Documentar a sequencia completa do gate de qualidade. Nao e um arquivo separado — sao os comandos a rodar:

```bash
# Gate de qualidade completo da Fase 5 — rodar nesta ordem
pnpm typecheck          # 0 erros
pnpm arch:check         # 0 violacoes
pnpm lint:terminology-clock  # 0 violacoes
pnpm lint:session-guc   # 0 violacoes
pnpm test               # todos os testes de unidade passam
pnpm test:int           # todos os testes de integracao passam (fase5-e2e + fase3-e2e + fase2-e2e)
pnpm test:iso           # todos os testes de isolamento passam
pnpm db:invariants      # todos verdes — incluindo as 5 novas tabelas tiss
pnpm db:privileges      # novas relacoes declaradas
pnpm prepush            # pass (executa typecheck + arch:check + lints + test + test:int + test:iso)
```

- [ ] Commitar: `feat: Fase 5 definition-of-done gate and end-to-end demonstration`
