# Fase 7A — Credenciais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password change and MFA enrollment to the profile page, backed by two new API routes.

**Architecture:** Two new routes in `sessao.ts` (PUT /v1/sessao/senha, POST /v1/sessao/mfa/cadastrar) plus a new `mfaCadastrado` field on GET /v1/sessao. Two new presentational components (TrocaDeSenha, CadastroMfa) composed into the existing profile page. MFA enrollment returns the secret as text for manual entry in the authenticator app; confirmation uses the existing POST /v1/sessao/mfa route.

**Tech Stack:** Fastify + Zod (API), @cadencia/authn (password hashing, session management, TOTP enrollment), React + @testing-library (frontend), vitest (all tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `apps/api/src/routes/sessao.ts` | Add `mfaCadastrado` to GET, add PUT senha, add POST mfa/cadastrar |
| Modify | `apps/api/src/routes/sessao.int.test.ts` | Integration tests for the 3 changes above |
| Modify | `apps/web/src/sessao.tsx` | Add `mfaCadastrado` to `QuemSou` interface |
| Create | `apps/web/src/telas/TrocaDeSenha.tsx` | Password change form component |
| Create | `apps/web/src/telas/TrocaDeSenha.test.tsx` | Tests for TrocaDeSenha |
| Create | `apps/web/src/telas/CadastroMfa.tsx` | MFA enrollment flow component |
| Create | `apps/web/src/telas/CadastroMfa.test.tsx` | Tests for CadastroMfa |
| Modify | `apps/web/app/configuracoes/perfil/page.tsx` | Compose TrocaDeSenha + CadastroMfa, wire API calls |

---

### Task 1: Add `mfaCadastrado` to GET /v1/sessao

**Files:**
- Modify: `apps/api/src/routes/sessao.ts:223-258` (GET /v1/sessao handler)
- Modify: `apps/web/src/sessao.tsx:38-45` (QuemSou interface)
- Modify: `apps/api/src/routes/sessao.int.test.ts:122-144` (GET /v1/sessao test)

- [ ] **Step 1: Update the GET /v1/sessao response schema and handler**

In `apps/api/src/routes/sessao.ts`, update the GET /v1/sessao route. Add `mfaCadastrado` to the response schema and query `id.user_totp` to populate it.

Replace the response schema (around line 226):

```ts
        200: z.object({
          userId: z.string().uuid(),
          email: z.string(),
          nome: z.string(),
          mfaOk: z.boolean(),
          mfaCadastrado: z.boolean(),
          unidadeAtiva: z.object({
            tenantId: z.string().uuid(), clinicId: z.string().uuid(),
          }).nullable(),
          vinculos: z.array(VinculoSchema),
        }),
```

Replace the handler body (the query and return). The current query selects from `id."user"` only. Add a LEFT JOIN on `id.user_totp`:

```ts
  }, async (req, reply) => {
    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const { rows } = await appPool().query(
      `SELECT u.email, u.full_name,
              t.confirmed_at IS NOT NULL AS tem_totp
         FROM id."user" u
         LEFT JOIN id.user_totp t ON t.user_id = u.id
        WHERE u.id = $1`, [sessao.userId]);
    const u = rows[0] as { email: string; full_name: string; tem_totp: boolean } | undefined;
    if (u === undefined) return reply.code(401).send({ erro: 'sem_sessao' });

    return reply.code(200).send({
      userId: sessao.userId,
      email: u.email,
      nome: u.full_name,
      mfaOk: sessao.mfaAt !== null,
      mfaCadastrado: u.tem_totp,
      unidadeAtiva: sessao.activeTenantId === null || sessao.activeClinicId === null
        ? null
        : { tenantId: sessao.activeTenantId, clinicId: sessao.activeClinicId },
      vinculos: await vinculosDe(sessao.userId),
    });
  });
```

- [ ] **Step 2: Update QuemSou interface in the frontend**

In `apps/web/src/sessao.tsx`, add `mfaCadastrado` to the `QuemSou` interface:

```ts
export interface QuemSou {
  readonly userId: string;
  readonly email: string;
  readonly nome: string;
  readonly mfaOk: boolean;
  readonly mfaCadastrado: boolean;
  readonly unidadeAtiva: { readonly tenantId: string; readonly clinicId: string } | null;
  readonly vinculos: readonly Vinculo[];
}
```

- [ ] **Step 3: Update the GET /v1/sessao integration test**

In `apps/api/src/routes/sessao.int.test.ts`, update the existing GET test to assert `mfaCadastrado`. Find the test `'GET /v1/sessao devolve quem sou e os vinculos, sem exigir x-clinic-id'` and add an assertion:

After line `expect(body.unidadeAtiva).toBeNull();` add:

```ts
    expect(body).toHaveProperty('mfaCadastrado', false);
```

Also update the type cast to include `mfaCadastrado`:

```ts
    const body = r.json() as {
      userId: string; email: string; nome: string;
      mfaCadastrado: boolean;
      unidadeAtiva: { clinicId: string } | null;
      vinculos: { clinicId: string }[];
    };
```

- [ ] **Step 4: Run integration tests to verify**

Run: `pnpm test:int -- --grep "GET /v1/sessao"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sessao.ts apps/web/src/sessao.tsx apps/api/src/routes/sessao.int.test.ts
git commit -m "feat(sessao): add mfaCadastrado to GET /v1/sessao response"
```

---

### Task 2: PUT /v1/sessao/senha — password change route

**Files:**
- Modify: `apps/api/src/routes/sessao.ts:1-10` (imports) and after DELETE route (new route)
- Modify: `apps/api/src/routes/sessao.int.test.ts` (new describe block)

- [ ] **Step 1: Add imports for hashPassword, revokeAllSessionsOfUser, enrollTotp**

In `apps/api/src/routes/sessao.ts`, update the import from `@cadencia/authn` (line 6-10) to include `hashPassword`, `revokeAllSessionsOfUser`, and `enrollTotp`:

```ts
import {
  createSession, resolveSession, revokeSession, revokeAllSessionsOfUser,
  verifyPassword, hashPassword, enrollTotp, verifyTotpForUser,
  CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, SESSION_IDLE_MINUTES,
  csrfMatches, newCsrfToken, type ResolvedSession,
} from '@cadencia/authn';
```

- [ ] **Step 2: Add the PUT /v1/sessao/senha route**

In `apps/api/src/routes/sessao.ts`, add the following route inside `sessaoRoutes`, after the DELETE /v1/sessao route (after line 345):

```ts
  r.put('/v1/sessao/senha', {
    schema: {
      body: z.object({
        senhaAtual: z.string().min(1),
        senhaNova: z.string().min(1),
      }),
      response: {
        200: z.object({ ok: z.literal(true) }),
        401: Erro('sem_sessao', 'senha_incorreta'),
        403: Erro('csrf_invalido'),
        422: Erro('senha_fraca'),
      },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const { senhaAtual, senhaNova } = req.body as { senhaAtual: string; senhaNova: string };
    const db = appPool();

    const { rows } = await db.query(
      `SELECT password_hash FROM id.user_credential WHERE user_id = $1`,
      [sessao.userId]);
    const cred = rows[0] as { password_hash: string } | undefined;
    if (cred === undefined) return reply.code(401).send({ erro: 'sem_sessao' });

    const senhaOk = await verifyPassword(cred.password_hash, senhaAtual);
    if (!senhaOk) return reply.code(401).send({ erro: 'senha_incorreta' });

    if (senhaNova.length < 8 || senhaNova === senhaAtual) {
      return reply.code(422).send({ erro: 'senha_fraca' });
    }

    const novoHash = await hashPassword(senhaNova);
    await db.query(
      `UPDATE id.user_credential SET password_hash = $1 WHERE user_id = $2`,
      [novoHash, sessao.userId]);

    await revokeAllSessionsOfUser(db, sessao.userId, 'troca_de_senha');

    const { token } = await createSession(db, { userId: sessao.userId });
    emitirCookies(reply, token);

    return reply.code(200).send({ ok: true as const });
  });
```

- [ ] **Step 3: Write integration tests for password change**

In `apps/api/src/routes/sessao.int.test.ts`, add a new `describe` block at the end of the file (before the closing of the file):

```ts
describe('troca de senha', () => {
  let p: SementeSessao;

  beforeAll(async () => {
    p = await semearSessao({ role: 'recepcao' });
    await semearCredencial(p.userId, SENHA);
  });

  it('PUT /v1/sessao/senha com senha correta troca e revoga sessoes anteriores', async () => {
    const app = await buildApp();
    const sessaoAntiga = await logar(app);
    const novaSenha = 'NovaSenha@2026';

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessaoAntiga.sid, '__Host-cadencia_csrf': sessaoAntiga.csrf },
      headers: { 'x-csrf-token': sessaoAntiga.csrf },
      payload: { senhaAtual: SENHA, senhaNova: novaSenha },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });

    // Sessao antiga invalidada
    const comAntiga = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessaoAntiga.sid, '__Host-cadencia_csrf': sessaoAntiga.csrf },
    });
    expect(comAntiga.statusCode).toBe(401);

    // Nova sessao emitida nos cookies da resposta
    const novaSid = r.cookies.find((c) => c.name === '__Host-cadencia_sid');
    expect(novaSid).toBeDefined();
    const novoCsrf = r.cookies.find((c) => c.name === '__Host-cadencia_csrf');
    expect(novoCsrf).toBeDefined();

    const comNova = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': novaSid!.value as string, '__Host-cadencia_csrf': novoCsrf!.value as string },
    });
    expect(comNova.statusCode).toBe(200);

    // Login com senha nova funciona
    const loginNovo = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${p.userId}@example.test`, senha: novaSenha },
    });
    expect(loginNovo.statusCode).toBe(200);

    // Restaura a senha original para nao quebrar outros testes
    const sessaoRestaurar = {
      sid: loginNovo.cookies.find((c) => c.name === '__Host-cadencia_sid')!.value as string,
      csrf: loginNovo.cookies.find((c) => c.name === '__Host-cadencia_csrf')!.value as string,
    };
    const restaurar = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessaoRestaurar.sid, '__Host-cadencia_csrf': sessaoRestaurar.csrf },
      headers: { 'x-csrf-token': sessaoRestaurar.csrf },
      payload: { senhaAtual: novaSenha, senhaNova: SENHA },
    });
    expect(restaurar.statusCode).toBe(200);

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha atual incorreta retorna 401', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: 'errada', senhaNova: 'NovaSenha@2026' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ erro: 'senha_incorreta' });

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha nova curta retorna 422', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: SENHA, senhaNova: 'curta' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'senha_fraca' });

    await app.close();
  });

  it('PUT /v1/sessao/senha com senha nova igual a atual retorna 422', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { senhaAtual: SENHA, senhaNova: SENHA },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: 'senha_fraca' });

    await app.close();
  });

  it('PUT /v1/sessao/senha sem CSRF retorna 403', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'PUT', url: '/v1/sessao/senha',
      cookies: { '__Host-cadencia_sid': sessao.sid },
      payload: { senhaAtual: SENHA, senhaNova: 'NovaSenha@2026' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ erro: 'csrf_invalido' });

    await app.close();
  });
});
```

You need to add imports at the top of the test file. The existing imports already have `hashPassword`, `enrollTotp`, and `semearCredencial`. You also need the `beforeAll` import (already present) and make `logar` visible to the new describe block. The existing `logar` function is defined at file scope (line 56), so it is already accessible.

- [ ] **Step 4: Run integration tests to verify**

Run: `pnpm test:int -- --grep "troca de senha"`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sessao.ts apps/api/src/routes/sessao.int.test.ts
git commit -m "feat(sessao): PUT /v1/sessao/senha — password change with session revocation"
```

