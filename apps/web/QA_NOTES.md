# QA notes — Cadência PRIME v3

## Validações executadas neste ambiente

- Parser TypeScript/TSX em todos os **171** arquivos `.ts/.tsx` de `src/` e `app/`: **0 erros de parser**.
- Parser CSS via PostCSS em `app/globals.css`.
- Compilação do conjunto de utilities pelo engine Tailwind v4 disponível no ambiente: **2.475 candidates** detectados nas 88 fontes não-test e CSS final de validação com ~179 KB, incluindo classes arbitrárias, breakpoints e tokens PRIME.
- Auditoria estática de contratos de testes existentes para manter roles, textos, callbacks, test ids e estados esperados nas telas redesenhadas.
- Renderização visual em Chromium real através de Playwright + Xvfb de um harness construído com as classes/tokens reais do produto em **1440×1000** e **390×844**.
- Inspeção visual de hierarquia, sidebar/dock, hero, métricas, rails, estados e responsividade desse harness; as duas viewports passaram na asserção de **ausência de overflow horizontal** e mantiveram um único `h1`.
- Auditoria de resolução de imports locais em `src/` e `app/`: **0 imports relativos/alias locais ausentes**.
- Cobertura desta segunda passada: **43/43 componentes de tela `.tsx` não-test em `src/telas` foram alterados** em relação à entrega Aurora anterior, além dos primitives globais.
- ZIP final validado com teste de integridade antes da entrega.

## Limitação do sandbox

O projeto entregue é apenas o pacote `@cadencia/web`. O `package.json` referencia `@cadencia/kernel` e `@cadencia/reports` via `workspace:*`, mas esses workspaces não estão presentes no ZIP de origem. Além disso, o registry npm disponível neste ambiente não oferece as dependências públicas do projeto. Por isso não é possível executar aqui um `npm install`, `next build` ou a suíte Vitest completa sem adulterar o manifesto/dependências.

Nenhuma dependência foi removida, substituída ou falsificada para produzir um “build verde” artificial. O `package.json` foi preservado.

## QA recomendado ao reintegrar no monorepo

1. `npm/pnpm install` no workspace raiz original.
2. `pnpm --filter @cadencia/web test` (ou comando equivalente do monorepo).
3. `pnpm --filter @cadencia/web build`.
4. Smoke visual em 390, 768, 1024, 1440 e 1920 px.
5. Smoke de teclado: `Tab`, `Shift+Tab`, `Esc`, `Enter`, `Ctrl/⌘ K`, `Alt+1..n`.
6. Verificação de `prefers-reduced-motion`. (Não há tema escuro — ver
   `DESIGN_SYSTEM.md`; `contrast.test.ts` falha se um for reintroduzido.)
7. Teste de conteúdo extremo: nomes > 80 caracteres, tabelas largas, listas vazias, erros de API e modo offline.
