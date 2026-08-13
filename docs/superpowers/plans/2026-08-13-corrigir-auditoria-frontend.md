# Correções da Auditoria de Frontend — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os problemas confirmados de qualidade, acessibilidade, responsividade e UX do frontend sem redesenhar o produto.

**Architecture:** Manter as primitives e o design system atuais. Abas que controlam conteúdo continuam como tabs; navegação entre rotas passa a ser links semânticos. Estado compartilhável migra para query string nos containers de rota, e ações destrutivas passam por confirmação explícita.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Radix UI, nuqs, Vitest, Testing Library, Playwright e axe-core.

**Spec:** `docs/superpowers/specs/2026-08-13-producao-e-experiencia-design.md`

## Global Constraints

- Preservar a identidade visual e os contratos do `apps/web/DESIGN_SYSTEM.md`.
- WCAG AA é o piso; não desabilitar regras axe para esconder violações.
- Verificar 390×844 e desktop, sem overflow horizontal.
- Mudanças comportamentais seguem teste falhando → implementação mínima → regressão verde.
- Não adicionar dependências.

---

### Task 1: Restaurar os gates E2E e de acessibilidade

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/src/telas/__tests__/audit-a11y.test.tsx`
- Test: `apps/web/tests/e2e/06-acessibilidade.spec.ts`

- [ ] Corrigir `retries` para o tipo numérico aceito pelo Playwright.
- [ ] Remover a exceção global de `aria-valid-attr-value` e executar o teste para observar as falhas reais.
- [ ] Fortalecer as asserções E2E para inspecionar todos os controles e nomes acessíveis reais.

### Task 2: Corrigir semântica de tabs e navegação

**Files:**
- Modify: `apps/web/src/telas/Agenda.tsx`
- Modify: `apps/web/app/conversas/layout.tsx`
- Modify: `apps/web/src/telas/FinanceiroLayout.tsx`
- Modify: `apps/web/src/components/shell/TopBar.tsx`
- Modify: `apps/web/app/agenda/page.tsx`
- Test: testes existentes dos respectivos componentes

- [ ] Escrever regressões que exigem painel associado para tab ativa e links para destinos de navegação.
- [ ] Manter o skeleton da Agenda dentro do `TabsContent` ativo.
- [ ] Trocar tabs de rota e botões programáticos por `Link` com o mesmo estilo visual.

### Task 3: Corrigir estrutura de página, ARIA e contraste

**Files:**
- Modify: `apps/web/app/entrar/page.tsx`
- Modify: `apps/web/src/telas/Conversas.tsx`
- Modify: `apps/web/src/telas/Hoje.tsx`
- Modify: `apps/web/src/components/shell/Sidebar.tsx`
- Test: auditoria axe e testes de tela

- [ ] Escrever regressões para um único `h1`, título no erro de Hoje e indicador de presença sem ARIA proibido.
- [ ] Ajustar a hierarquia de headings sem alterar a aparência.
- [ ] Substituir cores reprovadas no login por cores AA.

### Task 4: Corrigir responsividade da Agenda

**Files:**
- Modify: `apps/web/src/telas/Agenda.tsx`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/src/telas/__tests__/audit-responsive.test.tsx` e browser real

- [ ] Adicionar regressão de estrutura para coluna de grid encolhível.
- [ ] Impedir que conteúdo intrínseco expanda a página e validar 320, 390, 768 e 1440 px.

### Task 5: Proteger ações destrutivas e alterações não salvas

**Files:**
- Modify: `apps/web/src/telas/ConveniosOperadoras.tsx`
- Modify: `apps/web/src/telas/MatrizPermissoes.tsx`
- Test: testes existentes ao lado dos componentes

- [ ] Escrever teste que reprova exclusão imediata de operadora.
- [ ] Exigir confirmação antes de chamar `aoDesativar`.
- [ ] Escrever teste para aviso `beforeunload` quando permissões estão alteradas.
- [ ] Instalar/remover o guard conforme o estado sujo.

### Task 6: Persistir filtros operacionais na URL

**Files:**
- Modify: telas financeiras e de convênios que mantêm filtros locais
- Test: testes das telas com `NuqsTestingAdapter`

- [ ] Migrar busca, datas, categorias e status compartilháveis para `useQueryState` com defaults estáveis.
- [ ] Manter estados efêmeros como loading, seleção e drawers em `useState`.
- [ ] Verificar restauração e limpeza dos filtros pela query string.

### Task 7: Verificação final

- [ ] Executar testes focados após cada ciclo TDD.
- [ ] Executar `pnpm typecheck:web`, `pnpm test:a11y`, `pnpm test:web` e `pnpm build:web` isoladamente.
- [ ] Executar Playwright em Chromium e auditoria axe real.
- [ ] Verificar visualmente 320, 390, 768, 1024 e 1440 px, console e overflow.
- [ ] Revisar `git diff` e confirmar que não há mudanças fora do escopo.
