# Production and Experience Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar stubs expostos, fechar falhas de autorização, completar fluxos visíveis e restaurar uma experiência clínica pronta para gates de produção.

**Architecture:** Manter Next.js/Fastify/PostgreSQL e implementar as lacunas nas mesmas fronteiras existentes. Toda escrita passa por rota autorizada e transação tenant-scoped; a UI consome apenas contratos persistidos e apresenta estados explícitos.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 15, Fastify 5, PostgreSQL 18, Vitest 4, Testing Library, Playwright, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-13-producao-e-experiencia-design.md`

## Global Constraints

- Migrations são forward-only e tabelas de negócio nascem com `tenant_id`, RLS habilitada e forçada.
- Web não acessa banco; rotas privadas usam `rota(...)`/`comTransacao(...)`.
- Dinheiro permanece em centavos inteiros e tempo persistido vem do PostgreSQL.
- Uma ação aparente precisa executar uma ação real ou ser removida.
- A interface funciona a 390 px, com foco visível e sem estado comunicado apenas por cor.

---

### Task 1: Estabilizar gates locais

**Files:**
- Modify: `tools/demo-compose.test.ts`
- Modify: `apps/web/vitest.setup.ts`
- Test: `tools/demo-compose.test.ts`
- Test: `apps/web/src/telas/desempenho/*.test.tsx`

- [ ] Cachear `docker compose config` por arquivo e definir timeout de 30 s para inicialização fria.
- [ ] Executar o teste isolado e confirmar que a falha original desaparece sem ocultar erro do Compose.
- [ ] Adicionar implementação mínima de `HTMLCanvasElement.getContext` no setup JSDOM.
- [ ] Executar os testes de gráfico e confirmar saída sem tempestade de “Not implemented”.
- [ ] Executar `pnpm test` e `pnpm test:web` sequencialmente.

### Task 2: Fechar endpoints privados e persistir notificações/canais

**Files:**
- Create: `packages/db/migrations/0174_app_notification_channel_config.sql`
- Create: `apps/api/src/routes/operational-config.int.test.ts`
- Modify: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/routes/channels.ts`
- Modify: `apps/api/src/routes/tenancy.ts`

**Interfaces:**
- Produces: `/v1/notifications`, `/v1/channels`, `/v1/clinics`, `/v1/permissions` com sessão, autorização e estado persistido.

- [ ] Escrever testes que provem 401 anônimo, 403 por papel e persistência/isolamento.
- [ ] Executar os testes e observar a falha causada pelos handlers sem guard e pelos retornos fictícios.
- [ ] Criar tabelas e policies tenant-scoped na migration 0174.
- [ ] Implementar handlers com `rota(...)`, SQL parametrizado e respostas tipadas.
- [ ] Executar integração, invariantes e isolamento relacionados.

### Task 3: Completar superfícies visíveis

**Files:**
- Modify: `apps/web/app/catalogos/page.tsx`
- Modify: `apps/web/src/telas/TelaDeAtendimento.tsx`
- Modify: `apps/web/src/telas/TelaDeAtendimento.test.tsx`
- Modify: `apps/web/src/telas/FichaDoPaciente.tsx`
- Modify: `apps/web/app/pacientes/[id]/page.tsx`

- [ ] Escrever testes para link real do Bulário, abertura do SADT e ausência de botão de documento sem handler.
- [ ] Executar e observar as falhas dos placeholders atuais.
- [ ] Conectar Bulário, SADT e documentos existentes usando contratos da API já presentes.
- [ ] Cobrir loading, erro, restrito e vazio.
- [ ] Executar testes das telas alteradas e auditoria de acessibilidade.

### Task 4: Restaurar identidade e corrigir hierarquia responsiva

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/src/telas/Hoje.tsx`
- Modify: `apps/web/src/telas/Hoje.test.tsx`
- Modify: `apps/web/src/telas/__tests__/audit-responsive.test.tsx`
- Modify: `apps/web/DESIGN_SYSTEM.md`

- [ ] Escrever teste estrutural garantindo Fluxo antes do rail em layout de uma coluna.
- [ ] Remover o override azul-claro global do shell autenticado; manter o login por seus estilos locais.
- [ ] Trocar o breakpoint do cockpit para colocar o rail ao lado apenas quando couber e manter o fluxo primeiro abaixo disso.
- [ ] Revisar componentes TSX alterados pelo checklist React: hooks, acessibilidade, rerenders e bundle.
- [ ] Verificar visualmente `/hoje`, `/agenda`, `/pacientes`, `/conversas`, `/financeiro`, `/convenios`, `/desempenho`, `/configuracoes`, `/notificacoes` e `/bulas` em desktop e 390×844.

### Task 5: Gate de produção

**Files:**
- Modify: `.env.example` e `README.md` somente se novos requisitos de ambiente surgirem.

- [ ] Executar `pnpm typecheck`.
- [ ] Executar `pnpm test`, `pnpm test:web` e `pnpm build:web` sequencialmente.
- [ ] Executar `pnpm lint:routes`, `pnpm lint:session-guc`, `pnpm lint:terminology-clock`, `pnpm authz:check` e `pnpm arch:check`.
- [ ] Executar `pnpm test:int`, `pnpm db:invariants --with-crud` e `pnpm test:iso` quando Docker estiver disponível.
- [ ] Revisar o diff, procurar stubs restantes expostos e documentar qualquer dependência externa que impeça produção real.
