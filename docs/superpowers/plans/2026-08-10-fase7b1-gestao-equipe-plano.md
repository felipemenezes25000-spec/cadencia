# Fase 7B-1 — Gestao de equipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add team management to the settings page — invite users, revoke access, admin MFA disable.

**Architecture:** Three SECURITY DEFINER PostgreSQL functions bypass tight RLS on membership. New API routes guarded by existing authz actions (plus one new mfa.admin_disable). Frontend gets a dedicated Equipe tab with TabelaEquipe and ConvidarUsuario components.

**Tech Stack:** PostgreSQL (SECURITY DEFINER, RLS), Fastify + Zod, React + Next.js, vitest + testing-library

---

## Task 1 — Migration 0158: id_equipe role + SECURITY DEFINER functions + update equipe_da_unidade

**Files:**
- Create `packages/db/migrations/0158_equipe_admin.sql`

### Steps

- [ ] 1. Create the migration file `packages/db/migrations/0158_equipe_admin.sql` with the following complete content:

```sql
-- 0158_equipe_admin.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- GESTAO DE EQUIPE: convite, revogacao e desativacao de MFA por admin.
--
-- Tres funcoes SECURITY DEFINER sob o novo papel id_equipe (NOLOGIN). O padrao
-- e o mesmo de id_login (0132): papel minimo, dono das funcoes, privilegio
-- estreito, RLS com USING(true) seguro porque NOLOGIN impede uso direto.
--
-- 1. app.conceder_vinculo — cria user + credencial + membership + professional
-- 2. app.revogar_vinculo — soft-revoke do membership
-- 3. id.desativar_totp_admin — deleta TOTP de outro usuario
-- 4. Recria app.equipe_da_unidade com coluna tem_totp

-- ============================================================================
-- 1. Papel id_equipe
-- ============================================================================

CREATE ROLE id_equipe NOLOGIN;
-- Em host gerenciado, app_owner precisa de SET ROLE sobre id_equipe para ALTER
-- FUNCTION ... OWNER TO id_equipe no fim deste arquivo.
GRANT id_equipe TO app_owner;

-- Grants minimos para as SECURITY DEFINER functions
GRANT SELECT, INSERT ON id."user"           TO id_equipe;
GRANT SELECT, INSERT ON id.user_credential  TO id_equipe;
GRANT SELECT, INSERT, UPDATE ON app.membership   TO id_equipe;
GRANT SELECT, INSERT, UPDATE ON app.professional TO id_equipe;
GRANT DELETE ON id.user_totp                TO id_equipe;
GRANT SELECT ON app.clinic                  TO id_equipe;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO id_equipe;
GRANT EXECUTE ON FUNCTION app.current_user_id()   TO id_equipe;

-- RLS policies USING(true) para id_equipe. Seguro: o role e NOLOGIN, so
-- acessivel via SECURITY DEFINER functions.
CREATE POLICY equipe ON id."user" AS PERMISSIVE FOR ALL TO id_equipe
  USING (true);
CREATE POLICY equipe ON id.user_credential AS PERMISSIVE FOR ALL TO id_equipe
  USING (true);
CREATE POLICY equipe ON app.membership AS PERMISSIVE FOR ALL TO id_equipe
  USING (true);
CREATE POLICY equipe ON app.professional AS PERMISSIVE FOR ALL TO id_equipe
  USING (true);
CREATE POLICY equipe ON id.user_totp AS PERMISSIVE FOR ALL TO id_equipe
  USING (true);
CREATE POLICY equipe ON app.clinic AS PERMISSIVE FOR SELECT TO id_equipe
  USING (true);

-- ============================================================================
-- 2. app.conceder_vinculo
-- ============================================================================

CREATE FUNCTION app.conceder_vinculo(
  p_clinic_id    uuid,
  p_email        citext,
  p_nome         text,
  p_role         text,
  p_senha_hash   text,
  p_cpf          varchar(11) DEFAULT NULL,
  p_conselho     varchar(2)  DEFAULT NULL,
  p_num_conselho varchar(15) DEFAULT NULL,
  p_uf_conselho  char(2)     DEFAULT NULL,
  p_cbos         varchar(6)  DEFAULT NULL
)
RETURNS TABLE (r_user_id uuid, r_membership_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = app, id, pg_catalog
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_user_id   uuid;
  v_member_id uuid;
BEGIN
  v_tenant_id := app.current_tenant_id();

  -- Criar usuario ou obter id existente
  INSERT INTO id."user" (id, email, full_name, cpf, status)
  VALUES (gen_random_uuid(), p_email, p_nome, p_cpf, 'ativo')
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_user_id;

  -- Se ON CONFLICT disparou, buscar o id existente
  IF v_user_id IS NULL THEN
    SELECT u.id INTO v_user_id
      FROM id."user" u
     WHERE u.email = p_email;
  END IF;

  -- Criar credencial (nao sobrescreve existente)
  INSERT INTO id.user_credential (user_id, password_hash)
  VALUES (v_user_id, p_senha_hash)
  ON CONFLICT (user_id) DO NOTHING;

  -- Criar vinculo (unique index ux_membership_vigente barra duplicata ativa)
  v_member_id := gen_random_uuid();
  INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role, granted_by)
  VALUES (v_tenant_id, v_member_id, v_user_id, p_clinic_id, p_role,
          app.current_user_id());

  -- Se role e profissional ou diretor_tecnico, registrar dados profissionais.
  -- app.professional tem UNIQUE (tenant_id, user_id), entao verificar existencia.
  IF p_role IN ('profissional', 'diretor_tecnico') AND p_conselho IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM app.professional
       WHERE tenant_id = v_tenant_id AND user_id = v_user_id
    ) THEN
      UPDATE app.professional
         SET conselho_profissional = p_conselho,
             numero_conselho = p_num_conselho,
             uf_conselho = p_uf_conselho,
             cbos = p_cbos
       WHERE tenant_id = v_tenant_id AND user_id = v_user_id;
    ELSE
      INSERT INTO app.professional
        (tenant_id, id, user_id, conselho_profissional, numero_conselho,
         uf_conselho, cbos)
      VALUES
        (v_tenant_id, gen_random_uuid(), v_user_id, p_conselho, p_num_conselho,
         p_uf_conselho, p_cbos);
    END IF;
  END IF;

  r_user_id      := v_user_id;
  r_membership_id := v_member_id;
  RETURN NEXT;
END;
$fn$;

ALTER FUNCTION app.conceder_vinculo(uuid, citext, text, text, text,
  varchar, varchar, varchar, char, varchar) OWNER TO id_equipe;
REVOKE ALL ON FUNCTION app.conceder_vinculo(uuid, citext, text, text, text,
  varchar, varchar, varchar, char, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conceder_vinculo(uuid, citext, text, text, text,
  varchar, varchar, varchar, char, varchar) TO app_rw;

-- ============================================================================
-- 3. app.revogar_vinculo
-- ============================================================================

CREATE FUNCTION app.revogar_vinculo(
  p_clinic_id uuid,
  p_user_id   uuid,
  p_role      text,
  p_motivo    text DEFAULT NULL
)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $fn$
  WITH updated AS (
    UPDATE app.membership
       SET revoked_at     = clock_timestamp(),
           revoked_reason = p_motivo
     WHERE tenant_id  = app.current_tenant_id()
       AND clinic_id  = p_clinic_id
       AND user_id    = p_user_id
       AND role       = p_role
       AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM updated;
$fn$;

ALTER FUNCTION app.revogar_vinculo(uuid, uuid, text, text) OWNER TO id_equipe;
REVOKE ALL ON FUNCTION app.revogar_vinculo(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revogar_vinculo(uuid, uuid, text, text) TO app_rw;

-- ============================================================================
-- 4. id.desativar_totp_admin
-- ============================================================================

CREATE FUNCTION id.desativar_totp_admin(p_user_id uuid)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = id, pg_catalog
AS $fn$
  WITH deleted AS (
    DELETE FROM id.user_totp
     WHERE user_id = p_user_id
    RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$fn$;

ALTER FUNCTION id.desativar_totp_admin(uuid) OWNER TO id_equipe;
REVOKE ALL ON FUNCTION id.desativar_totp_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION id.desativar_totp_admin(uuid) TO app_rw;

-- ============================================================================
-- 5. Recria app.equipe_da_unidade com coluna tem_totp
-- ============================================================================

-- PRIMEIRO conceder SELECT em id.user_totp ao id_login (owner da funcao).
-- Sem este grant, a funcao falharia em runtime ao referenciar a tabela.
GRANT SELECT ON id.user_totp TO id_login;
CREATE POLICY login_totp ON id.user_totp AS PERMISSIVE FOR SELECT TO id_login
  USING (true);

DROP FUNCTION app.equipe_da_unidade(uuid);

CREATE FUNCTION app.equipe_da_unidade(p_clinic_id uuid)
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  email      text,
  role       text,
  conselho   text,
  granted_at timestamptz(3),
  tem_totp   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, id, pg_catalog AS $fn$
  SELECT m.user_id,
         u.full_name,
         u.email::text,
         m.role,
         CASE WHEN pr.id IS NULL THEN NULL
              ELSE pr.conselho_profissional || ' ' || pr.numero_conselho
                   || '/' || pr.uf_conselho END,
         m.granted_at,
         t.user_id IS NOT NULL
    FROM app.membership m
    JOIN id."user" u ON u.id = m.user_id
    LEFT JOIN app.professional pr
           ON pr.tenant_id = m.tenant_id AND pr.user_id = m.user_id
    LEFT JOIN id.user_totp t
           ON t.user_id = m.user_id AND t.confirmed_at IS NOT NULL
   WHERE m.tenant_id = app.current_tenant_id()
     AND m.clinic_id = p_clinic_id
     AND m.revoked_at IS NULL
     AND u.disabled_at IS NULL
   ORDER BY u.full_name COLLATE "pt-BR-x-icu"
$fn$;

ALTER FUNCTION app.equipe_da_unidade(uuid) OWNER TO id_login;
REVOKE ALL    ON FUNCTION app.equipe_da_unidade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.equipe_da_unidade(uuid) TO app_rw;

-- ============================================================================
-- 6. Audit meta keys: adicionar 'target_user_id' e 'membership_id'
-- ============================================================================

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id',
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku',
              'numero_guia',
              'operadora_nome',
              'registro_ans',
              'guia_status',
              'guia_count',
              'numero_lote',
              'item_count',
              'total_recursado_cents',
              'total_resultados',
              'deferidos',
              'valores_expurgados',
              'anexos_expurgados',
              'corte_retencao',
              'ocorrencias',
              'target_user_id',
              'membership_id'
            )
         );
$fn$;
```

