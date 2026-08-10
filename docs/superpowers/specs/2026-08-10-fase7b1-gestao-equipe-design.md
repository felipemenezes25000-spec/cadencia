# Fase 7B-1 — Gestao de equipe — design

**Data:** 2026-08-10
**Status:** aprovado para execucao
**Pre-requisito:** Fase 7A completa (troca de senha + cadastro de MFA)
**Roadmap:** Fase 7 Bloco B, sub-entrega 1 de 5

## 1. O problema

O app nao oferece interface para convidar usuarios, revogar acessos ou
desativar MFA por admin. Hoje essas operacoes sao feitas diretamente no banco
por quem administra o tenant. A tela de configuracoes exibe um placeholder:
*"Conceder e revogar acesso ainda e feito por quem administra o tenant."*

Os primitivos de banco ja existem: `app.membership` tem colunas `granted_by`,
`revoked_at` e `revoked_reason` (migration 0016); `id.user_totp` armazena
TOTP; `app.equipe_da_unidade()` lista a equipe. Mas nenhuma rota permite que
um `admin_clinico` execute essas operacoes pela interface.

## 2. Escopo

Tres capacidades novas, todas restritas ao role `admin_clinico` da clinica
ativa:

1. **Convidar usuario** — criar usuario + credencial + vinculo
2. **Revogar acesso** — soft-revoke do vinculo
3. **Desativar MFA por admin** — remover TOTP de outro usuario

### 2.1 Convidar usuario

```
POST /v1/configuracoes/equipe
Content-Type: application/json
Headers: x-csrf-token, Cookie, x-clinic-id

Body:
  {
    email: string,
    nome: string,
    role: 'admin_clinico' | 'diretor_tecnico' | 'profissional' | 'recepcao' | 'financeiro',
    senhaTemporaria: string,       // min 8 chars
    cpf?: string,                  // 11 digitos
    conselho?: string,             // codigo TISS (ex: '06' = CRM)
    numeroConselho?: string,       // ex: '12345'
    ufConselho?: string,           // ex: 'SP'
    cbos?: string                  // codigo CBOS, opcional
  }

201: { userId: string, membershipId: string }
409: { erro: 'vinculo_duplicado' }
422: { erro: 'senha_fraca' | 'role_invalido' | 'dados_profissionais_obrigatorios' }
```

**Fluxo:**

1. Guard `rota('membership.grant', ...)` — verifica sessao, CSRF, MFA, role
   admin_clinico.
2. Valida body:
   - `senhaTemporaria` >= 8 caracteres.
   - Se role e `profissional` ou `diretor_tecnico`, campos `conselho`,
     `numeroConselho` e `ufConselho` sao obrigatorios — 422
     `dados_profissionais_obrigatorios` se ausentes.
3. Hash da senha temporaria via `hashPassword()`.
4. Chama `app.conceder_vinculo(...)` (SECURITY DEFINER):
   - INSERT INTO `id."user"` (email, full_name, cpf, status='ativo')
     ON CONFLICT (email) DO NOTHING — pega o ID existente.
   - INSERT INTO `id.user_credential` (user_id, password_hash)
     ON CONFLICT (user_id) DO NOTHING — nao sobrescreve credencial existente.
   - INSERT INTO `app.membership` (tenant_id, id, user_id, clinic_id, role,
     granted_by) — falha com unique violation se vinculo ativo ja existe.
   - Se role e `profissional` ou `diretor_tecnico`: INSERT INTO
     `app.professional` ON CONFLICT (tenant_id, user_id) DO UPDATE SET
     conselho, numero, uf, cbos.
   - Retorna (user_id, membership_id).
5. Se unique violation em membership: 409 `vinculo_duplicado`.
6. Auditoria via `logDomainEvent`.
7. Retorna `{ userId, membershipId }`.

**Decisoes:**

- **Sem email automatico.** Nao ha infraestrutura de email transacional (Fase
  8). O admin comunica a senha temporaria ao usuario fora do sistema. O
  usuario troca via "Trocar senha" no perfil (implementado em 7A).
- **Credencial nao sobrescrita.** Se o usuario ja existe (email em uso por
  outro tenant), o INSERT em `id.user_credential` faz ON CONFLICT DO NOTHING.
  O usuario usa sua senha existente; a temporaria e ignorada. Isso evita que
  um admin de um tenant resete a senha de um usuario de outro tenant.
- **Mudanca de role = revogar + convidar.** Nao ha endpoint de edicao. Para
  trocar o role de um membro, o admin revoga o vinculo atual e cria um novo.

### 2.2 Revogar acesso

```
DELETE /v1/configuracoes/equipe/:userId/role/:role
Content-Type: application/json
Headers: x-csrf-token, Cookie, x-clinic-id

Body:
  { motivo?: string }

200: { ok: true }
404: { erro: 'vinculo_nao_encontrado' }
422: { erro: 'auto_revogacao' }
```

