export const meta = {
  name: 'executa-frontend-cadencia',
  description: 'Redesign completo do frontend do Cadencia: 50 tarefas em sequencia, design system + telas + polish. Um agente por tarefa.',
  phases: [
    { title: 'Execucao', detail: 'uma tarefa por vez, implementacao completa' },
    { title: 'Relatorio', detail: 'consolidar o que aconteceu' },
  ],
}

const RAIZ = 'C:/Users/Felipe/Downloads/novo projeto'

const TAREFAS = []
for (let n = 1; n <= 50; n++) TAREFAS.push(String(n))

const CONTEXTO = [
'# PROJETO CADENCIA — Redesign Frontend Completo',
'',
'Cadencia e um SaaS multi-tenant brasileiro de prontuario eletronico e gestao para clinicas medicas.',
'Voce trabalha no **redesign completo do frontend** para elevar a qualidade ao nivel de produto profissional.',
'',
'**Diretorio:** `' + RAIZ + '` · **Branch:** `fase-0-fundacao`',
'',
'## Stack do Frontend',
'',
'- **Framework:** Next.js 15, React 19, TypeScript',
'- **Styling:** Tailwind CSS v4 (config via CSS @import, NAO tailwind.config)',
'- **State:** TanStack React Query v5, nuqs (URL state), React Context (sessao)',
'- **Forms:** react-hook-form v7',
'- **Rich Text:** TipTap v3 (@tiptap/react, @tiptap/starter-kit, @tiptap/suggestion)',
'- **Charts:** visx (@visx/group, @visx/scale, @visx/shape, @visx/axis, @visx/responsive)',
'- **Drag & Drop:** @dnd-kit/core, @dnd-kit/utilities',
'- **Dialogs:** @radix-ui/react-dialog, @radix-ui/react-popover, + mais Radix depois da task 1',
'- **Animations:** motion (a instalar na task 1)',
'- **Icons:** @phosphor-icons/react (a instalar na task 1)',
'- **Testing:** Vitest, @testing-library/react, vitest-axe',
'- **Packages internos:** @cadencia/kernel, @cadencia/reports',
'',
'## Design System Existente (globals.css)',
'',
'O projeto JA TEM um design system OKLCH bem construido em `apps/web/app/globals.css`:',
'- Primitivas OKLCH: --tinta-* (azul/indigo), --papel-* (neutro quente), --grafite-* (escuro), --verde-*, --ambar-*, --rubi-*, --violeta-*',
'- Tokens semanticos: --bg, --surface, --text, --accent, --ok, --warn, --danger, --ai',
'- Tipografia: IBM Plex Sans (--font-ui), IBM Plex Mono (--font-mono), IBM Plex Serif (--font-doc)',
'- Escala de espacamento: --s-1 ate --s-11',
'- Raios: --r-sm, --r-md, --r-lg, --r-xl, --r-full',
'- Elevacao: --elev-1, --elev-2',
'- Movimento: --dur-1 (90ms), --dur-2 (140ms), --dur-3 (200ms)',
'- Dark mode COMPLETO via prefers-color-scheme + data-theme attribute',
'- Reduced motion support',
'',
'**PRESERVAR todos os tokens existentes.** Adicionar novos conforme necessario.',
'',
'## Direcao de Design',
'',
'- **Trust-first**: software medico precisa transmitir confianca e profissionalismo',
'- **Data-dense**: clinicas lidam com muita informacao — densidade alta mas organizada',
'- **OKLCH + IBM Plex**: manter — sao escolhas excelentes para healthcare',
'- **Inline styles → Tailwind**: migrar todos os componentes de style={{}} para classes Tailwind',
'- **Radix UI**: usar primitivas Radix para todos componentes interativos',
'- **Motion**: animacoes funcionais (entrada, transicao de estado, feedback)',
'- **Phosphor Icons**: iconografia consistente em todo o app',
'- **Skeleton loading**: todos os conteudos assincronos',
'- **Error/empty states**: todas as listas e tabelas',
'- **Responsive**: mobile-first, breakpoints 375/768/1024/1440',
'- **Dark mode**: verificar TODOS os componentes em ambos os modos',
'- **Acessibilidade**: WCAG AA, focus-visible, aria-labels, vitest-axe',
'',
'## Regras Vinculantes',
'',
'1. **Tailwind classes, NAO inline styles.** Usar className="" em vez de style={{}}.',
'2. **cn() helper.** Importar de src/lib/cn.ts para compor classes condicionalmente.',
'3. **Radix primitivas.** Dialog, Popover, Select, Tooltip, Toast, Tabs, DropdownMenu — usar os de @radix-ui.',
'4. **Phosphor icons.** Importar de @phosphor-icons/react. Nunca hand-roll SVG.',
'5. **Motion para animacoes.** Importar de motion/react. Nunca window.addEventListener("scroll").',
'6. **Nomes em portugues.** Componentes e props em portugues (Botao, Campo, rotulo, etc).',
'7. **Testes em portugues.** Nomes de teste e comentarios em portugues.',
'8. **Commits em ingles.** Conventional Commits: feat(web): rebuild Botao with Tailwind + Motion.',
'9. **Manter compatibilidade.** Props publicas dos componentes existentes devem continuar funcionando.',
'10. **vitest-axe em cada componente.** Todo .test.tsx deve incluir teste de acessibilidade.',
'',
'## Padroes de Codigo',
'',
'```tsx',
'// Padrao de componente:',
'"use client";',
'',
'import { cn } from "@/lib/cn";',
'import { type VariantProps, cva } from "class-variance-authority"; // se necessario',
'',
'interface MeuComponenteProps {',
'  readonly variante?: "primario" | "secundario";',
'  readonly className?: string;',
'}',
'',
'export function MeuComponente({ variante = "primario", className }: MeuComponenteProps) {',
'  return (',
'    <div className={cn("rounded-md border border-[var(--line)] bg-[var(--surface)]", className)}>',
'      {/* conteudo */}',
'    </div>',
'  );',
'}',
'```',
'',
'```tsx',
'// Padrao de Tailwind com CSS variables:',
'className="bg-[var(--surface)] text-[var(--text)] border-[var(--line)]"',
'className="text-[var(--fs-14)] font-[var(--fw-medium)]"',
'className="p-[var(--s-4)] gap-[var(--s-3)]"',
'className="rounded-[var(--r-md)]"',
'className="shadow-[var(--elev-1)]"',
'```',
'',
'```tsx',
'// Padrao de teste:',
'import { describe, expect, it } from "vitest";',
'import { render, screen } from "@testing-library/react";',
'import { axe } from "vitest-axe";',
'import { MeuComponente } from "./MeuComponente";',
'',
'describe("MeuComponente", () => {',
'  it("renderiza sem violacoes de acessibilidade", async () => {',
'    const { container } = render(<MeuComponente />);',
'    expect(await axe(container)).toHaveNoViolations();',
'  });',
'});',
'```',
'',
'## Comandos',
'',
'`pnpm test` · `pnpm typecheck` · `pnpm lint:session-guc`',
'',
'## Referencias no disco',
'',
'- Design system: `' + RAIZ + '/apps/web/app/globals.css`',
'- Componentes UI: `' + RAIZ + '/apps/web/src/ui/`',
'- Telas: `' + RAIZ + '/apps/web/src/telas/`',
'- Sua tarefa: `' + RAIZ + '/.tasks-frontend/task-<N>.md`',
'- Package.json: `' + RAIZ + '/apps/web/package.json`',
].join('\n')

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    resumo: { type: 'string', description: 'O que foi implementado, em 3-6 linhas' },
    testes: { type: 'string', description: 'Comandos rodados e numeros REAIS de testes passando' },
    commit: { type: 'string', description: 'SHA curto do commit, ou vazio se nao commitou' },
    arquivos: { type: 'array', items: { type: 'string' } },
    preocupacoes: { type: 'array', items: { type: 'string' } },
    motivoDoBloqueio: { type: 'string', description: 'Preencher SOMENTE se BLOCKED ou NEEDS_CONTEXT' },
  },
  required: ['status', 'resumo', 'testes', 'arquivos'],
}

