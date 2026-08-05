# Cadência — Fase 2 ("A conversa e o caixa"): Plano de Implementação

> **Para agentes executores:** SUB-SKILL: superpowers:subagent-driven-development ou executing-plans. Passos em checkbox `- [ ]`.

**Objetivo:** entregar o diferencial nº 2 — WhatsApp bidirecional com o número próprio da clínica (confirmação, lembrete, pós-consulta e NPS) e o financeiro básico (recebimento no atendimento, link de pagamento, conciliação básica e recibo) — de modo que a recepção use o Cadência de hora em hora e a gestora enxergue redução de faltas no primeiro mês.

**Arquitetura:** a Fase 2 constrói sobre a fundação das Fases 0 e 1, adicionando dois pacotes L2 (`messaging` e `payments`), dois contratos de integração (`MessagingProvider` e `PaymentProvider`), o outbox transacional, os eventos de domínio tipados e as telas `/conversas` e `/financeiro`. Toda comunicação entre irmãos L2 é assíncrona via `packages/events`; composição síncrona é responsabilidade de L3 (API/worker).

**Stack:** TypeScript 5.9 strict · PostgreSQL 18 · Fastify 5 · Next.js 15 App Router + React 19 · TanStack Query 5 · Vitest · Zod v4 · pg-boss 10 · Tailwind 4 com tokens CSS próprios · Radix headless.

---

## Antes de começar

### Pré-requisito absoluto: as Fases 0 e 1 concluídas e verdes

Este plano assume 67 migrations aplicadas e ~737 testes passando. **Confirme antes de escrever a primeira linha:**

```bash
pnpm db:up
pnpm db:migrate           # deve terminar em "0067_fix_finalize_ambiguous_version_id_066_regression.sql"
pnpm typecheck             # exit 0
pnpm test                  # 188 testes de unidade, 0 falhas
pnpm test:int              # 355 testes de integração, 0 falhas
pnpm test:iso              # 194 testes de isolamento
pnpm db:invariants         # todos OK
pnpm db:privileges         # privilégios afirmados
pnpm arch:check            # 0 violações
```

Se qualquer um desses falhar, **pare**.

### A próxima migration livre é a `0068`

`ls packages/db/migrations/` termina em `0067`. Crie sempre com `pnpm db:new <nome>`. Se o número divergir do que a tarefa diz, **pare e reconcilie**.

### O que as Fases 0 e 1 deixaram pronto — assinaturas reais que este plano consome

| O quê | Onde | Assinatura |
|---|---|---|
| Transação de negócio | `packages/db/src/tx.ts` | `withTenantTx<T>(actor: Actor, fn: (tx: TxClient) => Promise<T>, pool?: Pool): Promise<T>` |
| Ator | `packages/db/src/tx.ts` | `user` \| `system` \| `anon` |
| Pools | `packages/db/src/pool.ts` | `businessPool()`, `auditPool()`, `jobsPool()`, `closePools()` |
| Auditoria canal A | `packages/audit/src/domain.ts` | `logDomainEvent(tx, event): Promise<bigint>` |
| Auditoria canal B | `packages/audit/src/security.ts` | `SecurityAuditChannel` |
| RBAC | `packages/authz/src/actions.ts` | `ACTIONS`, `ACTION_BY_KEY`, `can()`, `assertCan()` |
| Sessão | `packages/authn/src/session.ts` | `resolveSession(db, token)` |
| Identifiers | `packages/kernel/src/uuid.ts` | `uuidv7()`, `isUuidV7()` |
| Money | `packages/kernel/src/money.ts` | `Money`, `brl()`, `add()`, `formatBRL()` |
| Clock | `packages/kernel/src/clock.ts` | `systemClock`, `isoFromMs()` |
| Integrations pattern | `packages/integrations/src/` | `SignatureProvider`, `PrescriptionProvider` + fakes |
| Scheduling | `packages/scheduling/src/` | `appointment`, `slot`, `waitlist` |
| EMR | `packages/emr/src/` | `finalize_encounter`, `amend`, `rectify` |
| Documents | `packages/documents/src/` | `renderPdf`, `documentHtml`, `stampPageNumbers` |
| API routes | `apps/api/src/routes/` | Pattern Fastify + Zod |
| Worker | `apps/worker/` | pg-boss + Chromium |
| Design system | `apps/web/src/` | Tokens CSS, 7 componentes centrais |

### Regras de arquitetura herdadas

1. **Setas só descem** (L0 → L1 → L2 → L3) e **irmão nunca importa irmão**. `pnpm arch:check` reprova.
2. **Comunicação entre irmãos L2 é assíncrona** via `packages/events` (L0). Composição síncrona é de L3.
3. **Migrations forward-only**, uma transação por arquivo.
4. **Fonte de tempo persistido é o PostgreSQL** (`clock_timestamp()`). `Date.now()` só em `clock.ts` e `uuid.ts`.
5. **Toda tabela multi-tenant**: `tenant_id`, RLS FORCE, ≥1 policy, FK composta.
6. **Chamada a parceiro sai só do worker**, via outbox.
7. **Timeout em operação unsafe nunca gera retry automático.** Persiste `indeterminado` e agenda reconciliação.
8. **CNPJ alfanumérico**; `COLLATE "pt-BR-x-icu"` em coluna ordenada para humano.

### Convenções

Conventional Commits em **inglês**. Código e identificadores em inglês; comentários e nomes de teste em **português**. Windows — prefira o Bash tool.

### Ordem de execução e por que ela é essa

1. **Tasks 1–5 — events/outbox.** Fundação assíncrona que tudo mais consome.
2. **Tasks 6–11 — messaging: modelo.** Schema `msg`, tabelas, domain logic.
3. **Tasks 12–17 — WhatsApp provider.** Contrato `MessagingProvider`, Cloud API, fake.
4. **Tasks 18–23 — automações.** Confirmação, lembrete, pós-consulta, NPS.
5. **Tasks 24–29 — pagamentos: modelo.** Schema `fin` populado, `fin.entry`, recibo.
6. **Tasks 30–35 — payment links + conciliação.** `PaymentProvider`, link, rollup, reconciliação.
7. **Tasks 36–42 — API e worker.** Rotas, webhooks, jobs.
8. **Tasks 43–48 — telas: Conversas.** `/conversas`, inbox, thread, quick actions.
9. **Tasks 49–54 — telas: Financeiro.** Pagamento no atendimento, recibos, dashboard.
10. **Tasks 55–60 — integração e gates.** Wiring, Hoje/Agenda, definition-of-done.

---