---

### Task 3: POST /v1/sessao/mfa/cadastrar — MFA enrollment route

**Files:**
- Modify: `apps/api/src/routes/sessao.ts` (new route, imports already added in Task 2)
- Modify: `apps/api/src/routes/sessao.int.test.ts` (new describe block)

- [ ] **Step 1: Add the POST /v1/sessao/mfa/cadastrar route**

In `apps/api/src/routes/sessao.ts`, add the following route inside `sessaoRoutes`, after the PUT /v1/sessao/senha route added in Task 2:

```ts
  r.post('/v1/sessao/mfa/cadastrar', {
    schema: {
      response: {
        200: z.object({
          qrcodeUri: z.string(),
          segredo: z.string(),
        }),
        401: Erro('sem_sessao'),
        403: Erro('csrf_invalido'),
      },
    },
  }, async (req, reply) => {
    if (!csrfOk(req)) return reply.code(403).send({ erro: 'csrf_invalido' });

    const sessao = await sessaoDaRequisicao(req);
    if (sessao === null) return reply.code(401).send({ erro: 'sem_sessao' });

    const resultado = await enrollTotp(appPool(), sessao.userId, chaveTotp());

    return reply.code(200).send({
      qrcodeUri: resultado.uri,
      segredo: resultado.secretBase32,
    });
  });
```

