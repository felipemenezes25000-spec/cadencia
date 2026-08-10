# Fase 7A — Credenciais — design

**Data:** 2026-08-10
**Status:** aprovado para execucao
**Pre-requisito:** Fase 6 completa (perfil em `/configuracoes/perfil`)
**Roadmap:** Fase 7 Bloco A de 3 (A: credenciais, B: administracao, C: templates)

## 1. O problema

O app nao oferece troca de senha nem cadastro de MFA pela interface. Os
primitivos existem em `@cadencia/authn` — `hashPassword`, `verifyPassword`,
`enrollTotp`, `verifyTotpForUser` — mas nenhuma rota os expoe ao usuario. A
tela de perfil (`/configuracoes/perfil`) mostra um placeholder:
*"Troca de senha e cadastro de MFA chegam em breve."*

O `POST /v1/sessao/mfa` (verificacao de codigo TOTP) ja existe e funciona. O
enrollment, porem, so acontece em testes de integracao — nenhuma rota permite
que o usuario inicie o cadastro.

## 2. Escopo

Duas rotas novas na API e uma atualizacao na tela de perfil.

### 2.1 Rota: troca de senha

```
PUT /v1/sessao/senha
Content-Type: application/json
Headers: x-csrf-token, Cookie: __Host-cadencia_sid

Body:
  { senhaAtual: string, senhaNova: string }

200: { ok: true }
401: sem_sessao | senha_incorreta
403: csrf_invalido
422: senha_fraca
```

**Fluxo:**

1. CSRF check via `csrfOk(req)` — 403 se falha.
2. Resolve sessao via `sessaoDaRequisicao(req)` — 401 `sem_sessao` se invalida.
3. Busca `password_hash` de `id."user"` WHERE `user_id = sessao.userId`.
4. `verifyPassword(storedHash, body.senhaAtual)` — 401 `senha_incorreta` se falha.
5. Valida `body.senhaNova`:
   - Minimo 8 caracteres — 422 `senha_fraca` se menor.
   - Diferente de `senhaAtual` — 422 `senha_fraca` se igual.
6. `hashPassword(body.senhaNova)` — Argon2id com `ARGON2ID_PARAMS`.
7. UPDATE `id."user"` SET `password_hash = $novoHash` WHERE `user_id = $userId`.
8. `revokeAllSessionsOfUser(db, userId, 'troca_de_senha')` — revoga todas as sessoes.
9. Cria sessao nova para o usuario atual: `createSession(db, { userId, ... })`.
10. Seta cookies da sessao nova na resposta (mesmo padrao do login).
11. `logDomainEvent` na trilha de auditoria.
12. Retorna `{ ok: true }`.

**Decisao: revogar todas as sessoes.** Se alguem trocou a senha, ou e o dono
da conta protegendo-se, ou e um atacante que obteve a sessao. Nos dois casos,
matar as outras sessoes e a acao correta. O usuario que trocou nao e deslogado
porque uma sessao nova e criada no passo 9.

### 2.2 Rota: iniciar cadastro de MFA

```
POST /v1/sessao/mfa/cadastrar
Content-Type: application/json
Headers: x-csrf-token, Cookie: __Host-cadencia_sid

Body: {}

200: { qrcodeUri: string, segredo: string }
401: sem_sessao
403: csrf_invalido
```

**Fluxo:**

1. CSRF check — 403 se falha.
2. Resolve sessao — 401 `sem_sessao` se invalida.
3. `enrollTotp(appPool(), sessao.userId, chaveTotp())`.
   - Gera segredo internamente via `newTotpSecret()`.
   - Faz upsert em `id.user_totp`: insere ou sobrescreve, resetando
     `confirmed_at` e `last_accepted_step` para NULL.
   - Retorna `{ secretBase32, uri, email }`.
4. Retorna `{ qrcodeUri: result.uri, segredo: result.secretBase32 }`.

**Confirmacao:** usa a rota existente `POST /v1/sessao/mfa`. O
`verifyTotpForUser` ja seta `confirmed_at = coalesce(confirmed_at,
clock_timestamp())` no primeiro codigo valido. Zero codigo novo para
confirmacao.

**Re-enrollment:** chamar `POST /v1/sessao/mfa/cadastrar` novamente invalida
o segredo anterior (upsert com reset). O usuario pode reconfigurar sem
interacao de admin.

### 2.3 Frontend: secao de seguranca no perfil

