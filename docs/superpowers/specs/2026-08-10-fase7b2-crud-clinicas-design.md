# Fase 7B-2 — CRUD de clinicas — design

**Data:** 2026-08-10
**Status:** aprovado para execucao
**Pre-requisito:** Fase 7B-1 completa (gestao de equipe)
**Roadmap:** Fase 7 Bloco B, sub-entrega 2 de 5

## 1. O problema

O sistema assume que cada tenant ja tem clinicas pre-provisionadas via SQL
direto (seed ou migrations). Nao existe rota para criar clinicas, e os campos
CNES e CNPJ aparecem como somente-leitura no frontend embora o PUT backend ja
os aceite. Um admin que precisa abrir uma segunda unidade nao consegue faze-lo
pela interface.

## 2. Escopo

Duas capacidades novas + uma correcao de UX:

1. **Listar clinicas do tenant** — endpoint que retorna todas as unidades
2. **Criar clinica** — POST que cria a unidade + auto-membership do admin
3. **Editar CNES/CNPJ** — tornar os campos editaveis no frontend (o backend ja aceita)

### 2.1 Listar clinicas do tenant

```
GET /v1/configuracoes/clinicas
Headers: x-csrf-token, Cookie, x-clinic-id

200: { itens: [{ clinicId, nome, cnpj, cnes, timezone }] }
```

**Fluxo:**

1. Guard `rota('clinic.read', ...)`.
2. SELECT id, nome, cnpj, cnes, timezone FROM app.clinic WHERE tenant_id =
   current_tenant_id() ORDER BY nome.
3. Retorna array de clinicas.

A RLS `tenant_isolation` em `app.clinic` ja garante isolamento por tenant. O
predicado `is_member()` garante que o usuario tem pelo menos um vinculo ativo
no tenant.

### 2.2 Criar clinica

```
POST /v1/configuracoes/clinicas
Content-Type: application/json
Headers: x-csrf-token, Cookie, x-clinic-id

Body:
  {
    nome: string,          // 2-120 chars
    timezone: string,      // validado contra pg_timezone_names
    cnpj?: string,         // regex /^[A-Z0-9]{12}[0-9]{2}$/
    cnes?: string          // regex /^\d{7}$/
  }

201: { clinicId: string }
422: { erro: 'fuso_invalido' }
```

**Fluxo:**

1. Guard `rota('clinic.create', ...)` — verifica sessao, CSRF, MFA, role
   admin_clinico.
2. Valida body (Zod).
3. Valida timezone contra `pg_timezone_names` — 422 `fuso_invalido` se
   invalido.
4. Gera `clinic_id = uuidv7()`.
5. INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone).
   - `tenant_id` vem de `app.require_tenant_id()` (default da coluna).
6. INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role,
   granted_by).
   - role = 'admin_clinico'
   - user_id = ctx.actor.userId
   - granted_by = ctx.actor.userId
   - Garante que o criador tem acesso imediato a nova unidade.
7. Auditoria via `audit.log('CLINIC_CREATE', ...)`.
8. Retorna `{ clinicId }`.

**Decisoes:**

- **Sem SECURITY DEFINER.** Os dois INSERTs passam pela RLS de `app_rw`
  normalmente: o INSERT em `app.clinic` satisfaz `tenant_id =
  require_tenant_id() AND is_member()` (o admin ja e membro do tenant via
  outra clinica). O INSERT em `app.membership` satisfaz `tenant_id =
  current_tenant_id() AND user_id = current_user_id()` (o admin esta
  criando o proprio vinculo).
- **Sem limite de clinicas.** YAGNI. Se precisar limitar no futuro, um
  check no plano/billing e a abordagem correta, nao um hard-cap no codigo.
- **Auto-membership obrigatorio.** Sem ele, a nova clinica seria orfao —
  ninguem teria acesso para gerencia-la.

### 2.3 Editar CNES/CNPJ

A rota `PUT /v1/configuracoes/clinica` ja aceita `cnes` e `cnpj` opcionais
no body e usa `coalesce($4, cnes)` para atualizar sem apagar. Nao ha mudanca
no backend.