const REGRAS_IMPL = [
'## Como trabalhar',
'',
'Implemente **exatamente** o que a tarefa especifica. Antes de comecar, leia:',
'1. O arquivo da tarefa (.tasks-frontend/task-N.md)',
'2. Os arquivos existentes que voce vai modificar',
'3. O globals.css para entender os tokens disponiveis',
'4. O package.json para entender as dependencias disponiveis',
'',
'**Fluxo:** Ler tarefa → ler codigo existente → implementar → rodar testes → commitar.',
'',
'## Divergencias conhecidas',
'',
'**1. Alguns pacotes podem nao estar instalados ainda.** A task 1 instala as dependencias.',
'Se uma dependencia nao existe, registre em preocupacoes e use o que esta disponivel.',
'',
'**2. O cn() helper pode nao existir.** A task 3 cria ele.',
'Se cn() nao existe quando voce precisa, use template literals simples para compor classes.',
'',
'**3. Componentes Radix podem nao estar instalados.** A task 1 instala.',
'Se Radix nao esta disponivel, use HTML nativo e registre em preocupacoes.',
'',
'## Qualidade visual obrigatoria',
'',
'- Cada componente DEVE ficar bonito em light mode E dark mode',
'- Cada componente DEVE funcionar em mobile (375px) E desktop (1440px)',
'- Focus states visiveis (--focus-ring)',
'- Hover states com transicao suave',
'- Loading states com skeleton quando aplicavel',
'- Sem textos cortados ou overflow',
'',
'## Quando parar',
'',
'Use **BLOCKED** quando nao conseguir completar, e **NEEDS_CONTEXT** quando faltar informacao.',
'Preencha motivoDoBloqueio com precisao.',
'',
'**Nao improvise** diante de ambiguidade real. Reporte numeros REAIS de teste.',
].join('\n')