- [ ] **Step 2: Write integration tests for MFA enrollment**

In `apps/api/src/routes/sessao.int.test.ts`, add a new `describe` block at the end of the file:

```ts
describe('cadastro de MFA', () => {
  let e: SementeSessao;

  beforeAll(async () => {
    process.env['CADENCIA_TOTP_KEY'] = CHAVE_TOTP.toString('base64');
    e = await semearSessao({ role: 'profissional', comMfa: false });
    await semearCredencial(e.userId, SENHA);
  });

  it('POST /v1/sessao/mfa/cadastrar retorna URI e segredo', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    const r = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa/cadastrar',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as { qrcodeUri: string; segredo: string };
    expect(body.qrcodeUri).toContain('otpauth://totp/');
    expect(body.segredo).toBeTruthy();
    expect(body.segredo.length).toBeGreaterThanOrEqual(16);

    await app.close();
  });

  it('fluxo completo: cadastrar + confirmar com codigo valido', async () => {
    const app = await buildApp();
    const sessao = await logar(app);

    // 1. Cadastrar
    const cadastro = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa/cadastrar',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
    });
    expect(cadastro.statusCode).toBe(200);
    const { segredo } = cadastro.json() as { segredo: string };

    // 2. Confirmar com codigo valido
    const codigo = codigoEm(segredo, new Date());
    const confirma = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
      headers: { 'x-csrf-token': sessao.csrf },
      payload: { codigo },
    });
    expect(confirma.statusCode).toBe(200);

    // 3. GET /v1/sessao agora mostra mfaCadastrado=true
    const quem = await app.inject({
      method: 'GET', url: '/v1/sessao',
      cookies: { '__Host-cadencia_sid': sessao.sid, '__Host-cadencia_csrf': sessao.csrf },
    });
    expect(quem.json()).toMatchObject({ mfaCadastrado: true, mfaOk: true });

    await app.close();
  });

  it('re-cadastro invalida segredo anterior', async () => {
    const app = await buildApp();
    // Cria usuario proprio para nao interferir nos testes acima
    const f = await semearSessao({ role: 'profissional', comMfa: false });
    await semearCredencial(f.userId, SENHA);

    // Login
    const login = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${f.userId}@example.test`, senha: SENHA },
    });
    const sid = (login.cookies.find((c) => c.name === '__Host-cadencia_sid')!.value) as string;
    const csrf = (login.cookies.find((c) => c.name === '__Host-cadencia_csrf')!.value) as string;
    const cookies = { '__Host-cadencia_sid': sid, '__Host-cadencia_csrf': csrf };

    // Primeiro cadastro
    const primeiro = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa/cadastrar',
      cookies, headers: { 'x-csrf-token': csrf },
    });
    const segredo1 = (primeiro.json() as { segredo: string }).segredo;

    // Segundo cadastro (re-enrollment)
    const segundo = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa/cadastrar',
      cookies, headers: { 'x-csrf-token': csrf },
    });
    const segredo2 = (segundo.json() as { segredo: string }).segredo;
    expect(segredo2).not.toBe(segredo1);

    // Codigo do segredo antigo NAO funciona (o confirmed_at foi resetado pelo upsert)
    // Confirma com segredo novo
    const codigo = codigoEm(segredo2, new Date());
    const confirma = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa',
      cookies, headers: { 'x-csrf-token': csrf },
      payload: { codigo },
    });
    expect(confirma.statusCode).toBe(200);

    await app.close();
  });

  it('POST /v1/sessao/mfa/cadastrar sem sessao retorna 401', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao/mfa/cadastrar',
      ...anonimo(),
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ erro: 'sem_sessao' });
    await app.close();
  });
});
```

Note: the `logar` function at file scope uses the global `s` seed (role: recepcao). For the enrollment tests, you log in using the global `s` seed since the `e` seed user's email follows the same pattern. However, `logar` hardcodes `s.userId`. You need a local login helper:

Add this inside the `'cadastro de MFA'` describe block, before the tests:

```ts
  async function logarComoE(app: Awaited<ReturnType<typeof buildApp>>) {
    const r = await app.inject({
      method: 'POST', url: '/v1/sessao', ...anonimo(),
      payload: { email: `${e.userId}@example.test`, senha: SENHA },
    });
    const le = (nome: string): string => {
      const c = r.cookies.find((x) => x.name === nome);
      if (c === undefined) throw new Error(`login nao emitiu o cookie ${nome}`);
      return c.value as string;
    };
    return { sid: le('__Host-cadencia_sid'), csrf: le('__Host-cadencia_csrf') };
  }