- [ ] 2. Run the isolation tests to verify the migration applies correctly:

```bash
pnpm test:iso
```

Expected: all tests pass, migration 0158 applies without errors.

- [ ] 3. Commit:

```bash
git add packages/db/migrations/0158_equipe_admin.sql
git commit -m "feat(db): migration 0158 — id_equipe role, conceder/revogar vinculo, desativar TOTP admin, equipe_da_unidade com tem_totp

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Add mfa.admin_disable action to authz catalog

**Files:**
- Modify `packages/authz/src/actions.ts`
- Auto-generated: `packages/authz/actions.lock.json`

### Steps

- [ ] 1. In `packages/authz/src/actions.ts`, add the new action entry after the `membership.revoke` line (line 37). Find the line:

```ts
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
```

Add immediately after it:

```ts
  { key: 'mfa.admin_disable', description: 'Desativar MFA de outro usuario',
    roles: ['admin_clinico'], requiresMfa: true },
```

- [ ] 2. Regenerate the lock file:

```bash
pnpm authz:seed
```

- [ ] 3. Verify the lock file is consistent:

```bash
pnpm authz:check
```

Expected: exits 0, no errors.

- [ ] 4. Commit:

```bash
git add packages/authz/src/actions.ts packages/authz/actions.lock.json
git commit -m "feat(authz): add mfa.admin_disable action for admin MFA removal

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Update GET /v1/configuracoes/equipe to return temTotp

**Files:**
- Modify `apps/api/src/routes/configuracoes.ts`
- Modify `apps/api/src/routes/configuracoes.int.test.ts`

### Steps

- [ ] 1. In `apps/api/src/routes/configuracoes.ts`, update the response schema for GET `/v1/configuracoes/equipe`. Find the existing schema object inside the `z.array()`:

```ts
            userId: z.string().uuid(),
            nome: z.string(),
            email: z.string(),
            role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                          'recepcao', 'financeiro']),
            ehProfissional: z.boolean(),
            conselho: z.string().nullable(),
            desde: z.string(),
```

Replace with (adds `temTotp`):

```ts
            userId: z.string().uuid(),
            nome: z.string(),
            email: z.string(),
            role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                          'recepcao', 'financeiro']),
            ehProfissional: z.boolean(),
            conselho: z.string().nullable(),
            desde: z.string(),
            temTotp: z.boolean(),
```

- [ ] 2. Update the query result type and the mapping in the same route handler. Find the type annotation:

```ts
    const { rows } = await tx.query<{
      user_id: string; nome: string; email: string; role: string;
      conselho: string | null; granted_at: Date;
    }>(
```

Replace with:

```ts
    const { rows } = await tx.query<{
      user_id: string; nome: string; email: string; role: string;
      conselho: string | null; granted_at: Date; tem_totp: boolean;
    }>(
```

- [ ] 3. Update the row mapping to include `temTotp`. Find:

```ts
    return {
      itens: rows.map((x) => ({
        userId: x.user_id,
        nome: x.nome,
        email: x.email,
        role: x.role as 'admin_clinico',
        ehProfissional: x.conselho !== null,
        conselho: x.conselho,
        desde: x.granted_at.toISOString(),
      })),
    };
```

Replace with:

