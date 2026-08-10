# Fase 6 — Navegação e catálogos — design

**Data:** 2026-08-10
**Status:** aprovado para execução
**Referência de paridade:** [inventário iClinic](../pesquisa/2026-08-03-inventario-iclinic-navegacao-real.md)

## 1. O problema

O app tem **38 páginas construídas e 6 itens de navegação**. A diferença não é
dívida de implementação: é dívida de *alcance*. O Next.js publica a rota assim que
o arquivo existe, e nada obriga alguém a linkar para ela. O resultado é um produto
onde módulos inteiros — testados, no ar, com backend completo — são invisíveis para
quem usa.

A causa raiz é mansa. `ITENS_NAV` em `apps/web/src/ui/nav.ts` é uma lista escrita à
mão, filtrada por `disponivelNaFase <= FASE_ATUAL` com `FASE_ATUAL = 5`. O
mecanismo de liberação por fase **nunca falhou**: Convênios seria fase 4,
Relatórios fase 3, Configurações fase 1 — todos ≤ 5, todos apareceriam. O array
simplesmente parou de receber linhas quando as Fases 4 e 5 passaram a ser entregues
por planos paralelos, cada um criando rotas sem tocar na lista comum.

O TypeScript valida o link que existe. Nunca reclama do link que falta.

## 2. Diagnóstico

Levantamento feito rota a rota contra o inventário. Três categorias distintas, com
custos que diferem em uma ordem de grandeza.

### 2.1 Módulos prontos e inalcançáveis

| Módulo | Rotas prontas | Na sidebar |
|---|---|---|
| Convênios / TISS | 10 — a faturar, lotes, guias, retornos, glosas, recursos, operadoras | não |
| Configurações | 3 — clínica e equipe, auditoria, seções do prontuário | não |
| Relatórios (`/explorar`) | 1 tela + 11 relatórios servidos por `/v1/reports/*` | não |

Os 11 relatórios que o inventário lista — atendimentos realizados, pacientes para
retorno, por período, por CID, por indicação, faltas, análises financeiras,
repasse, fluxo de caixa, envios, aniversariantes — já existem em
`packages/reports/src/saved-views.ts` e são consumidos por `/explorar`. Zero
arquivos linkam para essa tela.

### 2.2 Rotas órfãs — nada no app leva até elas

`/explorar` · `/configuracoes` · `/configuracoes/auditoria` ·
`/configuracoes/prontuario` · `/agenda/lista-espera` · `/agenda/imprimir` ·
`/financeiro/cadastros` · `/conversas/templates`

### 2.3 Link quebrado

`FinanceiroLayout.tsx:38` tem aba **"Convenios" → `/financeiro/convenios`**. A rota
não existe: 404 ao clicar. E `/financeiro/cadastros`, que existe e serve
fornecedores, contas bancárias, centros de custo e recorrências, não está na lista
de abas.

### 2.4 Capacidades da API sem interface

| Endpoint | O que faz | Interface |
|---|---|---|
| `DELETE /v1/sessao` | sair | **nenhuma** — não há logout no app |
| `POST /v1/sessao/unidade` | trocar de unidade | **nenhuma** |
| `GET /v1/catalogos/cid` | CID 10 | nenhuma |
| `GET /v1/catalogos/cid11` | CID 11 | nenhuma |
| `GET /v1/catalogos/tuss` | TUSS | só busca embutida no atendimento |
| `GET /v1/procedimentos` | procedimentos da clínica | só combo em telas de agendamento |

O bloco de usuário no rodapé da sidebar (`BarraDeNavegacao.tsx:389`) é texto fixo:
`Usuario` / `Clinica Cadencia · online`. Não lê a sessão e não oferece ação
nenhuma.

### 2.5 Telas do inventário que realmente não existem

Configurações da Conta (assinatura, cobrança, usuários, clínicas, permissões de
envio, SMS, teleconsultas, exportar e migrar dados) · Configurações de
Profissionais, exceto "seções do prontuário" (agenda, convênios, procedimentos,
impressões, modelos de exames e atestados, integrações de calendário) · Meu Perfil ·
Permissões editáveis · Bulas · Contatos.

O sinal mais barato de viabilidade neste monorepo é `ls packages/<nome>/src`. Um
pacote com só `index.ts` contendo `export {}` é fronteira de domínio reservada na
Fase 0 e nunca preenchida. **`billing`, `identity`, `tenancy`, `retention` e
`people` são todos stubs de uma linha.** Já `packages/authz/src/actions.ts` tem 134
ações catalogadas com papéis. Isso separa, sem abrir uma tela, o que é UI sobre
dado existente do que é módulo do zero.