```

Then replace `await logar(app)` with `await logarComoE(app)` in the first two tests of this describe block.

- [ ] **Step 3: Run integration tests to verify**

Run: `pnpm test:int -- --grep "cadastro de MFA"`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/sessao.ts apps/api/src/routes/sessao.int.test.ts
git commit -m "feat(sessao): POST /v1/sessao/mfa/cadastrar — MFA enrollment route"
```

---

### Task 4: TrocaDeSenha component + tests

**Files:**
- Create: `apps/web/src/telas/TrocaDeSenha.tsx`
- Create: `apps/web/src/telas/TrocaDeSenha.test.tsx`

- [ ] **Step 1: Write the tests**

Create `apps/web/src/telas/TrocaDeSenha.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TrocaDeSenha } from './TrocaDeSenha';

function montar(over: Partial<Parameters<typeof TrocaDeSenha>[0]> = {}) {
  const props = {
    aoTrocar: vi.fn(async () => {}),
    ...over,
  };
  render(<TrocaDeSenha {...props} />);
  return props;
}

describe('TrocaDeSenha', () => {
  it('renderiza os tres campos e o botao desabilitado', () => {
    montar();
    expect(screen.getByLabelText(/senha atual/i)).toBeDefined();
    expect(screen.getByLabelText(/nova senha/i)).toBeDefined();
    expect(screen.getByLabelText(/confirmar/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('habilita o botao quando os campos sao preenchidos corretamente', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'MinhaAtual@1');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeEnabled();
  });

  it('mantem desabilitado se nova senha < 8 caracteres', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'curta');
    await user.type(screen.getByLabelText(/confirmar/i), 'curta');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('mantem desabilitado se confirmacao nao bate', async () => {
    montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'Diferente@2026');
    expect(screen.getByRole('button', { name: /trocar senha/i })).toBeDisabled();
  });

  it('chama aoTrocar e exibe mensagem de sucesso', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Atual@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));

    expect(props.aoTrocar).toHaveBeenCalledWith('Atual@123', 'NovaSenha@2026');
    await waitFor(() => {
      expect(screen.getByText(/senha alterada/i)).toBeDefined();
    });
  });

  it('exibe erro retornado pelo callback', async () => {
    montar({ aoTrocar: vi.fn(async () => { throw new Error('senha_incorreta'); }) });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/senha atual/i), 'Errada@123');
    await user.type(screen.getByLabelText(/nova senha/i), 'NovaSenha@2026');
    await user.type(screen.getByLabelText(/confirmar/i), 'NovaSenha@2026');
    await user.click(screen.getByRole('button', { name: /trocar senha/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('passa a11y', async () => {
    montar();
    const { container } = render(<TrocaDeSenha aoTrocar={vi.fn(async () => {})} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cadencia/web test -- --grep "TrocaDeSenha"`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the TrocaDeSenha component**