Substituir o placeholder na tela `/configuracoes/perfil` por duas subsecoes:

**Trocar senha:**
- Formulario com 3 campos: senha atual, nova senha, confirmar nova senha.
- Botao "Trocar senha" desabilitado ate:
  - Todos os campos preenchidos.
  - Nova senha >= 8 caracteres.
  - Nova senha === confirmar nova senha.
- Ao submeter: `PUT /v1/sessao/senha`.
- Sucesso: mensagem de confirmacao, cookies atualizados automaticamente.
- Erro: mensagem inline no formulario (`senha_incorreta` ou `senha_fraca`).

**Autenticacao em dois fatores:**
- **Se `!usuario.mfaOk`**: botao "Configurar MFA".
  1. Clique chama `POST /v1/sessao/mfa/cadastrar`.
  2. Exibe `qrcodeUri` como QR code (renderizado localmente via canvas/SVG,
     sem biblioteca externa — o URI e curto o bastante para QR simples).
  3. Exibe `segredo` em texto para copia manual.
  4. Campo de 6 digitos para codigo de confirmacao.
  5. Submete via `POST /v1/sessao/mfa` (rota existente).
  6. Sucesso: fecha o fluxo, exibe badge "MFA ativo".
- **Se `usuario.mfaOk`**: badge "MFA ativo".
  - Botao "Reconfigurar" que repete o fluxo acima (o `enrollTotp` ja faz
    upsert, invalidando o segredo anterior).

**QR code:** renderizado client-side sem dependencia externa. O formato
`otpauth://totp/...` e padrao e curto. Uma funcao pura que converte a string
em matriz de modulos e renderiza como `<svg>` e suficiente — sem canvas, sem
CDN, sem `qrcode.js`. Se a complexidade do QR encoder for excessiva para
inline, o fallback e exibir apenas o segredo em texto com instrucoes de
digitacao manual no app autenticador.

### 2.4 Atualizacao do GET /v1/sessao

O endpoint `GET /v1/sessao` ja retorna `mfaOk: boolean` (true se `mfa_at` nao
e null na sessao). Nenhuma mudanca necessaria para o frontend saber se MFA esta
ativo.

Porem, para diferenciar "MFA nao verificado nesta sessao" de "MFA nao
cadastrado", o frontend precisa saber se o usuario TEM TOTP cadastrado. Isso
ja vem na resposta do `GET /v1/sessao` — o campo `precisaMfa` e true quando
`confirmed_at IS NOT NULL` em `id.user_totp`. Quando o perfil le
`usuario.mfaOk`, esta lendo o estado da sessao; quando precisa saber se MFA
esta cadastrado (para exibir "Configurar" vs "Reconfigurar"), pode verificar
se `precisaMfa` existe no objeto de sessao.

Verificar se `precisaMfa` ja e retornado pelo `GET /v1/sessao`. Se nao for,
acrescentar o campo.

## 3. Testes

### 3.1 Integracao (API)

Adicionar ao `sessao.int.test.ts`:

**Troca de senha:**
- Troca com senha atual correta: retorna 200, sessao antiga invalidada, nova
  sessao funcional.
- Troca com senha atual incorreta: retorna 401 `senha_incorreta`.
- Senha nova com menos de 8 chars: retorna 422 `senha_fraca`.
- Senha nova igual a atual: retorna 422 `senha_fraca`.
- Sem CSRF: retorna 403.

**Cadastro de MFA:**
- `POST /v1/sessao/mfa/cadastrar` retorna `qrcodeUri` e `segredo`.
- Confirmar com codigo valido via `POST /v1/sessao/mfa`: retorna 200.
- Apos confirmacao, login subsequente tem `precisaMfa: true`.
- Re-cadastro (chamar `/cadastrar` de novo) invalida segredo anterior.

### 3.2 Unitario (Web)

Testes da tela de perfil:
- Formulario de senha: botao desabilitado com campos vazios, habilitado com
  campos validos, mensagem de erro em caso de falha.
- Fluxo de MFA: exibe QR code apos iniciar, aceita codigo, exibe badge apos
  confirmacao.

## 4. Fora de escopo

- Reset de senha por email (precisa de email transacional — Fase 8 ou futura).
- Desativar MFA por admin (Fase 7B, junto com administracao de usuarios).
- Politica de senha customizavel por clinica.
- Backup codes para MFA (simplificacao: re-enrollment via admin resolve).