```ts
    return {
      itens: rows.map((x) => ({
        userId: x.user_id,
        nome: x.nome,
        email: x.email,
        role: x.role as 'admin_clinico',
        ehProfissional: x.conselho !== null,
        conselho: x.conselho,
        desde: x.granted_at.toISOString(),
        temTotp: x.tem_totp,
      })),
    };
```

- [ ] 4. In `apps/api/src/routes/configuracoes.int.test.ts`, update the existing equipe listing test. Find the test `'GET /v1/configuracoes/equipe lista os vinculos com papel'` and update the assertion. Find:

```ts
    const itens = (r.json() as {
      itens: { userId: string; nome: string; email: string; role: string;
               ehProfissional: boolean }[] }).itens;
```

Replace with:

```ts
    const itens = (r.json() as {
      itens: { userId: string; nome: string; email: string; role: string;
               ehProfissional: boolean; temTotp: boolean }[] }).itens;
```

And after the existing assertions for `eu`, add:

```ts
    expect(typeof eu?.temTotp).toBe('boolean');
```

Find the line:

```ts
    expect(eu?.ehProfissional).toBe(true);
```

And add directly after it:

```ts
    expect(typeof eu?.temTotp).toBe('boolean');
```

- [ ] 5. Run integration tests:

```bash
pnpm test:int -- --grep "configuracoes"
```

Expected: all tests pass, including the updated equipe listing test.

- [ ] 6. Commit:

```bash
git add apps/api/src/routes/configuracoes.ts apps/api/src/routes/configuracoes.int.test.ts
git commit -m "feat(api): GET /v1/configuracoes/equipe returns temTotp boolean

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — POST /v1/configuracoes/equipe — invite route + tests

**Files:**
- Modify `apps/api/src/routes/configuracoes.ts`
- Modify `apps/api/src/routes/configuracoes.int.test.ts`

### Steps

- [ ] 1. In `apps/api/src/routes/configuracoes.ts`, add the `hashPassword` import. Find:

```ts
import { rota } from '../guard';
```

Replace with:

```ts
import { hashPassword } from '@cadencia/authn';
import { rota } from '../guard';
```

- [ ] 2. Append the new POST route inside the `configuracaoRoutes` function, after the closing of the GET equipe route (after line 136, before the final `}`). Add:

```ts

  // ── Convite ──────────────────────────────────────────────────────────────

  const ROLES_PROFISSIONAIS = ['profissional', 'diretor_tecnico'] as const;

  r.post('/v1/configuracoes/equipe', {
    schema: {
      body: z.object({
        email: z.string().email(),
        nome: z.string().min(2),
        role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                      'recepcao', 'financeiro']),
        senhaTemporaria: z.string().min(8),
        cpf: z.string().regex(/^\d{11}$/).optional(),
        conselho: z.string().min(1).optional(),
        numeroConselho: z.string().min(1).optional(),
        ufConselho: z.string().regex(/^[A-Z]{2}$/).optional(),
        cbos: z.string().min(1).optional(),
      }),
      response: {
        201: z.object({
          userId: z.string().uuid(),
          membershipId: z.string().uuid(),
        }),
        409: z.object({ erro: z.literal('vinculo_duplicado') }),
        422: z.object({ erro: z.literal('dados_profissionais_obrigatorios') }),
      },
    },
  }, rota('membership.grant', async (tx, ctx, req, reply) => {
    const b = req.body as {
      email: string; nome: string; role: string; senhaTemporaria: string;
      cpf?: string; conselho?: string; numeroConselho?: string;
      ufConselho?: string; cbos?: string;
    };

    // Validar dados profissionais obrigatorios
    if ((ROLES_PROFISSIONAIS as readonly string[]).includes(b.role)) {
      if (!b.conselho || !b.numeroConselho || !b.ufConselho) {
        return reply.code(422).send({
          erro: 'dados_profissionais_obrigatorios' as const,
        });
      }
    }

    const senhaHash = await hashPassword(b.senhaTemporaria);

    try {
      const { rows } = await tx.query<{
        r_user_id: string; r_membership_id: string;
      }>(
        `SELECT * FROM app.conceder_vinculo($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          ctx.actor.clinicId, b.email, b.nome, b.role, senhaHash,
          b.cpf ?? null, b.conselho ?? null, b.numeroConselho ?? null,
          b.ufConselho ?? null, b.cbos ?? null,
        ],
      );

      const row = rows[0]!;

      await tx.query(
        `SELECT audit.log('MEMBERSHIP_GRANT', 'app', 'membership', $1, 'sucesso',
                jsonb_build_object('role', $2::text, 'target_user_id', $3::text,
                                   'membership_id', $4::text), $5)`,
        [row.r_membership_id, b.role, row.r_user_id, row.r_membership_id,
         ctx.actor.clinicId]);

      void reply.code(201);
      return { userId: row.r_user_id, membershipId: row.r_membership_id };
    } catch (e: unknown) {
      // Unique violation on ux_membership_vigente
      if (typeof e === 'object' && e !== null && 'code' in e
          && (e as { code: string }).code === '23505') {
        return reply.code(409).send({ erro: 'vinculo_duplicado' as const });
      }
      throw e;
    }
  }));
```

- [ ] 3. In `apps/api/src/routes/configuracoes.int.test.ts`, add the invite tests. Append a new describe block after the existing `describe('configuracoes da clinica', ...)` block:

```ts

describe('convite de equipe', () => {
  it('convida novo usuario com dados validos: 201', async () => {
    const app = await buildApp();
    const email = `convite-${Date.now()}@test.local`;
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Novo Recepcao', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });

    expect(r.statusCode).toBe(201);
    const body = r.json() as { userId: string; membershipId: string };
    expect(body.userId).toBeDefined();
    expect(body.membershipId).toBeDefined();

    // Verificar que aparece na listagem
    const lista = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s),
    });
    const itens = (lista.json() as { itens: { userId: string }[] }).itens;
    expect(itens.some((x) => x.userId === body.userId)).toBe(true);

    await app.close();
  });

  it('profissional sem dados de conselho: 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email: `prof-${Date.now()}@test.local`, nome: 'Dr Sem Conselho',
        role: 'profissional', senhaTemporaria: 'Temp@2026xx',
      },
    });

    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'dados_profissionais_obrigatorios' });
    await app.close();
  });

  it('convite duplicado (mesmo email + role + clinica): 409', async () => {
    const app = await buildApp();
    const email = `dup-${Date.now()}@test.local`;
    const payload = {
      email, nome: 'Dup User', role: 'recepcao',
      senhaTemporaria: 'Temp@2026xx',
    };

    const r1 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload,
    });
    expect(r1.statusCode).toBe(201);

    const r2 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload,
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json()).toMatchObject({ erro: 'vinculo_duplicado' });

    await app.close();
  });

  it('email existente reutiliza user_id', async () => {
    const app = await buildApp();
    const email = `reuso-${Date.now()}@test.local`;

    const r1 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Reuso User', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });
    expect(r1.statusCode).toBe(201);
    const userId1 = (r1.json() as { userId: string }).userId;

    // Revogar para poder reconvidar com outro role
    await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${userId1}/role/recepcao`,
      ...auth(s),
    });

    const r2 = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Reuso User', role: 'financeiro',
        senhaTemporaria: 'OutraSenha@2026',
      },
    });
    expect(r2.statusCode).toBe(201);
    const userId2 = (r2.json() as { userId: string }).userId;
    expect(userId2).toBe(userId1);

    await app.close();
  });

  it('recepcao nao pode convidar: 403', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(recepcao),
      payload: {
        email: `nope-${Date.now()}@test.local`, nome: 'Nope',
        role: 'recepcao', senhaTemporaria: 'Temp@2026xx',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('convida profissional com dados de conselho: 201', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email: `drprof-${Date.now()}@test.local`, nome: 'Dr Profissional',
        role: 'profissional', senhaTemporaria: 'Temp@2026xx',
        conselho: '06', numeroConselho: '54321', ufConselho: 'RJ',
      },
    });
    expect(r.statusCode).toBe(201);

    // Verificar que aparece com conselho na listagem
    const body = r.json() as { userId: string };
    const lista = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s),
    });
    const itens = (lista.json() as {
      itens: { userId: string; conselho: string | null }[]
    }).itens;
    const prof = itens.find((x) => x.userId === body.userId);
    expect(prof?.conselho).toContain('54321');

    await app.close();
  });
});
```

- [ ] 4. Run integration tests:

```bash
pnpm test:int -- --grep "configuracoes|convite"
```

Expected: all tests pass.

- [ ] 5. Commit:

```bash
git add apps/api/src/routes/configuracoes.ts apps/api/src/routes/configuracoes.int.test.ts
git commit -m "feat(api): POST /v1/configuracoes/equipe — invite user route with tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — DELETE /v1/configuracoes/equipe/:userId/role/:role — revoke + tests