## 3. Roadmap — Fases 6 a 9

Escopo total aprovado. Cada fase ganha spec e plano próprios, no padrão das Fases
1–5.

| Fase | Tema | Conteúdo |
|---|---|---|
| **6** | Navegação e catálogos | Este documento |
| **7** | Configurações e administração | Usuários (convidar/revogar), clínicas, permissões editáveis, exportar e migrar dados da clínica, modelos de atestados, observações da agenda, impressões, contatos, troca de senha e MFA |
| **8** | Canais e agenda estendida | SMS e permissões de envio, teleconsultas, integração Google/Apple Calendar |
| **9** | Comercial | `billing`: assinatura, planos, cobrança, faturas |

Bulas fica na Fase 6 porque segue o padrão de `packages/catalogs`: ingestão externa
com staging, validação e merge, igual a TUSS e CID.

## 4. Escopo da Fase 6

### 4.1 Bloco 0 — navegação e links

Nenhum backend novo.

**Sidebar, em dois grupos:**

```
WORKSPACE
  Hoje         ⌥1   existe
  Agenda       ⌥2   existe
  Conversas    ⌥3   existe
  Pacientes    ⌥4   existe

GESTÃO
  Financeiro   ⌥5   existe
  Convênios    ⌥6   novo — badge de pendências
  Desempenho   ⌥7   existe
  Relatórios   ⌥8   novo → /explorar

  Configurações     novo — rodapé, sem atalho numérico
```

Relatórios é item de topo, não sub-aba de Desempenho: são coisas diferentes.
Desempenho responde *por que o número mudou* (variação, waterfall, drill-down).
Relatórios responde *quais foram os registros* (lista, filtro, exportação). Enterrar
um dentro do outro faz a exportação — que é o motivo de metade dos acessos —
custar dois cliques a mais para sempre.

Configurações fica no rodapé sem número porque a frequência de uso é outra ordem de
grandeza, e porque ⌥1–⌥8 já mapeia limpo o trabalho do dia.

`ITENS_NAV` ganha um campo `grupo: 'workspace' | 'gestao'`. Os `disponivelNaFase`
dos itens novos são os das fases em que foram construídos (Convênios 4,
Relatórios 3, Configurações 1) — não 6. O campo diz quando a tela passou a existir,
não quando a linha foi escrita.

**Bloco de usuário no rodapé** vira menu real, lendo a sessão de verdade:
nome e papel do vínculo ativo · unidade atual · **trocar de unidade**
(`POST /v1/sessao/unidade`) quando houver mais de uma · Meu perfil ·
**Sair** (`DELETE /v1/sessao`).

**Sub-navegação por módulo**, no padrão de abas que Financeiro e Convênios já usam:

| Módulo | Abas |
|---|---|
| Agenda | Agenda · Lista de espera — "Imprimir" é botão que leva a `/agenda/imprimir` |
| Conversas | Caixa · Automações · Templates |
| Financeiro | corrigir aba `Convenios` (404) e acrescentar **Cadastros** |
| Desempenho | Indicadores · NPS — remove o link solto acima do título |
| Configurações | Clínica · Equipe · Permissões · Procedimentos · Prontuário · Auditoria · Catálogos · Meu perfil |

`/agenda/imprimir` é view de impressão, destino de ação — não merece aba. A aba
`Convenios` do Financeiro aponta para `/convenios`, o módulo que já existe; não se
cria rota nova sob `/financeiro`.

A aba **Catálogos** aponta para `/catalogos`, um hub que lista CID 10, CID 11, TUSS
e Bulas. As tabelas de referência não moram sob `/configuracoes` porque não são
configuração: ninguém as edita, são consulta. Mas também não ganham item de topo na
sidebar — a frequência não justifica, e ⌘K resolve o acesso direto. A aba é o
caminho descoberto por quem não sabe que elas existem.

**Command palette (⌘K) vira a navegação da cauda longa.** Hoje filtra os mesmos 6
itens de `ITENS_NAV` (`BarraDeNavegacao.tsx:76`). Passa a indexar **todos os
destinos**, incluindo sub-rotas e catálogos. É o que permite a sidebar continuar
enxuta com tudo alcançável: telas de baixa frequência — CID 11, auditoria,
impressões — não disputam espaço com o trabalho do dia.