**Fluxo:**

1. Guard `rota('membership.revoke', ...)`.
2. Se `userId === ctx.actor.userId` e role corresponde ao vinculo ativo do
   admin: 422 `auto_revogacao` (admin nao pode revogar a si mesmo).
3. Chama `app.revogar_vinculo(clinic_id, user_id, role, motivo)` (SECURITY
   DEFINER):
   - UPDATE `app.membership` SET `revoked_at = clock_timestamp()`,
     `revoked_reason = motivo` WHERE tenant_id, clinic_id, user_id, role
     AND revoked_at IS NULL.
   - Retorna o numero de linhas afetadas.
4. Se 0 linhas: 404 `vinculo_nao_encontrado`.
5. Auditoria via `logDomainEvent`.
6. Retorna `{ ok: true }`.

**Decisao: nao revogar sessoes imediatamente.** O guard `comTransacao`
verifica memberships em cada requisicao. Quando o vinculo e revogado, a
proxima requisicao do usuario para aquela clinica falha com `sem_vinculo`.
Revogar sessoes explicitamente seria correto mas adiciona complexidade
(precisaria identificar sessoes por clinica ativa, e o usuario pode ter
multiplos vinculos no tenant). A abordagem lazy e segura e mais simples.

### 2.3 Desativar MFA por admin

```
DELETE /v1/configuracoes/equipe/:userId/mfa
Content-Type: application/json
Headers: x-csrf-token, Cookie, x-clinic-id

Body: {}

200: { ok: true }
404: { erro: 'mfa_nao_cadastrado' }
422: { erro: 'auto_desativacao' }
```

**Fluxo:**

1. Guard `rota('mfa.admin_disable', ...)`.
2. Se `userId === ctx.actor.userId`: 422 `auto_desativacao` (admin deve
   reconfigurar via perfil, nao desativar).
3. Verifica que o usuario alvo tem vinculo ativo na clinica (via
   `equipe_da_unidade`) — impede que admin desative MFA de usuario de outra
   clinica.
4. Chama `id.desativar_totp_admin(user_id)` (SECURITY DEFINER):
   - DELETE FROM `id.user_totp` WHERE user_id = $1.
   - Retorna o numero de linhas deletadas.
5. Se 0 linhas: 404 `mfa_nao_cadastrado`.
6. Auditoria via `logDomainEvent`.
7. Retorna `{ ok: true }`.

**Nova acao no catalogo authz:**

```
{ key: 'mfa.admin_disable', description: 'Desativar MFA de outro usuario',
  roles: ['admin_clinico'], requiresMfa: true }
```

## 3. Camada de banco

### 3.1 Novo role: `id_equipe`

Role NOLOGIN com grants minimos para as 3 SECURITY DEFINER functions. Grants:

- SELECT, INSERT ON `id."user"` — para criar usuario
- SELECT, INSERT ON `id.user_credential` — para criar credencial
- SELECT, INSERT, UPDATE ON `app.membership` — para conceder e revogar
- SELECT, INSERT, UPDATE ON `app.professional` — para registrar profissional
- DELETE ON `id.user_totp` — para desativar MFA
- SELECT ON `app.clinic` — para verificar clinic_id
- EXECUTE ON `app.current_tenant_id()`, `app.current_user_id()` — para
  derivar contexto

RLS policies com `USING (true)` para `id_equipe` nas tabelas necessarias
(seguro porque o role e NOLOGIN e so e usado via SECURITY DEFINER).

### 3.2 SECURITY DEFINER functions

**`app.conceder_vinculo`:**

```sql
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
```

Owner: `id_equipe`. Execute granted to `app_rw`.

Tenant derivado internamente via `app.current_tenant_id()`. `granted_by`
derivado via `app.current_user_id()`. Nenhum dos dois e parametro — impossivel
forjar a partir do caller.

**`app.revogar_vinculo`:**

```sql
CREATE FUNCTION app.revogar_vinculo(
  p_clinic_id uuid,
  p_user_id   uuid,
  p_role      text,
  p_motivo    text DEFAULT NULL
)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = app, pg_catalog
```

Owner: `id_equipe`. Execute granted to `app_rw`.

**`id.desativar_totp_admin`:**

```sql
CREATE FUNCTION id.desativar_totp_admin(p_user_id uuid)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = id, pg_catalog
```

Owner: `id_equipe`. Execute granted to `app_rw`.

### 3.3 Atualizar equipe_da_unidade

Adicionar `tem_totp boolean` ao retorno de `app.equipe_da_unidade()` via LEFT
JOIN em `id.user_totp WHERE confirmed_at IS NOT NULL`. Necessario para o
frontend decidir se exibe o botao "Desativar MFA".