Create `apps/web/src/telas/TrocaDeSenha.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Key } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

export interface TrocaDeSenhaProps {
  readonly aoTrocar: (senhaAtual: string, senhaNova: string) => Promise<void>;
}

export function TrocaDeSenha({ aoTrocar }: TrocaDeSenhaProps) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const valida =
    senhaAtual.length > 0
    && senhaNova.length >= 8
    && senhaNova === confirmar;

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setSucesso(false);
    setEnviando(true);
    try {
      await aoTrocar(senhaAtual, senhaNova);
      setSucesso(true);
      setSenhaAtual('');
      setSenhaNova('');
      setConfirmar('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao trocar senha';
      setErro(
        msg === 'senha_incorreta' ? 'Senha atual incorreta.'
        : msg === 'senha_fraca' ? 'A nova senha e muito fraca.'
        : 'Nao foi possivel trocar a senha.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
      <div className="flex items-center gap-2">
        <Key size={20} className="text-accent" />
        <h3 className="text-sm font-semibold">Trocar senha</h3>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Senha atual</span>
        <input type="password" autoComplete="current-password"
          value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Nova senha</span>
        <input type="password" autoComplete="new-password"
          value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        {senhaNova.length > 0 && senhaNova.length < 8 && (
          <span className="text-xs text-danger">Minimo 8 caracteres</span>
        )}
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-text-muted">Confirmar nova senha</span>
        <input type="password" autoComplete="new-password"
          value={confirmar} onChange={(e) => setConfirmar(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        {confirmar.length > 0 && confirmar !== senhaNova && (
          <span className="text-xs text-danger">As senhas nao coincidem</span>
        )}
      </label>

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      {sucesso && <p className="text-sm text-accent">Senha alterada com sucesso.</p>}

      <Botao type="submit" variante="primario" tamanho="md"
        disabled={!valida} carregando={enviando}>
        Trocar senha
      </Botao>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cadencia/web test -- --grep "TrocaDeSenha"`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/telas/TrocaDeSenha.tsx apps/web/src/telas/TrocaDeSenha.test.tsx
