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
