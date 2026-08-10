# Fase 7B-3 — Permissoes editaveis — design

**Data:** 2026-08-10
**Status:** aprovado para execucao
**Pre-requisito:** Fase 7B-2 completa (CRUD de clinicas)
**Roadmap:** Fase 7 Bloco B, sub-entrega 3 de 5

## 1. O problema

Uma vez convidado com um papel, o membro da equipe nao pode ter seu papel
alterado sem ser revogado e reconvidado. Isso e incomodo para o admin e perde
a continuidade do vinculo (granted_at, membership_id). O admin precisa de um
caminho direto para mudar o papel de um membro existente.

## 2. Escopo

Uma capacidade nova:

1. **Alterar papel de membro** — endpoint + UI para mudar o role de um
   vinculo ativo, preservando o membership_id e granted_at.

### 2.1 Alterar papel

```
PUT /v1/configuracoes/equipe/:userId/role
Content-Type: application/json
Headers: x-csrf-token, Cookie, x-clinic-id

Body:
  { role: string }   // novo papel, enum dos 5 papeis

200: { ok: true }
422: { erro: 'auto_edicao' }
422: { erro: 'ultimo_admin' }
422: { erro: 'dados_profissionais_ausentes' }
422: { erro: 'mesmo_papel' }
404: { erro: 'vinculo_nao_encontrado' }
```

**Fluxo:**

1. Guard `rota('membership.edit', ...)` — admin_clinico + MFA.
2. Valida body (Zod).
3. Bloqueia auto-edicao (`params.userId === ctx.actor.userId` → 422
   `auto_edicao`).
4. Busca o vinculo ativo do alvo na clinica corrente:
   ```sql
   SELECT id, role FROM app.membership
    WHERE clinic_id = $1 AND user_id = $2 AND revoked_at IS NULL
   ```
   Se nao encontrado → 404 `vinculo_nao_encontrado`.
5. Se o papel atual == novo papel → 422 `mesmo_papel`.
6. Se o papel atual e `admin_clinico`, verifica se ha outro admin ativo:
   ```sql
   SELECT count(*) FROM app.membership
    WHERE clinic_id = $1 AND role = 'admin_clinico'
      AND revoked_at IS NULL AND user_id != $2
   ```
   Se count == 0 → 422 `ultimo_admin`.
7. Se o novo papel e `profissional` ou `diretor_tecnico`, verifica se o
   usuario tem registro profissional:
   ```sql
   SELECT 1 FROM app.professional
    WHERE tenant_id = current_tenant_id() AND user_id = $1
   ```
   Se nao existe → 422 `dados_profissionais_ausentes`.
8. UPDATE:
   ```sql
   UPDATE app.membership SET role = $novo
    WHERE id = $membership_id AND revoked_at IS NULL
   ```
9. Audit:
   ```sql
   audit.log('MEMBERSHIP_ROLE_CHANGE', 'app', 'membership', $membership_id,
             'sucesso', jsonb_build_object(
               'target_user_id', $userId,
               'role', $novo_role,
               'antigo_role', $antigo_role,
               'membership_id', $membership_id
             ), $clinic_id)
   ```
10. Retorna `{ ok: true }`.

**Decisoes:**

- **UPDATE, nao revoke+grant.** O vinculo e o mesmo — so o papel muda.
  Preserva `membership_id`, `granted_at`, e qualquer referencia futura. A
  trilha de auditoria registra old/new via `audit.log`.
- **Previne ultimo admin.** Se o alvo e o unico admin_clinico ativo na
  clinica, o papel nao pode ser alterado para outro — a clinica ficaria
  sem administrador.
- **Exige dados profissionais.** Se o novo papel e clinico
  (profissional/diretor_tecnico) e o usuario nao tem registro em
  `app.professional`, retorna erro. O admin deve revogar e reconvidar com
  dados profissionais — nao faz sentido criar dados de conselho numa rota
  de edicao de papel.
- **Bloqueio de auto-edicao.** O admin nao pode mudar o proprio papel
  pela mesma logica da auto-revogacao — previne escalacao/desescalacao
  acidental.

## 3. Nova acao authz

```
{ key: 'membership.edit', description: 'Alterar papel de membro',
  roles: ['admin_clinico'], requiresMfa: true }
```

Inserida logo apos `membership.revoke` em `packages/authz/src/actions.ts`.

## 4. Auditoria

A acao `MEMBERSHIP_ROLE_CHANGE` usa a chave `antigo_role` que nao existe na
whitelist. Migration 0160 adiciona essa chave.

## 5. Frontend

### 5.1 TabelaEquipe — botao "Alterar papel"

Adicionar ao componente `TabelaEquipe`:

- Novo botao "Alterar papel" (icone PencilSimple) ao lado de "Revogar",
  visivel para admin e nao para si mesmo.
- Ao clicar, a celula "Papel" da linha vira um `<select>` com os 5 papeis.
- Botoes "Confirmar" e "Cancelar" aparecem na celula de acoes.
- Novo callback prop: `aoAlterarPapel(userId, novoRole)`.

### 5.2 Equipe page — wiring

Adicionar funcao `alterarPapel(userId, novoRole)` em `equipe/page.tsx`:

- Chama `PUT /v1/configuracoes/equipe/${userId}/role` com `{ role: novoRole }`.
- Recarrega a equipe.
- Erros mapeados para mensagens inline.

Passar `aoAlterarPapel` ao componente `TabelaEquipe`.

## 6. Testes

### 6.1 Integracao (API)

Adicionar a `configuracoes.int.test.ts`:

- Alterar papel com dados validos: 200, papel efetivamente mudado.
- Auto-edicao: 422 `auto_edicao`.
- Ultimo admin: 422 `ultimo_admin`.
- Mesmo papel: 422 `mesmo_papel`.
- Sem permissao (role recepcao): 403.
- Alterar para papel profissional sem dados profissionais: 422
  `dados_profissionais_ausentes`.

### 6.2 Unitario (Web)

**TabelaEquipe:**
- Botao "Alterar papel" visivel para admin, oculto para si mesmo.
- Select aparece ao clicar no botao.
- Callback chamado com userId e novo papel.
- Select nao mostra o papel atual como opcao (ou mostra desabilitado).
- Passa a11y.

## 7. Fora de escopo

- Permissoes customizaveis por tenant (action-role mapping editavel).
- Criacao de papeis customizados.
- Edicao de dados profissionais de membro existente.
- Historico de mudancas de papel na interface.