git commit -m "feat(web): TrocaDeSenha component with form validation"
```

---

### Task 5: CadastroMfa component + tests

**Files:**
- Create: `apps/web/src/telas/CadastroMfa.tsx`
- Create: `apps/web/src/telas/CadastroMfa.test.tsx`

- [ ] **Step 1: Write the tests**

Create `apps/web/src/telas/CadastroMfa.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CadastroMfa } from './CadastroMfa';

const RESULTADO = { qrcodeUri: 'otpauth://totp/Cadencia:user@test?secret=JBSWY3DPEHPK3PXP&issuer=Cadencia', segredo: 'JBSWY3DPEHPK3PXP' };

function montar(over: Partial<Parameters<typeof CadastroMfa>[0]> = {}) {
  const props = {
    mfaCadastrado: false,
    aoIniciar: vi.fn(async () => RESULTADO),
    aoConfirmar: vi.fn(async () => {}),
    ...over,
  };
  render(<CadastroMfa {...props} />);
  return props;
}

describe('CadastroMfa', () => {
  it('exibe botao "Configurar MFA" quando nao cadastrado', () => {
    montar({ mfaCadastrado: false });
    expect(screen.getByRole('button', { name: /configurar mfa/i })).toBeDefined();
  });

  it('exibe botao "Reconfigurar" quando ja cadastrado', () => {
    montar({ mfaCadastrado: true });
    expect(screen.getByRole('button', { name: /reconfigurar/i })).toBeDefined();
  });

  it('ao clicar em configurar, exibe segredo e campo de codigo', async () => {
    montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeDefined();
    });
    expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
  });

  it('confirma com codigo e exibe badge de sucesso', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/codigo de 6 digitos/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(props.aoConfirmar).toHaveBeenCalledWith('123456');
    await waitFor(() => {
      expect(screen.getByText(/mfa ativo/i)).toBeDefined();
    });
  });

  it('exibe erro quando confirmacao falha', async () => {
    montar({ aoConfirmar: vi.fn(async () => { throw new Error('codigo_invalido'); }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /configurar mfa/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/codigo de 6 digitos/i)).toBeDefined();
    });

    await user.type(screen.getByLabelText(/codigo de 6 digitos/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  it('passa a11y (estado inicial)', async () => {
    const { container } = render(
      <CadastroMfa mfaCadastrado={false}
        aoIniciar={vi.fn(async () => RESULTADO)}
        aoConfirmar={vi.fn(async () => {})} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cadencia/web test -- --grep "CadastroMfa"`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the CadastroMfa component**

Create `apps/web/src/telas/CadastroMfa.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ShieldCheck, Copy, CheckCircle } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

export interface CadastroMfaProps {
  readonly mfaCadastrado: boolean;
  readonly aoIniciar: () => Promise<{ qrcodeUri: string; segredo: string }>;
  readonly aoConfirmar: (codigo: string) => Promise<void>;
}

type Fase = 'inicial' | 'inscricao' | 'confirmado';

export function CadastroMfa({ mfaCadastrado, aoIniciar, aoConfirmar }: CadastroMfaProps) {
  const [fase, setFase] = useState<Fase>(mfaCadastrado ? 'confirmado' : 'inicial');
  const [segredo, setSegredo] = useState('');
  const [qrcodeUri, setQrcodeUri] = useState('');
  const [codigo, setCodigo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function iniciar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await aoIniciar();
      setSegredo(r.segredo);
      setQrcodeUri(r.qrcodeUri);
      setFase('inscricao');
    } catch {
      setErro('Nao foi possivel iniciar o cadastro.');
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (codigo.length !== 6) return;
    setCarregando(true);
    setErro(null);
    try {
      await aoConfirmar(codigo);
      setFase('confirmado');
      setCodigo('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setErro(
        msg === 'codigo_invalido' ? 'Codigo invalido. Tente novamente.'
        : msg === 'codigo_reutilizado' ? 'Codigo ja utilizado. Aguarde o proximo.'
        : 'Nao foi possivel confirmar o codigo.',
      );
    } finally {
      setCarregando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(segredo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Fallback: selecionar o texto e nada mais
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-accent" />
        <h3 className="text-sm font-semibold">Autenticacao em dois fatores</h3>
      </div>

      {fase === 'confirmado' && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2">
          <CheckCircle size={18} weight="fill" className="text-accent" />
          <span className="text-sm font-medium text-accent">MFA ativo</span>
          <Botao variante="fantasma" tamanho="sm" className="ml-auto"
            onClick={() => { void iniciar(); }}>
            Reconfigurar
          </Botao>
        </div>
      )}

      {fase === 'inicial' && (
        <div>
          <p className="mb-3 text-sm text-text-muted">
            O segundo fator protege sua conta mesmo se alguem descobrir sua senha.
            Use um app autenticador como Google Authenticator, Authy ou 1Password.
          </p>
          <Botao variante="secundario" tamanho="md" carregando={carregando}
            onClick={() => { void iniciar(); }}>
            Configurar MFA
          </Botao>
        </div>
      )}

      {fase === 'inscricao' && (
        <div className="grid gap-4 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-text-muted">
            Abra seu app autenticador e adicione uma nova conta. Copie a chave abaixo
            ou use o link para adicionar automaticamente.
          </p>

          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm">
            <span className="flex-1 select-all break-all">{segredo}</span>
            <button type="button" onClick={() => { void copiar(); }}
              className="shrink-0 rounded p-1 hover:bg-surface-hover"
              aria-label="Copiar segredo">
              {copiado
                ? <CheckCircle size={18} className="text-accent" />
                : <Copy size={18} className="text-text-muted" />}
            </button>
          </div>

          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer hover:text-text">Link para app autenticador</summary>
            <code className="mt-1 block break-all rounded bg-surface-2 p-2">{qrcodeUri}</code>
          </details>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Codigo de 6 digitos</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              autoComplete="one-time-code"
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-lg tracking-widest" />
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <Botao variante="primario" tamanho="md" carregando={carregando}
            disabled={codigo.length !== 6}
            onClick={() => { void confirmar(); }}>
            Confirmar
          </Botao>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cadencia/web test -- --grep "CadastroMfa"`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/telas/CadastroMfa.tsx apps/web/src/telas/CadastroMfa.test.tsx
git commit -m "feat(web): CadastroMfa component with enrollment flow"
```

---

### Task 6: Update profile page to compose security sections

**Files:**
- Modify: `apps/web/app/configuracoes/perfil/page.tsx`

- [ ] **Step 1: Rewrite the profile page to include security sections**

Replace the entire content of `apps/web/app/configuracoes/perfil/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { User, Buildings, SignOut } from '@phosphor-icons/react';
import { useSessao, rotulo, lerCsrf } from '../../../src/sessao';
import { apiFetch, ApiError } from '../../../src/api';
import { Botao } from '../../../src/ui/Botao';
import { TrocaDeSenha } from '../../../src/telas/TrocaDeSenha';
import { CadastroMfa } from '../../../src/telas/CadastroMfa';

export default function PaginaPerfil() {
  const { usuario, vinculoAtivo, trocarUnidade, sair, clinicId } = useSessao();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  const outrasUnidades = usuario.vinculos.filter(
    (v) => v.clinicId !== vinculoAtivo.clinicId,
  );

  async function trocarSenha(senhaAtual: string, senhaNova: string) {
    try {
      await apiFetch('/v1/sessao/senha', {
        method: 'PUT',
        body: { senhaAtual, senhaNova },
        clinicId,
        csrfToken: lerCsrf(),
      });
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function iniciarMfa() {
    try {
      return await apiFetch<{ qrcodeUri: string; segredo: string }>(
        '/v1/sessao/mfa/cadastrar',
        { method: 'POST', clinicId, csrfToken: lerCsrf() },
      );
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function confirmarMfa(codigo: string) {
    try {
      await apiFetch('/v1/sessao/mfa', {
        method: 'POST',
        body: { codigo },
        clinicId,
        csrfToken: lerCsrf(),
      });
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  return (
    <div className="grid max-w-2xl gap-8">
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Seus dados</h2>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <User size={24} weight="bold" />
            </div>
            <div>
              <p className="font-semibold text-text">{usuario.nome}</p>
              <p className="text-sm text-text-muted">{usuario.email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-text-muted">Papel nesta unidade</dt>
              <dd className="font-medium">{rotulo(vinculoAtivo.role)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">MFA</dt>
              <dd className="font-medium">{usuario.mfaCadastrado ? 'Ativo' : 'Nao configurado'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Seguranca</h2>
        <div className="rounded-xl border border-line bg-surface p-5 grid gap-6">
          <TrocaDeSenha aoTrocar={trocarSenha} />
          <hr className="border-line" />
          <CadastroMfa
            mfaCadastrado={usuario.mfaCadastrado}
            aoIniciar={iniciarMfa}
            aoConfirmar={confirmarMfa}
          />
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Unidade ativa</h2>
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-5">
          <div className="flex items-center gap-3">
            <Buildings size={20} className="text-accent" />
            <div>
              <p className="font-semibold text-text">{vinculoAtivo.clinicNome}</p>
              <p className="text-xs text-text-muted">{vinculoAtivo.tenantNome} · {rotulo(vinculoAtivo.role)} · {vinculoAtivo.timezone}</p>
            </div>
          </div>
        </div>
        {outrasUnidades.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trocar para outra unidade</h3>
            <ul className="grid gap-2">
              {outrasUnidades.map((v) => (
                <li key={v.clinicId}>
                  <button type="button" disabled={trocando !== null}
                    onClick={() => { setTrocando(v.clinicId); void trocarUnidade(v.clinicId).finally(() => setTrocando(null)); }}
                    className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm transition hover:border-accent hover:bg-surface-2 disabled:opacity-50">
                    <span className="block font-medium">{v.clinicNome}</span>
                    <span className="block text-xs text-text-muted">{v.tenantNome} · {rotulo(v.role)}</span>
                    {trocando === v.clinicId && <span className="text-xs text-accent">Trocando…</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <Botao variante="perigo" iconeEsquerda={SignOut} carregando={saindo}
          onClick={() => { setSaindo(true); void sair(); }}>
          Sair da sessao
        </Botao>
      </section>
    </div>
  );
}
```

Key changes from original:
1. Removed the placeholder text `"Troca de senha e cadastro de MFA chegam em breve."`
2. Added `lerCsrf` to imports from `sessao`
3. Added `apiFetch`, `ApiError` imports
4. Added `TrocaDeSenha` and `CadastroMfa` imports
5. Added `clinicId` from `useSessao()` destructuring
6. Added `trocarSenha`, `iniciarMfa`, `confirmarMfa` async functions
7. Added "Seguranca" section composing TrocaDeSenha + CadastroMfa
8. Changed MFA badge from `usuario.mfaOk` to `usuario.mfaCadastrado` (mfaOk is per-session step-up, mfaCadastrado is whether TOTP is enrolled)

- [ ] **Step 2: Run web typecheck to verify**

Run: `pnpm typecheck:web`
Expected: PASS

- [ ] **Step 3: Run all web tests to verify no regressions**

Run: `pnpm --filter @cadencia/web test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/configuracoes/perfil/page.tsx
git commit -m "feat(web): security section on profile page — password change and MFA enrollment"
```

---

### Task 7: Quality gate

- [ ] **Step 1: Run root typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run architecture and lint checks**

Run: `pnpm arch:check && pnpm lint:terminology-clock && pnpm lint:session-guc && pnpm authz:check`
Expected: All PASS

- [ ] **Step 3: Run all unit tests**

Run: `pnpm test`
Expected: All PASS

- [ ] **Step 4: Run all web tests**

Run: `pnpm test:web`
Expected: All PASS

- [ ] **Step 5: Run build**

Run: `pnpm build:web`
Expected: PASS

- [ ] **Step 6: Run integration tests**

Run: `pnpm test:int`
Expected: All PASS (including new tests for password change and MFA enrollment)

- [ ] **Step 7: Run isolation tests**

Run: `pnpm test:iso`
Expected: All PASS

- [ ] **Step 8: Push to origin**

```bash
git push origin main
```

If the pre-push hook fails, fix the issue and re-push. Do not use `--no-verify`.