O índice do palette é derivado da mesma fonte que alimenta sidebar e sub-navs. Duas
listas escritas à mão divergem; foi exatamente assim que chegamos aqui.

### 4.2 Bloco 1 — telas com backend pronto

| Tela | Rota | Backend | Estado |
|---|---|---|---|
| Hub de catálogos | `/catalogos` | — | índice das quatro tabelas |
| CID 10 | `/catalogos/cid10` | `GET /v1/catalogos/cid` | pronto |
| CID 11 | `/catalogos/cid11` | `GET /v1/catalogos/cid11` | pronto |
| TUSS | `/catalogos/tuss` | `GET /v1/catalogos/tuss` | pronto |
| Procedimentos | `/configuracoes/procedimentos` | `GET /v1/procedimentos` | pronto |
| Permissões (leitura) | `/configuracoes/permissoes` | `@cadencia/authz` | pronto, estático |
| Meu perfil | `/configuracoes/perfil` | `GET /v1/sessao` | leitura + troca de unidade |
| Bulas | `/catalogos/bulas` | — | precisa ingestão |

**Permissões renderiza a matriz papel × ação a partir de `@cadencia/authz`**, sem
endpoint novo. O catálogo é dado estático — 134 ações com papéis e flag
`requiresMfa` — e `packages/authz` tem zero dependências, então `apps/web` pode
importá-lo. A regra `web-nao-fala-com-banco` do `.dependency-cruiser.cjs` barra
apenas `db`, `jobs` e `outbox`. É preciso acrescentar `"@cadencia/authz":
"workspace:*"` em `apps/web/package.json`.

A tela é **leitura** nesta fase. Tornar permissões editáveis por clínica muda a
fonte da verdade: hoje `pnpm authz:seed` regenera `ref.action` e
`actions.lock.json` a partir do código, nunca o contrário. Inverter isso é decisão
de arquitetura, não tela — fica na Fase 7.

**Meu perfil** cobre leitura da sessão e troca de unidade. Troca de senha e cadastro
de MFA ficam na Fase 7: `packages/authn` tem `password.ts` e `totp.ts`, mas
`apps/api/src/routes/sessao.ts` só expõe login, leitura, troca de unidade,
verificação de MFA e logout. Não há rota de escrita de credencial.

**Bulas** é o único item do bloco sem backend. Segue `tuss-load.ts`: o carregador
recebe `rows` já parseadas e faz staging → validação → merge com o papel `jobs`. A
origem dos dados (ANVISA) é trabalho de parsing, fora do módulo.

## 5. A regressão que precisa ser travada

Um teste que enumera `apps/web/app/**/page.tsx`, monta o grafo de navegação a
partir da fonte única (sidebar + sub-navs + palette) e **falha quando uma rota não
tem caminho até ela**.

Sem isso, a Fase 7 recria este problema exatamente do mesmo jeito. As 8 rotas órfãs
não surgiram por descuido individual: surgiram porque nada no CI sabe que uma rota
precisa de um caminho. O teste transforma "esqueci de linkar" em build vermelho.

Exceções são declaradas explicitamente e justificadas: `/entrar` e
`/agendar/[clinicId]` são rotas públicas, fora da navegação interna por decisão
(`ehRotaPublica`), e `/atendimento/[id]`, `/pacientes/[id]` e afins são destinos
paramétricos alcançados a partir de listas.

## 6. Fora de escopo

Tudo do §3 marcado como Fase 7, 8 ou 9. Em particular, e por serem os que mais
convidam a vazar para dentro desta fase:

- **Permissões editáveis** — inverte a fonte da verdade do catálogo de ações.
- **Troca de senha e MFA** — precisa de rota de escrita de credencial.
- **Clínicas (CRUD)** — `packages/tenancy` é stub; a Fase 6 apenas *usa*
  `POST /v1/sessao/unidade` para trocar entre as que já existem.
- **Contatos** — `packages/people` é stub.

## 7. Critérios de pronto

1. Toda rota sob `apps/web/app/` tem caminho de navegação, ou exceção declarada.
2. O teste de alcançabilidade roda no CI e falha quando isso deixa de ser verdade.
3. Nenhum link interno aponta para rota inexistente — inclusive a aba
   `/financeiro/convenios`.
4. ⌘K encontra qualquer destino do app, não só os itens da sidebar.
5. É possível sair da sessão e trocar de unidade pela interface.
6. As sete telas do §4.2 existem, navegáveis, com estado vazio e de carregamento
   no padrão de `EstadoVazio` e `Skeleton`.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test` e `depcruise` passam.