**Files:**
- Modify `apps/api/src/routes/configuracoes.ts`
- Modify `apps/api/src/routes/configuracoes.int.test.ts`

### Steps

- [ ] 1. Append the revoke route to `apps/api/src/routes/configuracoes.ts`, inside `configuracaoRoutes`, after the POST equipe route:

```ts

  // ── Revogacao ────────────────────────────────────────────────────────────

  r.delete('/v1/configuracoes/equipe/:userId/role/:role', {
    schema: {
      params: z.object({
        userId: z.string().uuid(),
        role: z.enum(['admin_clinico', 'diretor_tecnico', 'profissional',
                      'recepcao', 'financeiro']),
      }),
      body: z.object({
        motivo: z.string().optional(),
      }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('vinculo_nao_encontrado') }),
        422: z.object({ erro: z.literal('auto_revogacao') }),
      },
    },
  }, rota('membership.revoke', async (tx, ctx, req, reply) => {
    const p = req.params as { userId: string; role: string };
    const b = req.body as { motivo?: string };

    // Admin nao pode revogar a si mesmo no role ativo
    if (p.userId === ctx.actor.userId) {
      return reply.code(422).send({ erro: 'auto_revogacao' as const });
    }

    const { rows } = await tx.query<{ revogar_vinculo: number }>(
      `SELECT app.revogar_vinculo($1, $2, $3, $4)`,
      [ctx.actor.clinicId, p.userId, p.role, b.motivo ?? null],
    );

    const count = rows[0]?.revogar_vinculo ?? 0;
    if (count === 0) {
      return reply.code(404).send({
        erro: 'vinculo_nao_encontrado' as const,
      });
    }

    await tx.query(
      `SELECT audit.log('MEMBERSHIP_REVOKE', 'app', 'membership', NULL, 'sucesso',
              jsonb_build_object('role', $1::text, 'target_user_id', $2::text,
                                 'motivo', coalesce($3::text, '')), $4)`,
      [p.role, p.userId, b.motivo ?? '', ctx.actor.clinicId]);

    return { ok: true as const };
  }));
```

- [ ] 2. Add revocation tests to `apps/api/src/routes/configuracoes.int.test.ts`. Append a new describe block:

```ts

describe('revogacao de vinculo', () => {
  it('revogar vinculo ativo: 200', async () => {
    const app = await buildApp();
    const email = `rev-${Date.now()}@test.local`;

    // Convidar primeiro
    const invite = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Para Revogar', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });
    const userId = (invite.json() as { userId: string }).userId;

    // Revogar
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${userId}/role/recepcao`,
      ...auth(s),
      payload: { motivo: 'Saiu da clinica' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });

    // Nao aparece mais na listagem
    const lista = await app.inject({
      method: 'GET', url: '/v1/configuracoes/equipe', ...auth(s),
    });
    const itens = (lista.json() as { itens: { userId: string }[] }).itens;
    expect(itens.some((x) => x.userId === userId)).toBe(false);

    await app.close();
  });

  it('revogar vinculo inexistente: 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/00000000-0000-0000-0000-000000000000/role/recepcao`,
      ...auth(s),
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ erro: 'vinculo_nao_encontrado' });
    await app.close();
  });

  it('auto-revogacao: 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${s.userId}/role/admin_clinico`,
      ...auth(s),
      payload: {},
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'auto_revogacao' });
    await app.close();
  });
});
```

- [ ] 3. Run integration tests:

```bash
pnpm test:int -- --grep "configuracoes|convite|revogacao"
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add apps/api/src/routes/configuracoes.ts apps/api/src/routes/configuracoes.int.test.ts
git commit -m "feat(api): DELETE /v1/configuracoes/equipe/:userId/role/:role — revoke membership

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6 — DELETE /v1/configuracoes/equipe/:userId/mfa — MFA disable + tests

**Files:**
- Modify `apps/api/src/routes/configuracoes.ts`
- Modify `apps/api/src/routes/configuracoes.int.test.ts`

### Steps

- [ ] 1. Append the MFA disable route to `apps/api/src/routes/configuracoes.ts`, inside `configuracaoRoutes`, after the DELETE revoke route:

```ts

  // ── Desativacao de MFA por admin ─────────────────────────────────────────

  r.delete('/v1/configuracoes/equipe/:userId/mfa', {
    schema: {
      params: z.object({
        userId: z.string().uuid(),
      }),
      body: z.object({}),
      response: {
        200: z.object({ ok: z.literal(true) }),
        404: z.object({ erro: z.literal('mfa_nao_cadastrado') }),
        422: z.object({ erro: z.literal('auto_desativacao') }),
      },
    },
  }, rota('mfa.admin_disable', async (tx, ctx, req, reply) => {
    const p = req.params as { userId: string };

    if (p.userId === ctx.actor.userId) {
      return reply.code(422).send({ erro: 'auto_desativacao' as const });
    }

    // Verificar que o usuario alvo tem vinculo ativo na clinica
    const { rows: equipe } = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM app.equipe_da_unidade($1)`,
      [ctx.actor.clinicId],
    );
    if (!equipe.some((m) => m.user_id === p.userId)) {
      return reply.code(404).send({ erro: 'mfa_nao_cadastrado' as const });
    }

    const { rows } = await tx.query<{ desativar_totp_admin: number }>(
      `SELECT id.desativar_totp_admin($1)`,
      [p.userId],
    );

    const count = rows[0]?.desativar_totp_admin ?? 0;
    if (count === 0) {
      return reply.code(404).send({ erro: 'mfa_nao_cadastrado' as const });
    }

    await tx.query(
      `SELECT audit.log('MFA_ADMIN_DISABLE', 'id', 'user_totp', NULL, 'sucesso',
              jsonb_build_object('target_user_id', $1::text), $2)`,
      [p.userId, ctx.actor.clinicId]);

    return { ok: true as const };
  }));