phase('Execucao')

const historico = []
let paradaPorBloqueio = null

for (let i = 0; i < TAREFAS.length; i++) {
  const N = TAREFAS[i]
  const arquivoTarefa = RAIZ + '/.tasks-frontend/task-' + N + '.md'

  const promptImpl = [
    CONTEXTO,
    '',
    '---',
    '',
    '# SUA TAREFA: Task ' + N,
    '',
    'O texto integral esta em:',
    '`' + arquivoTarefa + '`',
    '',
    '**Leia esse arquivo primeiro, inteiro, com a ferramenta Read.** Nao invente nada que nao esteja la.',
    '',
    'Antes de escrever codigo, rode `git log --oneline -5` e olhe o estado real do repositorio.',
    '',
    '**Se a tarefa ja estiver implementada**, confirme rodando os testes e reporte DONE com os numeros reais.',
    '',
    REGRAS_IMPL,
  ].join('\n')

  let impl = await agent(promptImpl, {
    label: 'frontend-' + N, phase: 'Execucao', schema: IMPL_SCHEMA, effort: 'high',
  })

  if (!impl) {
    paradaPorBloqueio = { tarefa: N, etapa: 'implementacao', motivo: 'o agente nao retornou resultado' }
    break
  }

  if (impl.status === 'BLOCKED' || impl.status === 'NEEDS_CONTEXT') {
    paradaPorBloqueio = { tarefa: N, etapa: 'implementacao', status: impl.status, motivo: impl.motivoDoBloqueio || impl.resumo, detalhe: impl }
    break
  }

  historico.push({
    tarefa: N,
    status: impl.status,
    resumo: impl.resumo,
    testes: impl.testes,
    commit: impl.commit,
    preocupacoes: impl.preocupacoes || [],
  })

  log('Task ' + N + ' concluida (' + (i + 1) + '/' + TAREFAS.length + ') · commit ' + (impl.commit || '?'))
}

phase('Relatorio')

const resumo = await agent([
  'Voce e o relator de um redesign frontend completo do projeto Cadencia (SaaS de prontuario eletronico).',
  '',
  'Abaixo esta o historico das tarefas executadas e, se houver, o ponto onde a execucao parou.',
  '',
  'Escreva um relatorio em **portugues do Brasil**, denso e honesto. Estrutura:',
  '',
  '## O que foi construido',
  'Agrupado por bloco funcional. O que mudou visualmente e tecnicamente.',
  '',
  '## Numeros',
  'Tarefas concluidas, commits, testes rodando, problemas encontrados.',
  '',
  '## Onde parou e por que',
  'Se houve bloqueio: o que travou. Se completou, diga.',
  '',
  '## O que fica pendente',
  'Preocupacoes registradas, componentes que precisam de revisao visual.',
  '',
  'Nao invente nada que nao esteja no historico.',
  '',
  '## HISTORICO',
  JSON.stringify(historico, null, 1).slice(0, 200000),
  '',
  '## PARADA',
  paradaPorBloqueio ? JSON.stringify(paradaPorBloqueio, null, 1).slice(0, 40000) : 'Nenhuma. A execucao percorreu todas as tarefas.',
].join('\n'), { label: 'relatorio-frontend', phase: 'Relatorio', effort: 'high' })

return {
  relatorio: resumo,
  tarefasConcluidas: historico.length,
  totalPrevisto: TAREFAS.length,
  parada: paradaPorBloqueio,
  historico: historico,
}
