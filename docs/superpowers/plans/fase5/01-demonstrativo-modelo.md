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
