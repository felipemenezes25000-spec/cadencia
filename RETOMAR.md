# Como retomar o Cadência em outra sessão

Este projeto foi desenhado para sobreviver ao fim de qualquer conversa. Nada do
raciocínio mora no chat: o **design** está versionado, as **decisões** estão nas
mensagens de commit, os **planos** estão fatiados em tarefas executáveis, e os
**workflows** que executam essas tarefas estão em `tools/workflows/`.

Uma sessão nova — minha ou de outro desenvolvedor — lê este arquivo e continua.

---

## Onde o projeto está

| | |
|---|---|
| Repositório | `github.com/felipemenezes25000-spec/cadencia` (privado) |
| Branch de trabalho | `fase-0-fundacao` |
| Fase 0 — Fundação | ✅ **concluída**, 48 tarefas |
| Fase 1 — "O dia" | 🔄 **em andamento** |
| Fases 2 a 4 | ⬜ planos ainda não escritos |

Para ver o estado exato agora:

```bash
git log --oneline | head -5
ls packages/db/migrations/ | tail -3
pnpm test && pnpm test:int && pnpm test:iso
```

**A última tarefa concluída é a do último commit `feat(...)` ou `fix(...)`.** O
histórico é a fonte da verdade sobre progresso — não este arquivo, que envelhece.

---

## Os documentos, em ordem de autoridade

1. **`docs/superpowers/specs/2026-08-03-design-sistema.md`** — o design. É a fonte
   da verdade sobre *o que* o produto é e *por que* cada decisão foi tomada.
   Contém as **19 decisões irreversíveis** (§10): coisas que precisam estar certas
   desde o dia 1 porque depois são migração de dezenas de milhões de linhas
   imutáveis. Leia a §10 antes de mudar qualquer coisa estrutural.

2. **`docs/superpowers/plans/2026-08-03-fase0-fundacao-plano.md`** — 48 tarefas,
   já executadas.

3. **`docs/superpowers/plans/2026-08-03-fase1-o-dia-plano.md`** — 79 tarefas.

4. **`docs/superpowers/pesquisa/`** — a pesquisa de domínio que fundamenta o
   design: regulação do prontuário eletrônico (CFM, SBIS, LGPD), prescrição
   digital, TISS, e o inventário de navegação real do iClinic.

**As mensagens de commit carregam o porquê**, não só o quê. Quando algo parecer
estranho, `git log -S "<termo>"` costuma explicar.

---

## Retomar a execução de uma fase

```bash
# 1. Ambiente
pnpm install
cp .env.example .env          # uma vez, na primeira máquina
pnpm db:up
pnpm db:migrate

# 2. Confirmar que a base está sã ANTES de continuar
pnpm test && pnpm test:int && pnpm test:iso
pnpm typecheck && pnpm arch:check && pnpm db:invariants

# 3. Fatiar o plano em uma tarefa por arquivo
node tools/workflows/fatiar-plano.mjs \
     docs/superpowers/plans/2026-08-03-fase1-o-dia-plano.md .tasks-fase1
```

Depois, edite `tools/workflows/executa-fase.js` na linha do laço:

```js
for (let n = 23; n <= 79; n++) TAREFAS.push(String(n))
//           ↑ troque pela próxima tarefa não concluída
```

E lance o workflow apontando para esse arquivo.

O laço é **sequencial de propósito**: cada tarefa commita, e a seguinte enxerga o
resultado. Em paralelo daria conflito de git e migrations fora de ordem.

Ele **para no primeiro `BLOCKED`** — um agente que trava reporta o motivo, o que
tentou e que ajuda precisa, e o laço inteiro para em vez de construir por cima de
um mal-entendido.

---

## Escrever o plano de uma fase nova

`tools/workflows/escreve-plano-fase.js` escreve um plano em blocos paralelos.
Adapte a lista `BLOCOS` para o escopo da fase e ajuste `DESIGN`/`DIR`.

**Duas armadilhas já pagas, não repita:**

- **Limite de saída.** Um agente não consegue devolver mais de ~64 mil tokens numa
  resposta. Blocos de 12+ tarefas com código completo estouram. Mantenha 5 a 7
  tarefas por bloco, e faça cada agente **gravar em arquivo** em vez de devolver o
  markdown pela resposta.
- **Escrever contra o design não basta.** O plano precisa ser escrito lendo o
  **código real** que a fase anterior produziu — as assinaturas verdadeiras estão
  nas migrations e nos pacotes. Foi assim que se descobriu que `app.local_date()`
  era citada por um lint mas nunca tinha sido criada.

---

## Regras que o projeto inteiro obedece

Estas não são estilo — são o que impede o produto de precisar ser reescrito.

1. **Migrations são forward-only.** O harness recusa por checksum se você editar
   uma já aplicada. Para corrigir, escreva a próxima. **O número da próxima é o
   que `ls packages/db/migrations/` mostra**, nunca o que um plano diz — os planos
   envelhecem.
2. **Irmão nunca importa irmão.** L0 → L1 → L2 → L3, setas só descem.
   `pnpm arch:check` reprova.
3. **Toda tabela multi-tenant** nasce com `tenant_id`, RLS habilitada e **forçada**,
   ao menos uma policy, e FK composta `(tenant_id, ...)`. A suíte `test:iso`
   descobre tabelas do catálogo e reprova quem esquecer.
4. **Registro clínico finalizado é imutável por `REVOKE`**, não por convenção.
   Correção cria versão nova. O verbo "Excluir" não existe no vocabulário do
   produto para registro finalizado.
5. **Fonte de tempo persistido é o PostgreSQL** (`clock_timestamp()`).
   `Date.now()` só em `packages/kernel/src/clock.ts` e `uuid.ts`.
6. **Data do evento** usa `app.local_date()`, nunca `occurred_at::date`.
7. **CNPJ é alfanumérico**; coluna ordenada para humano leva
   `COLLATE "pt-BR-x-icu"`.
8. **Exceção a invariante se declara no banco**, por `COMMENT ON TABLE`, em
   migration revisada — nunca por lista editável em arquivo de teste. Exceção que
   se altera sem revisão deixa de ser exceção e vira porta.

---

## O que ficou pendente

**A revisão de qualidade.** Por decisão do dono do produto, a execução rodou só
com implementação — sem revisor de conformidade nem de qualidade por tarefa. A
varredura sobre o diff completo ficou para depois, e quando acontecer será a
**única revisão do projeto**. Vale fazê-la antes de qualquer coisa ir para
produção.

**Os planos das Fases 2, 3 e 4.** O design cobre as seis fases (§8), mas só as
Fases 0 e 1 têm plano de implementação escrito.

**A Fase 5** (glosa e webservice SOAP com operadoras) é fisicamente bloqueada até
existir cliente real: credenciais e homologação pertencem ao prestador, não a nós.

---

## Se algo estiver vermelho

Rode as suítes e leia a mensagem — elas foram escritas para explicar, não só para
falhar. Vários testes deste repositório **provam que a proteção pega uma violação
proposital**, então um vermelho normalmente significa que uma garantia real caiu,
e não que o teste é chato.

Se um teste parecer errado, desconfie duas vezes antes de afrouxá-lo. Já
aconteceu de o teste estar certo e o código errado — e também o contrário, com o
teste exigindo uma forma de plano de execução que a Row-Level Security torna
impossível. Nos dois casos a saída foi **medir**, não opinar.