Requer grant de SELECT ON `id.user_totp` ao role `id_login` (owner da
funcao), com policy `USING (true)`.

### 3.4 Auditoria

As chaves de auditoria para `membership.grant`, `membership.revoke` e
`mfa.admin_disable` precisam ser registradas em `ref.audit_meta_key`. Uma
migration dedicada insere as chaves e suas labels.

## 4. Frontend

### 4.1 Nova aba "Equipe"

Adicionar "Equipe" a lista de abas em
`apps/web/app/configuracoes/layout.tsx`. Criar
`apps/web/app/configuracoes/equipe/page.tsx`.

Migrar a tabela de equipe do `configuracoes/page.tsx` atual para a nova
pagina. Remover a secao de equipe e o placeholder do page.tsx da clinica.

### 4.2 Tabela de equipe (atualizada)

Colunas: Pessoa (nome + email), Papel, Registro, Desde, Acoes.

Coluna "Acoes" (visivel apenas para `admin_clinico`):
- Botao "Revogar" — abre confirmacao inline com campo opcional de motivo.
  Oculto para a propria linha do admin.
- Botao "Desativar MFA" — abre confirmacao inline. Visivel apenas se
  `temTotp === true`. Oculto para a propria linha.

### 4.3 Modal de convite

Componente `ConvidarUsuario`:
- Campos fixos: email, nome completo, role (select), senha temporaria.
- Campos condicionais (role profissional ou diretor_tecnico): conselho
  (select), numero do conselho, UF do conselho, CBOS (opcional).
- Validacao client-side: email valido, nome nao vazio, senha >= 8 chars,
  campos profissionais preenchidos se role exige.
- Erro inline: `vinculo_duplicado` → "Este usuario ja tem esse papel nesta
  unidade."

### 4.4 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| `ConvidarUsuario` | `apps/web/src/telas/ConvidarUsuario.tsx` | Modal de convite |
| `TabelaEquipe` | `apps/web/src/telas/TabelaEquipe.tsx` | Tabela com acoes |

Props baseadas em callbacks (`aoConvidar`, `aoRevogar`, `aoDesativarMfa`) para
facilitar testes unitarios com mocks.

## 5. Testes

### 5.1 Integracao (API)

Adicionar a `configuracoes.int.test.ts` (ou criar se nao existir):

**Convite:**
- Convite com dados validos: 201, usuario e membership criados.
- Convite de profissional sem dados de conselho: 422
  `dados_profissionais_obrigatorios`.
- Convite duplicado (mesmo email + role + clinica): 409 `vinculo_duplicado`.
- Convite de usuario existente (email ja registrado): 201, reutiliza user_id,
  nao sobrescreve credencial.
- Senha temporaria < 8 chars: 422 `senha_fraca`.
- Sem permissao (role recepcao tentando convidar): 403.

**Revogacao:**
- Revogar vinculo ativo: 200, `revoked_at` preenchido.
- Revogar vinculo inexistente: 404.
- Auto-revogacao: 422 `auto_revogacao`.
- Apos revogar, requisicao do usuario revogado para a clinica falha.

**MFA admin disable:**
- Desativar MFA de usuario com TOTP: 200, `id.user_totp` deletado.
- Desativar MFA de usuario sem TOTP: 404 `mfa_nao_cadastrado`.
- Auto-desativacao: 422 `auto_desativacao`.

### 5.2 Isolamento (banco)

Testar as SECURITY DEFINER functions:
- `conceder_vinculo`: cria user + credential + membership + professional.
- `conceder_vinculo` com email existente: reutiliza user, ON CONFLICT.
- `revogar_vinculo`: seta revoked_at, retorna 1.
- `revogar_vinculo` de vinculo ja revogado: retorna 0.
- `desativar_totp_admin`: deleta user_totp, retorna 1.
- Tenant isolation: funcao nao afeta dados de outro tenant.

### 5.3 Unitario (Web)

**TabelaEquipe:**
- Renderiza colunas incluindo acoes.
- Botao "Revogar" oculto para a propria linha.
- Botao "Desativar MFA" visivel apenas se temTotp.
- Chamada de `aoRevogar` com confirmacao.
- Chamada de `aoDesativarMfa` com confirmacao.
- Passa a11y.

**ConvidarUsuario:**
- Campos profissionais aparecem ao selecionar role profissional.
- Botao desabilitado com campos vazios.
- Chamada de `aoConvidar` com dados corretos.
- Erro inline em caso de falha.
- Passa a11y.

## 6. Fora de escopo

- Email de convite automatico (Fase 8 — email transacional).
- Flag `must_change_password` / troca forcada no primeiro login.
- Editar dados de membro existente (role change = revogar + convidar novo).
- Bulk import de usuarios.
- Listar usuarios de outros tenants.
- Desativar MFA de si mesmo por esta rota (usa perfil, 7A).