No frontend, os campos CNES e CNPJ passam de `<dd>` read-only para `<input>`
editaveis (visiveis apenas para admin_clinico/diretor_tecnico). O form
existente passa a enviar `cnes` e `cnpj` no PUT quando preenchidos.

## 3. Nova acao authz

```
{ key: 'clinic.create', description: 'Criar nova unidade',
  roles: ['admin_clinico'], requiresMfa: true }
```

Inserida logo apos `clinic.write` em `packages/authz/src/actions.ts`.

## 4. Auditoria

A acao `CLINIC_CREATE` precisa da chave `clinic_id` na whitelist de
`audit.meta_keys_ok`. A migration adiciona essa chave a funcao.

O PUT existente nao faz `audit.log` — nao adicionaremos agora para manter
o escopo minimo. A chave `clinic_id` registrada nesta migration serve o
POST de criacao.

## 5. Frontend

### 5.1 Secao "Todas as unidades"

Adicionar ao topo de `apps/web/app/configuracoes/page.tsx`, acima da secao
"Unidade" existente, uma secao listando todas as clinicas do tenant:

- Tabela compacta: Nome, CNES, Fuso.
- A clinica ativa e destacada (ex: badge "ativa").
- Botao "Criar unidade" (visivel apenas para admin_clinico).

### 5.2 Modal de criacao

Componente `CriarClinica` em `apps/web/src/telas/CriarClinica.tsx`:

- Campos: nome (required, min 2), timezone (select com FUSOS brasileiros),
  cnpj (optional, masked), cnes (optional, masked).
- Validacao client-side: nome nao vazio, timezone selecionado.
- Callback `aoCriar(dados)` retorna `{ clinicId }`.
- Erro inline: `fuso_invalido`.

### 5.3 CNES/CNPJ editaveis

No form existente de `page.tsx`:

- Substituir o `<dl>` read-only por inputs condicionais:
  - Se `podeEditar`: inputs com mascara/regex.
  - Senao: manter o `<dd>` read-only atual.
- O form passa a incluir `cnes` e `cnpj` no body do PUT.

### 5.4 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| `CriarClinica` | `apps/web/src/telas/CriarClinica.tsx` | Modal de criacao |
| `ListaClinicas` | `apps/web/src/telas/ListaClinicas.tsx` | Tabela de unidades |

Props baseadas em callbacks (`aoCriar`) para facilitar testes unitarios.

## 6. Testes

### 6.1 Integracao (API)

Adicionar a `configuracoes.int.test.ts`:

**Listar:**
- GET /v1/configuracoes/clinicas retorna ao menos a clinica da sessao.

**Criar:**
- Criar clinica com dados validos: 201, clinica e membership criados.
- Criar clinica com timezone invalido: 422 `fuso_invalido`.
- Criar clinica sem permissao (role recepcao): 403.
- Apos criar, GET /v1/configuracoes/clinicas inclui a nova clinica.

**Editar CNES/CNPJ:**
- PUT com cnes e cnpj: 200, valores atualizados.
- PUT com cnes invalido (regex fail): 400 (Zod validation).

### 6.2 Unitario (Web)

**ListaClinicas:**
- Renderiza lista de clinicas.
- Destaca a clinica ativa.
- Botao "Criar unidade" visivel apenas para admin_clinico.
- Passa a11y.

**CriarClinica:**
- Campos obrigatorios presentes.
- Botao desabilitado com nome vazio.
- Chamada de `aoCriar` com dados corretos.
- Erro inline em caso de falha.
- Passa a11y.

**Pagina (CNES/CNPJ editaveis):**
- Inputs visiveis para admin_clinico.
- Read-only para outros roles.

## 7. Fora de escopo

- Deletar ou desativar clinicas (muitas FKs, alta complexidade).
- Campos de endereco, telefone, logotipo (podem ser adicionados depois).
- Seletor de clinica ativa no header/sidebar (UX de navegacao, nao CRUD).
- Limite de clinicas por tenant (billing/plano, nao cabe aqui).
- Audit no PUT existente (ja funciona sem; pode ser adicionado depois).