```

- [ ] 2. Add MFA disable tests to `apps/api/src/routes/configuracoes.int.test.ts`. Append a new describe block:

```ts

describe('desativar MFA por admin', () => {
  it('desativar MFA de usuario com TOTP: 200', async () => {
    const app = await buildApp();

    // Convidar um usuario
    const email = `mfa-${Date.now()}@test.local`;
    const invite = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Com MFA', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });
    const userId = (invite.json() as { userId: string }).userId;

    // Inserir TOTP confirmado diretamente no banco (via admin pool)
    const { Pool } = await import('pg');
    const admin = new Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    await admin.query(
      `INSERT INTO id.user_totp (user_id, secret_ciphertext, confirmed_at)
       VALUES ($1, '\\xDEAD'::bytea, clock_timestamp())`,
      [userId],
    );
    await admin.end();

    // Desativar MFA
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${userId}/mfa`,
      ...auth(s),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });

    await app.close();
  });

  it('desativar MFA de usuario sem TOTP: 404', async () => {
    const app = await buildApp();

    // Convidar um usuario sem TOTP
    const email = `nomfa-${Date.now()}@test.local`;
    const invite = await app.inject({
      method: 'POST', url: '/v1/configuracoes/equipe', ...auth(s),
      payload: {
        email, nome: 'Sem MFA', role: 'recepcao',
        senhaTemporaria: 'Temp@2026xx',
      },
    });
    const userId = (invite.json() as { userId: string }).userId;

    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${userId}/mfa`,
      ...auth(s),
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ erro: 'mfa_nao_cadastrado' });

    await app.close();
  });

  it('auto-desativacao: 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${s.userId}/mfa`,
      ...auth(s),
      payload: {},
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'auto_desativacao' });
    await app.close();
  });

  it('recepcao nao pode desativar MFA: 403', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/configuracoes/equipe/${s.userId}/mfa`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] 3. Run integration tests:

```bash
pnpm test:int -- --grep "configuracoes|convite|revogacao|MFA"
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add apps/api/src/routes/configuracoes.ts apps/api/src/routes/configuracoes.int.test.ts
git commit -m "feat(api): DELETE /v1/configuracoes/equipe/:userId/mfa — admin MFA disable

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7 — TabelaEquipe component + tests

**Files:**
- Create `apps/web/src/telas/TabelaEquipe.tsx`
- Create `apps/web/src/telas/TabelaEquipe.test.tsx`

### Steps

- [ ] 1. Create `apps/web/src/telas/TabelaEquipe.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Trash, ShieldSlash } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { rotulo } from '../sessao';

export interface MembroEquipe {
  readonly userId: string;
  readonly nome: string;
  readonly email: string;
  readonly role: 'admin_clinico' | 'diretor_tecnico' | 'profissional' | 'recepcao' | 'financeiro';
  readonly ehProfissional: boolean;
  readonly conselho: string | null;
  readonly desde: string;
  readonly temTotp: boolean;
}

export interface TabelaEquipeProps {
  readonly itens: readonly MembroEquipe[];
  readonly meuUserId: string;
  readonly ehAdmin: boolean;
  readonly aoRevogar: (userId: string, role: string, motivo?: string) => Promise<void>;
  readonly aoDesativarMfa: (userId: string) => Promise<void>;
}

export function TabelaEquipe({
  itens, meuUserId, ehAdmin, aoRevogar, aoDesativarMfa,
}: TabelaEquipeProps) {
  const [confirmando, setConfirmando] = useState<{
    tipo: 'revogar' | 'mfa'; userId: string; role?: string;
  } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [executando, setExecutando] = useState(false);

  async function confirmar() {
    if (!confirmando) return;
    setExecutando(true);
    try {
      if (confirmando.tipo === 'revogar') {
        await aoRevogar(confirmando.userId, confirmando.role!, motivo || undefined);
      } else {
        await aoDesativarMfa(confirmando.userId);
      }
      setConfirmando(null);
      setMotivo('');
    } finally {
      setExecutando(false);
    }
  }

  function cancelar() {
    setConfirmando(null);
    setMotivo('');
  }

  return (
    <div className="overflow-x-auto rounded-[var(--r-md)] border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Pessoa</th>
            <th className="px-4 py-2.5 font-medium">Papel</th>
            <th className="px-4 py-2.5 font-medium">Registro</th>
            <th className="px-4 py-2.5 font-medium">Desde</th>
            {ehAdmin && <th className="px-4 py-2.5 font-medium">Acoes</th>}
          </tr>
        </thead>
        <tbody>
          {itens.map((m) => {
            const ehEu = m.userId === meuUserId;
            const confirmandoEste =
              confirmando !== null && confirmando.userId === m.userId;

            return (
              <tr key={`${m.userId}-${m.role}`} className="border-t border-line">
                <td className="px-4 py-3">
                  <span className="block font-medium">{m.nome}</span>
                  <span className="block text-xs text-text-muted">{m.email}</span>
                </td>
                <td className="px-4 py-3">{rotulo(m.role)}</td>
                <td className="px-4 py-3 font-mono text-xs">{m.conselho ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-text-muted">
                  {m.desde.slice(0, 10).split('-').reverse().join('/')}
                </td>
                {ehAdmin && (
                  <td className="px-4 py-3">
                    {ehEu ? null : confirmandoEste ? (
                      <div className="grid gap-2">
                        {confirmando.tipo === 'revogar' && (
                          <input
                            type="text"
                            placeholder="Motivo (opcional)"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                            aria-label="Motivo da revogacao"
                          />
                        )}
                        <div className="flex gap-2">
                          <Botao variante="perigo" tamanho="sm"
                            carregando={executando}
                            onClick={() => { void confirmar(); }}>
                            Confirmar
                          </Botao>
                          <Botao variante="secundario" tamanho="sm"
                            disabled={executando}
                            onClick={cancelar}>
                            Cancelar
                          </Botao>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Botao variante="perigo" tamanho="sm"
                          iconeEsquerda={Trash}
                          onClick={() => setConfirmando({
                            tipo: 'revogar', userId: m.userId, role: m.role,
                          })}>
                          Revogar
                        </Botao>
                        {m.temTotp && (
                          <Botao variante="secundario" tamanho="sm"
                            iconeEsquerda={ShieldSlash}
                            onClick={() => setConfirmando({
                              tipo: 'mfa', userId: m.userId,
                            })}>
                            Desativar MFA
                          </Botao>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {itens.length === 0 && (
            <tr>
              <td colSpan={ehAdmin ? 5 : 4}
                className="px-4 py-6 text-center text-text-muted">
                Nenhum vinculo nesta unidade.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] 2. Create `apps/web/src/telas/TabelaEquipe.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TabelaEquipe, type MembroEquipe } from './TabelaEquipe';

const BASE_ITENS: MembroEquipe[] = [
  {
    userId: 'u1', nome: 'Admin Silva', email: 'admin@test.local',
    role: 'admin_clinico', ehProfissional: false, conselho: null,
    desde: '2026-01-15T10:00:00.000Z', temTotp: true,
  },
  {
    userId: 'u2', nome: 'Dr Pereira', email: 'dr@test.local',
    role: 'profissional', ehProfissional: true, conselho: '06 12345/SP',
    desde: '2026-03-20T08:00:00.000Z', temTotp: false,
  },
  {
    userId: 'u3', nome: 'Recepcao Ana', email: 'ana@test.local',
    role: 'recepcao', ehProfissional: false, conselho: null,
    desde: '2026-06-01T09:00:00.000Z', temTotp: true,
  },
];

function montar(over: Partial<Parameters<typeof TabelaEquipe>[0]> = {}) {
  const props = {
    itens: BASE_ITENS,
    meuUserId: 'u1',
    ehAdmin: true,
    aoRevogar: vi.fn(async () => {}),
    aoDesativarMfa: vi.fn(async () => {}),
    ...over,
  };
  render(<TabelaEquipe {...props} />);
  return props;
}

describe('TabelaEquipe', () => {
  it('renderiza todas as colunas incluindo acoes para admin', () => {
    montar();
    expect(screen.getByText('Pessoa')).toBeDefined();
    expect(screen.getByText('Papel')).toBeDefined();
    expect(screen.getByText('Registro')).toBeDefined();
    expect(screen.getByText('Desde')).toBeDefined();
    expect(screen.getByText('Acoes')).toBeDefined();
    expect(screen.getByText('Admin Silva')).toBeDefined();
    expect(screen.getByText('Dr Pereira')).toBeDefined();
    expect(screen.getByText('Recepcao Ana')).toBeDefined();
  });

  it('esconde coluna acoes para nao-admin', () => {
    montar({ ehAdmin: false });
    expect(screen.queryByText('Acoes')).toBeNull();
    expect(screen.queryByRole('button', { name: /revogar/i })).toBeNull();
  });

  it('botao revogar oculto para a propria linha do admin', () => {
    montar();
    // u1 e o meuUserId — nao deve ter botao revogar na linha dele
    const rows = screen.getAllByRole('row');
    // Row 0 = header, Row 1 = u1 (Admin Silva)
    const adminRow = rows[1]!;
    expect(within(adminRow).queryByRole('button', { name: /revogar/i })).toBeNull();
    // Mas u2 e u3 devem ter
    const drRow = rows[2]!;
    expect(within(drRow).getByRole('button', { name: /revogar/i })).toBeDefined();
  });

  it('botao desativar MFA visivel apenas se temTotp', () => {
    montar();
    const rows = screen.getAllByRole('row');
    // u2 (Dr Pereira) tem temTotp=false
    const drRow = rows[2]!;
    expect(within(drRow).queryByRole('button', { name: /desativar mfa/i })).toBeNull();
    // u3 (Recepcao Ana) tem temTotp=true
    const anaRow = rows[3]!;
    expect(within(anaRow).getByRole('button', { name: /desativar mfa/i })).toBeDefined();
  });

  it('chama aoRevogar com confirmacao', async () => {
    const props = montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;

    await user.click(within(drRow).getByRole('button', { name: /revogar/i }));
    // Confirmacao aparece
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    // Preencher motivo
    const motivoInput = screen.getByLabelText(/motivo/i);
    await user.type(motivoInput, 'Saiu da clinica');

    await user.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(props.aoRevogar).toHaveBeenCalledWith('u2', 'profissional', 'Saiu da clinica');
  });

  it('chama aoDesativarMfa com confirmacao', async () => {
    const props = montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const anaRow = rows[3]!;

    await user.click(within(anaRow).getByRole('button', { name: /desativar mfa/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    await user.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(props.aoDesativarMfa).toHaveBeenCalledWith('u3');
  });

  it('cancelar fecha a confirmacao', async () => {
    montar();
    const user = userEvent.setup();
    const rows = screen.getAllByRole('row');
    const drRow = rows[2]!;

    await user.click(within(drRow).getByRole('button', { name: /revogar/i }));
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDefined();

    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('button', { name: /confirmar/i })).toBeNull();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <TabelaEquipe
        itens={BASE_ITENS}
        meuUserId="u1"
        ehAdmin={true}
        aoRevogar={vi.fn(async () => {})}
        aoDesativarMfa={vi.fn(async () => {})}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] 3. Run tests:

```bash
pnpm test:web -- --grep "TabelaEquipe"
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add apps/web/src/telas/TabelaEquipe.tsx apps/web/src/telas/TabelaEquipe.test.tsx
git commit -m "feat(web): TabelaEquipe component with inline confirmation and a11y tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8 — ConvidarUsuario component + tests

**Files:**
- Create `apps/web/src/telas/ConvidarUsuario.tsx`
- Create `apps/web/src/telas/ConvidarUsuario.test.tsx`

### Steps

- [ ] 1. Create `apps/web/src/telas/ConvidarUsuario.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { X } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;

const CONSELHOS = [
  { valor: '01', rotulo: 'CRBio' },
  { valor: '02', rotulo: 'CREF' },
  { valor: '03', rotulo: 'CREFITO' },
  { valor: '04', rotulo: 'CRF' },
  { valor: '05', rotulo: 'CRFA' },
  { valor: '06', rotulo: 'CRM' },
  { valor: '07', rotulo: 'CRMV' },
  { valor: '08', rotulo: 'CRN' },
  { valor: '09', rotulo: 'CRO' },
  { valor: '10', rotulo: 'CRP' },
  { valor: '11', rotulo: 'CRESS' },
  { valor: '12', rotulo: 'CRF (Fisica)' },
  { valor: '13', rotulo: 'COREN' },
] as const;

const ROLES_PROFISSIONAIS = ['profissional', 'diretor_tecnico'] as const;

export interface DadosConvite {
  readonly email: string;
  readonly nome: string;
  readonly role: string;
  readonly senhaTemporaria: string;
  readonly cpf?: string;
  readonly conselho?: string;
  readonly numeroConselho?: string;
  readonly ufConselho?: string;
  readonly cbos?: string;
}

export interface ConvidarUsuarioProps {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly aoConvidar: (dados: DadosConvite) => Promise<void>;
}

export function ConvidarUsuario({ aberto, aoFechar, aoConvidar }: ConvidarUsuarioProps) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState('recepcao');
  const [senhaTemporaria, setSenhaTemporaria] = useState('');
  const [conselho, setConselho] = useState('06');
  const [numeroConselho, setNumeroConselho] = useState('');
  const [ufConselho, setUfConselho] = useState('SP');
  const [cbos, setCbos] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehProfissional = (ROLES_PROFISSIONAIS as readonly string[]).includes(role);

  const valida =
    email.includes('@')
    && nome.length >= 2
    && senhaTemporaria.length >= 8
    && (!ehProfissional || (numeroConselho.length > 0 && ufConselho.length > 0));

  function resetar() {
    setEmail(''); setNome(''); setRole('recepcao');
    setSenhaTemporaria(''); setConselho('06');
    setNumeroConselho(''); setUfConselho('SP');
    setCbos(''); setErro(null);
  }

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const dados: DadosConvite = {
        email, nome, role, senhaTemporaria,
        ...(ehProfissional ? {
          conselho, numeroConselho, ufConselho,
          ...(cbos ? { cbos } : {}),
        } : {}),
      };
      await aoConvidar(dados);
      resetar();
      aoFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao convidar';
      setErro(
        msg === 'vinculo_duplicado'
          ? 'Este usuario ja tem esse papel nesta unidade.'
          : 'Nao foi possivel convidar.',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog" aria-modal="true" aria-label="Convidar usuario">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Convidar usuario</h2>
          <button type="button" onClick={() => { resetar(); aoFechar(); }}
            aria-label="Fechar" className="text-text-muted hover:text-text">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Email</span>
            <input type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Nome completo</span>
            <input type="text" required minLength={2}
              value={nome} onChange={(e) => setNome(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Papel</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <option value="admin_clinico">Administracao</option>
              <option value="diretor_tecnico">Direcao tecnica</option>
              <option value="profissional">Profissional de saude</option>
              <option value="recepcao">Recepcao</option>
              <option value="financeiro">Financeiro</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Senha temporaria</span>
            <input type="text" required minLength={8}
              value={senhaTemporaria} onChange={(e) => setSenhaTemporaria(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
            {senhaTemporaria.length > 0 && senhaTemporaria.length < 8 && (
              <span className="text-xs text-danger">Minimo 8 caracteres</span>
            )}
          </label>

          {ehProfissional && (
            <>
              <label className="grid gap-1">
                <span className="text-xs text-text-muted">Conselho</span>
                <select value={conselho} onChange={(e) => setConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  {CONSELHOS.map((c) => (
                    <option key={c.valor} value={c.valor}>{c.rotulo}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">Numero do conselho</span>
                <input type="text" required
                  value={numeroConselho} onChange={(e) => setNumeroConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">UF do conselho</span>
                <select value={ufConselho} onChange={(e) => setUfConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">CBOS (opcional)</span>
                <input type="text"
                  value={cbos} onChange={(e) => setCbos(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </>
          )}

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <div className="flex gap-3 pt-2">
            <Botao type="submit" variante="primario" tamanho="md"
              disabled={!valida} carregando={enviando}>
              Convidar
            </Botao>
            <Botao type="button" variante="secundario" tamanho="md"
              disabled={enviando}
              onClick={() => { resetar(); aoFechar(); }}>
              Cancelar
            </Botao>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] 2. Create `apps/web/src/telas/ConvidarUsuario.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ConvidarUsuario } from './ConvidarUsuario';

function montar(over: Partial<Parameters<typeof ConvidarUsuario>[0]> = {}) {
  const props = {
    aberto: true,
    aoFechar: vi.fn(),
    aoConvidar: vi.fn(async () => {}),
    ...over,
  };
  render(<ConvidarUsuario {...props} />);
  return props;
}

describe('ConvidarUsuario', () => {
  it('renderiza campos quando aberto=true', () => {
    montar();
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/nome completo/i)).toBeDefined();
    expect(screen.getByLabelText(/papel/i)).toBeDefined();
    expect(screen.getByLabelText(/senha temporaria/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /convidar/i })).toBeDefined();
  });

  it('nao renderiza nada quando aberto=false', () => {
    montar({ aberto: false });
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it('campos profissionais aparecem ao selecionar role profissional', async () => {
    montar();
    const user = userEvent.setup();

    // Inicialmente sem campos profissionais
    expect(screen.queryByLabelText(/numero do conselho/i)).toBeNull();

    // Selecionar profissional
    await user.selectOptions(screen.getByLabelText(/papel/i), 'profissional');

    expect(screen.getByLabelText(/conselho/i)).toBeDefined();
    expect(screen.getByLabelText(/numero do conselho/i)).toBeDefined();
    expect(screen.getByLabelText(/uf do conselho/i)).toBeDefined();
  });

  it('campos profissionais ocultos para recepcao', async () => {
    montar();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/papel/i), 'recepcao');
    expect(screen.queryByLabelText(/numero do conselho/i)).toBeNull();
  });

  it('botao desabilitado com campos vazios', () => {
    montar();
    expect(screen.getByRole('button', { name: /convidar/i })).toBeDisabled();
  });

  it('chama aoConvidar com dados corretos (recepcao)', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'novo@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Novo Usuario');
    await user.selectOptions(screen.getByLabelText(/papel/i), 'recepcao');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');

    await user.click(screen.getByRole('button', { name: /convidar/i }));

    expect(props.aoConvidar).toHaveBeenCalledWith({
      email: 'novo@test.local',
      nome: 'Novo Usuario',
      role: 'recepcao',
      senhaTemporaria: 'Temp@2026xx',
    });
  });

  it('chama aoConvidar com dados profissionais quando profissional', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'dr@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Dr Novo');
    await user.selectOptions(screen.getByLabelText(/papel/i), 'profissional');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');
    await user.type(screen.getByLabelText(/numero do conselho/i), '54321');

    await user.click(screen.getByRole('button', { name: /convidar/i }));

    expect(props.aoConvidar).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dr@test.local',
        nome: 'Dr Novo',
        role: 'profissional',
        conselho: '06',
        numeroConselho: '54321',
        ufConselho: 'SP',
      }),
    );
  });

  it('exibe erro em caso de falha', async () => {
    montar({
      aoConvidar: vi.fn(async () => { throw new Error('vinculo_duplicado'); }),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'dup@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Dup User');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');

    await user.click(screen.getByRole('button', { name: /convidar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/ja tem esse papel/i)).toBeDefined();
    });
  });

  it('passa a11y', async () => {
    const { container } = render(
      <ConvidarUsuario
        aberto={true}
        aoFechar={vi.fn()}
        aoConvidar={vi.fn(async () => {})}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] 3. Run tests:

```bash
pnpm test:web -- --grep "ConvidarUsuario"
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add apps/web/src/telas/ConvidarUsuario.tsx apps/web/src/telas/ConvidarUsuario.test.tsx
git commit -m "feat(web): ConvidarUsuario modal component with validation and a11y tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9 — Equipe page + layout tab

**Files:**
- Create `apps/web/app/configuracoes/equipe/page.tsx`
- Modify `apps/web/app/configuracoes/layout.tsx`
- Modify `apps/web/app/configuracoes/page.tsx`

### Steps

- [ ] 1. Create `apps/web/app/configuracoes/equipe/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from '@phosphor-icons/react';
import { apiFetch, ApiError } from '../../../src/api';
import { useSessao, lerCsrf } from '../../../src/sessao';
import { Botao } from '../../../src/ui/Botao';
import { TabelaEquipe, type MembroEquipe } from '../../../src/telas/TabelaEquipe';
import { ConvidarUsuario, type DadosConvite } from '../../../src/telas/ConvidarUsuario';

export default function PaginaEquipe() {
  const { clinicId, csrfToken, vinculoAtivo, usuario } = useSessao();
  const ehAdmin = vinculoAtivo.role === 'admin_clinico';

  const [equipe, setEquipe] = useState<readonly MembroEquipe[]>([]);
  const [modalAberto, setModalAberto] = useState(false);

  async function carregarEquipe() {
    try {
      const r = await apiFetch<{ itens: MembroEquipe[] }>(
        '/v1/configuracoes/equipe', { clinicId, csrfToken: lerCsrf() },
      );
      setEquipe(r.itens);
    } catch {
      setEquipe([]);
    }
  }

  useEffect(() => {
    void carregarEquipe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  async function convidar(dados: DadosConvite) {
    try {
      await apiFetch('/v1/configuracoes/equipe', {
        method: 'POST', body: dados, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function revogar(userId: string, role: string, motivo?: string) {
    try {
      await apiFetch(`/v1/configuracoes/equipe/${userId}/role/${role}`, {
        method: 'DELETE', body: { motivo }, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function desativarMfa(userId: string) {
    try {
      await apiFetch(`/v1/configuracoes/equipe/${userId}/mfa`, {
        method: 'DELETE', body: {}, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Equipe
        </h2>
        {ehAdmin && (
          <Botao variante="primario" tamanho="sm"
            iconeEsquerda={UserPlus}
            onClick={() => setModalAberto(true)}>
            Convidar
          </Botao>
        )}
      </div>

      <TabelaEquipe
        itens={equipe}
        meuUserId={usuario.userId}
        ehAdmin={ehAdmin}
        aoRevogar={revogar}
        aoDesativarMfa={desativarMfa}
      />

      <ConvidarUsuario
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoConvidar={convidar}
      />
    </div>
  );
}
```

- [ ] 2. In `apps/web/app/configuracoes/layout.tsx`, add the Equipe tab. Find the ABAS array:

```ts
const ABAS = [
  { value: 'clinica', rotulo: 'Clinica', href: '/configuracoes' },
  { value: 'permissoes', rotulo: 'Permissoes', href: '/configuracoes/permissoes' },
```

Replace the first two entries (keeping the rest) to insert "Equipe" after "Clinica":

```ts
const ABAS = [
  { value: 'clinica', rotulo: 'Clinica', href: '/configuracoes' },
  { value: 'equipe', rotulo: 'Equipe', href: '/configuracoes/equipe' },
  { value: 'permissoes', rotulo: 'Permissoes', href: '/configuracoes/permissoes' },
```

- [ ] 3. In `apps/web/app/configuracoes/page.tsx`, remove the entire Equipe section. Remove the `MembroDaEquipe` interface, the `equipe` state, the equipe fetch from the `useEffect`, the `rotulo` import, and the entire second `<section>` block (the one with heading "Equipe"). The file should also no longer import `rotulo` from `sessao`.

The modified file content should be:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface Clinica {
  clinicId: string;
  nome: string;
  cnpj: string | null;
  cnes: string | null;
  timezone: string;
  tenantNome: string;
}

/**
 * Fusos que cobrem o Brasil. A lista curta e deliberada: o servidor valida
 * contra `pg_timezone_names` (a fonte que `app.local_date` vai usar depois), e
 * um combo com 600 zonas do mundo so aumenta a chance de alguem escolher errado
 * o campo que decide a data de todo evento do sistema.
 */
const FUSOS = [
  ['America/Sao_Paulo', 'Brasilia (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiaba (UTC-4)'],
  ['America/Belem', 'Belem (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export default function PaginaConfiguracoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico';

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const c = await apiFetch<Clinica>(
        '/v1/configuracoes/clinica', { clinicId, csrfToken });
      if (!vivo) return;
      setClinica(c); setNome(c.nome); setTimezone(c.timezone);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    setSalvando(true);
    try {
      const c = await apiFetch<Clinica>('/v1/configuracoes/clinica', {
        method: 'PUT', body: { nome, timezone }, clinicId, csrfToken });
      setClinica(c);
      setAviso({ tipo: 'ok', texto: 'Configuracoes salvas.' });
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: e instanceof ApiError && e.codigo === 'fuso_invalido'
          ? 'Fuso horario invalido.'
          : 'Nao foi possivel salvar.',
      });
    } finally {
      setSalvando(false);
    }
  }

  if (clinica === null) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Unidade
        </h2>

        <form onSubmit={(e) => { void salvar(e); }} className="grid max-w-lg gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nome da unidade</span>
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              disabled={!podeEditar} required minLength={2}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Fuso horario</span>
            <select
              value={timezone} onChange={(e) => setTimezone(e.target.value)}
              disabled={!podeEditar}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            >
              {FUSOS.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted">
              Decide a data de todo agendamento, recibo e lote. Mudar aqui muda
              como o dia e fechado.
            </span>
          </label>

          <dl className="grid grid-cols-2 gap-4 rounded-[var(--r-md)] border border-line bg-surface-2 p-4 text-sm">
            <div>
              <dt className="text-xs text-text-muted">CNES</dt>
              <dd className="font-mono">{clinica.cnes ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">CNPJ</dt>
              <dd className="font-mono">{clinica.cnpj ?? '—'}</dd>
            </div>
          </dl>

          {podeEditar && (
            <button
              type="submit" disabled={salvando}
              className="h-10 w-fit rounded-[var(--r-md)] bg-accent px-5 text-sm font-medium text-accent-on transition hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}

          {aviso !== null && (
            <p role="status"
               className={aviso.tipo === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>
              {aviso.texto}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
```

- [ ] 4. Run web tests to make sure nothing broke:

```bash
pnpm test:web
```

Expected: all web tests pass (TabelaEquipe, ConvidarUsuario, and existing tests).

- [ ] 5. Commit:

```bash
git add apps/web/app/configuracoes/equipe/page.tsx apps/web/app/configuracoes/layout.tsx apps/web/app/configuracoes/page.tsx
git commit -m "feat(web): Equipe page, layout tab, remove equipe section from clinica page

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10 — Quality gate + push

**Files:**
- No files modified (verification only)

### Steps

- [ ] 1. Run typecheck:

```bash
pnpm tsc --build
```

Expected: 0 errors.

- [ ] 2. Run architecture check:

```bash
pnpm authz:check
```

Expected: exits 0.

- [ ] 3. Run all lints:

```bash
pnpm lint
```

Expected: 0 warnings, 0 errors.

- [ ] 4. Run all test suites:

```bash
pnpm test
pnpm test:web
pnpm test:int
pnpm test:iso
```

Expected: all pass.

- [ ] 5. Build:

```bash
pnpm build
```

Expected: clean build.

- [ ] 6. Push:

```bash
git push origin main
```

- [ ] 7. If any step fails, fix the issue, commit the fix, and re-run from step 1.
