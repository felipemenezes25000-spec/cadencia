# Fase 6 — Navegação e catálogos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar alcançáveis as 14 telas já construídas, consertar links quebrados, expandir o command palette, e criar as 7 telas de catálogo/configuração cujo backend já existe.

**Architecture:** Reescrever `nav.ts` como fonte única de navegação (sidebar, sub-navs, command palette derivam do mesmo dado). Criar layouts de sub-navegação por módulo no padrão já estabelecido por `FinanceiroLayout` e `ConveniosLayout`. Travar a regressão com um lint tool que compara `app/**/page.tsx` contra o grafo de navegação.

**Tech Stack:** Next.js 15 (App Router) · React 19 · Tailwind CSS · Radix UI · Phosphor Icons · Vitest + Testing Library + vitest-axe · `@cadencia/authz` (estático, zero deps)

**Contratos:** [`fase6/00-CONTRATOS.md`](fase6/00-CONTRATOS.md)

---

### Task 1: Fonte única de navegação — `nav.ts`

**Arquivos:**
- Modificar: `apps/web/src/ui/nav.ts`
- Criar: `apps/web/src/ui/nav.test.ts`

Reescreve `nav.ts` para ser a fonte de verdade de **toda** navegação: sidebar (com dois grupos), sub-rotas por módulo, e um índice flat para o command palette. Os consumidores (BarraDeNavegacao, layouts de módulo, palette) derivam do que está aqui — não mantêm listas próprias.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/web/src/ui/nav.test.ts
import { describe, expect, it } from 'vitest';
import {
  ITENS_NAV, CONFIG_NAV, FASE_ATUAL, indiceDeNavegacao,
  type ItemNav, type SubItemNav,
} from './nav';

describe('nav', () => {
  it('ITENS_NAV tem workspace e gestao', () => {
    const grupos = new Set(ITENS_NAV.map((i) => i.grupo));
    expect(grupos).toEqual(new Set(['workspace', 'gestao']));
  });

  it('todos os itens tem disponivelNaFase <= FASE_ATUAL', () => {
    for (const item of ITENS_NAV) {
      expect(item.disponivelNaFase).toBeLessThanOrEqual(FASE_ATUAL);
    }
  });

  it('atalhos sao unicos e sequenciais a partir de 1', () => {
    const atalhos = ITENS_NAV
      .filter((i): i is ItemNav & { atalho: string } => i.atalho !== undefined)
      .map((i) => i.atalho);
    expect(atalhos).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('nenhum href duplicado entre itens de topo', () => {
    const hrefs = ITENS_NAV.map((i) => i.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it('CONFIG_NAV tem filhos e nao tem atalho numerico', () => {
    expect(CONFIG_NAV.filhos.length).toBeGreaterThan(0);
    expect(CONFIG_NAV).not.toHaveProperty('atalho');
  });

  it('indiceDeNavegacao inclui todos os itens e filhos', () => {
    const indice = indiceDeNavegacao();
    // Deve ter mais itens que ITENS_NAV (por causa dos filhos)
    expect(indice.length).toBeGreaterThan(ITENS_NAV.length);
    // Todo item de topo aparece
    for (const item of ITENS_NAV) {
      expect(indice.find((i) => i.id === item.id)).toBeDefined();
    }
    // CONFIG_NAV e filhos aparecem
    expect(indice.find((i) => i.id === CONFIG_NAV.id)).toBeDefined();
    for (const filho of CONFIG_NAV.filhos) {
      expect(indice.find((i) => i.id === filho.id)).toBeDefined();
    }
  });

  it('nenhum id duplicado no indice', () => {
    const indice = indiceDeNavegacao();
    const ids = indice.map((i) => i.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('convenios tem disponivelNaFase 4', () => {
    const conv = ITENS_NAV.find((i) => i.id === 'convenios');
    expect(conv).toBeDefined();
    expect(conv!.disponivelNaFase).toBe(4);
  });

  it('relatorios aponta para /explorar', () => {
    const rel = ITENS_NAV.find((i) => i.id === 'relatorios');
    expect(rel).toBeDefined();
    expect(rel!.href).toBe('/explorar');
  });
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

```bash
cd apps/web && pnpm vitest run src/ui/nav.test.ts
```

Esperado: FAIL — `CONFIG_NAV`, `indiceDeNavegacao` e os novos itens não existem.

- [ ] **Step 3: Implementar**

```ts
// apps/web/src/ui/nav.ts
import {
  House,
  Calendar,
  ChatCircle,
  Users,
  Wallet,
  ShieldCheck,
  ChartBar,
  Table,
  GearSix,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

/* ── Tipos ───────────────────────────────────────────────────────────── */

export interface SubItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly descricao?: string;
}

export interface ItemNav {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly atalho?: string;
  readonly grupo: 'workspace' | 'gestao';
  readonly disponivelNaFase: 1 | 2 | 3 | 4 | 5;
  readonly filhos?: readonly SubItemNav[];
}

/* ── Sidebar ─────────────────────────────────────────────────────────── */

export const ITENS_NAV: readonly ItemNav[] = [
  /* --- workspace ---------------------------------------------------- */
  { id: 'hoje', rotulo: 'Hoje', href: '/hoje',
    icone: House, atalho: '1', grupo: 'workspace', disponivelNaFase: 1 },

  { id: 'agenda', rotulo: 'Agenda', href: '/agenda',
    icone: Calendar, atalho: '2', grupo: 'workspace', disponivelNaFase: 1,
    filhos: [
      { id: 'agenda-dia', rotulo: 'Agenda', href: '/agenda' },
      { id: 'agenda-lista-espera', rotulo: 'Lista de espera', href: '/agenda/lista-espera' },
    ] },

  { id: 'conversas', rotulo: 'Conversas', href: '/conversas',
    icone: ChatCircle, atalho: '3', grupo: 'workspace', disponivelNaFase: 2,
    filhos: [
      { id: 'conversas-caixa', rotulo: 'Caixa', href: '/conversas' },
      { id: 'conversas-automacoes', rotulo: 'Automacoes', href: '/conversas/automacoes' },
      { id: 'conversas-templates', rotulo: 'Templates', href: '/conversas/templates' },
    ] },

  { id: 'pacientes', rotulo: 'Pacientes', href: '/pacientes',
    icone: Users, atalho: '4', grupo: 'workspace', disponivelNaFase: 1 },

  /* --- gestão ------------------------------------------------------- */
  { id: 'financeiro', rotulo: 'Financeiro', href: '/financeiro',
    icone: Wallet, atalho: '5', grupo: 'gestao', disponivelNaFase: 2,
    filhos: [
      { id: 'fin-visao', rotulo: 'Visao geral', href: '/financeiro' },
      { id: 'fin-caixa', rotulo: 'Caixa', href: '/financeiro/caixa' },
      { id: 'fin-a-receber', rotulo: 'A receber', href: '/financeiro/a-receber' },
      { id: 'fin-a-pagar', rotulo: 'A pagar', href: '/financeiro/a-pagar' },
      { id: 'fin-recebimentos', rotulo: 'Recebimentos', href: '/financeiro/recebimentos' },
      { id: 'fin-repasse', rotulo: 'Repasse', href: '/financeiro/repasse' },
      { id: 'fin-cadastros', rotulo: 'Cadastros', href: '/financeiro/cadastros' },
      { id: 'fin-estoque', rotulo: 'Estoque', href: '/financeiro/estoque' },
    ] },

  { id: 'convenios', rotulo: 'Convenios', href: '/convenios',
    icone: ShieldCheck, atalho: '6', grupo: 'gestao', disponivelNaFase: 4,
    filhos: [
      { id: 'conv-a-faturar', rotulo: 'A faturar', href: '/convenios' },
      { id: 'conv-lotes', rotulo: 'Lotes', href: '/convenios/lotes' },
      { id: 'conv-retornos', rotulo: 'Retornos', href: '/convenios/retornos' },
      { id: 'conv-glosas', rotulo: 'Glosas', href: '/convenios/glosas' },
      { id: 'conv-recursos', rotulo: 'Recursos', href: '/convenios/recursos' },
      { id: 'conv-operadoras', rotulo: 'Operadoras', href: '/convenios/operadoras' },
    ] },

  { id: 'desempenho', rotulo: 'Desempenho', href: '/desempenho',
    icone: ChartBar, atalho: '7', grupo: 'gestao', disponivelNaFase: 3,
    filhos: [
      { id: 'desemp-indicadores', rotulo: 'Indicadores', href: '/desempenho' },
      { id: 'desemp-nps', rotulo: 'NPS', href: '/desempenho/nps' },
    ] },

  { id: 'relatorios', rotulo: 'Relatorios', href: '/explorar',
    icone: Table, atalho: '8', grupo: 'gestao', disponivelNaFase: 3 },
];

/* ── Configurações (rodapé, sem atalho numérico) ─────────────────────── */

export const CONFIG_NAV = {
  id: 'configuracoes',
  rotulo: 'Configuracoes',
  href: '/configuracoes',
  icone: GearSix,
  filhos: [
    { id: 'cfg-clinica', rotulo: 'Clinica', href: '/configuracoes',
      descricao: 'Dados da unidade e equipe' },
    { id: 'cfg-permissoes', rotulo: 'Permissoes', href: '/configuracoes/permissoes',
      descricao: 'Matriz papel × acao' },
    { id: 'cfg-procedimentos', rotulo: 'Procedimentos', href: '/configuracoes/procedimentos',
      descricao: 'Procedimentos cadastrados na unidade' },
    { id: 'cfg-prontuario', rotulo: 'Prontuario', href: '/configuracoes/prontuario',
      descricao: 'Secoes e campos do prontuario' },
    { id: 'cfg-auditoria', rotulo: 'Auditoria', href: '/configuracoes/auditoria',
      descricao: 'Trilha de auditoria do tenant' },
    { id: 'cfg-catalogos', rotulo: 'Catalogos', href: '/catalogos',
      descricao: 'CID-10, CID-11, TUSS' },
    { id: 'cfg-perfil', rotulo: 'Meu perfil', href: '/configuracoes/perfil',
      descricao: 'Seus dados e troca de unidade' },
  ],
} as const satisfies {
  readonly id: string;
  readonly rotulo: string;
  readonly href: string;
  readonly icone: PhosphorIcon;
  readonly filhos: readonly SubItemNav[];
};

export const FASE_ATUAL = 6 as const;

/* ── Índice flat para command palette ────────────────────────────────── */

/**
 * Todos os destinos do app, flat, derivado da árvore.
 *
 * O command palette (⌘K) filtra este índice — não mantém lista própria.
 * Duas listas escritas à mão divergem; foi exatamente assim que as 8 rotas
 * órfãs surgiram.
 */
export function indiceDeNavegacao(): readonly SubItemNav[] {
  const itens: SubItemNav[] = [];

  for (const item of ITENS_NAV.filter((i) => i.disponivelNaFase <= FASE_ATUAL)) {
    itens.push({ id: item.id, rotulo: item.rotulo, href: item.href });
    if (item.filhos) {
      for (const filho of item.filhos) {
        itens.push(filho);
      }
    }
  }

  itens.push({ id: CONFIG_NAV.id, rotulo: CONFIG_NAV.rotulo, href: CONFIG_NAV.href });
  for (const filho of CONFIG_NAV.filhos) {
    itens.push(filho);
  }

  return itens;
}
```

- [ ] **Step 4: Rodar o teste — deve passar**

```bash
cd apps/web && pnpm vitest run src/ui/nav.test.ts
```

Esperado: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/nav.ts apps/web/src/ui/nav.test.ts
git commit -m "feat(web): rewrite nav.ts as single source of truth for all navigation

Adds grupo (workspace/gestao), CONFIG_NAV for settings in footer,
sub-routes per module, and indiceDeNavegacao() flat index for command palette.
Convenios (phase 4), Relatorios (phase 3), and Configuracoes are now declared."
```

---

### Task 2: BarraDeNavegacao — dois grupos e menu de usuário

**Arquivos:**
- Modificar: `apps/web/src/ui/BarraDeNavegacao.tsx`
- Criar: `apps/web/src/ui/BarraDeNavegacao.test.tsx`

O maior delta de toda a fase. A sidebar precisa: (1) separar itens em "workspace" e
"gestão", (2) mostrar Configurações no rodapé com ícone de engrenagem, (3) substituir
o bloco de usuário fixo por um menu real que lê `useSessao()` e oferece trocar de
unidade e sair.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';

/* ── Mocks ────────────────────────────────────────────────────────────── */

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockTrocarUnidade = vi.fn().mockResolvedValue(undefined);
const mockSair = vi.fn().mockResolvedValue(undefined);
vi.mock('../sessao', async () => {
  const actual = await vi.importActual('../sessao');
  return {
    ...actual as object,
    useSessao: () => ({
      clinicId: 'c1',
      csrfToken: 'tok',
      usuario: {
        userId: 'u1', email: 'dr@test.com', nome: 'Dr. Test', mfaOk: true,
        unidadeAtiva: { tenantId: 't1', clinicId: 'c1' },
        vinculos: [
          { tenantId: 't1', clinicId: 'c1', clinicNome: 'Clinica A',
            tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'admin_clinico' as const },
          { tenantId: 't1', clinicId: 'c2', clinicNome: 'Clinica B',
            tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'profissional' as const },
        ],
      },
      vinculoAtivo: {
        tenantId: 't1', clinicId: 'c1', clinicNome: 'Clinica A',
        tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'admin_clinico',
      },
      trocarUnidade: mockTrocarUnidade,
      sair: mockSair,
    }),
  };
});

/* ── Mock de useMediaQuery para forçar desktop ───────────────────────── */
vi.mock('../lib/hooks', () => ({
  useMediaQuery: () => false,
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('BarraDeNavegacao', () => {
  it('renderiza os dois grupos da sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText('Workspace')).toBeDefined();
    expect(screen.getByText('Gestao')).toBeDefined();
  });

  it('mostra Convenios na sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /convenios/i })).toBeDefined();
  });

  it('mostra Relatorios na sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /relatorios/i })).toBeDefined();
  });

  it('mostra nome do usuario real no bloco do rodape', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText('Dr. Test')).toBeDefined();
  });

  it('mostra nome da clinica ativa', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText(/Clinica A/)).toBeDefined();
  });

  it('tem link para configuracoes no rodape', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /configuracoes/i })).toBeDefined();
  });

  it('passa a11y', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
cd apps/web && pnpm vitest run src/ui/BarraDeNavegacao.test.tsx
```

Esperado: FAIL — os grupos, itens novos e o menu de usuário real não existem.

- [ ] **Step 3: Implementar a BarraDeNavegacao**

A implementação modifica `BarraDeNavegacao.tsx`. Mudanças chave:

1. **Importar `useSessao`** para ler nome, unidade, vinculos.
2. **Separar `itensVisiveis` por grupo** — `workspace` acima, `gestao` abaixo com rótulo.
3. **Adicionar `CONFIG_NAV`** ao rodapé como link para `/configuracoes` com ícone `GearSix`.
4. **Substituir o bloco de usuário fixo** por um `Popover` que mostra: nome do usuário, papel, unidade ativa, lista de outras unidades com botão de troca, e "Sair".
5. **Atualizar o Command Palette** para usar `indiceDeNavegacao()` em vez de filtrar `ITENS_NAV`.

Mudanças no `BarraDeNavegacao.tsx`:

```tsx
// No topo, adicionar imports:
import { useSessao, rotulo as rotuloRole } from '../sessao';
import {
  ITENS_NAV, CONFIG_NAV, FASE_ATUAL, indiceDeNavegacao,
} from './nav';
import { GearSix, SignOut } from '@phosphor-icons/react';

// Substituir o bloco desktop sidebar body por dois grupos:

// Dentro do <ul>, separar:
const workspace = itensVisiveis.filter((i) => i.grupo === 'workspace');
const gestao = itensVisiveis.filter((i) => i.grupo === 'gestao');

// Renderizar com rótulos de grupo:
{!colapsado && <motion.p ...>Workspace</motion.p>}
{workspace.map(item => /* link existente */)}

{!colapsado && <motion.p ...>Gestao</motion.p>}
{gestao.map(item => /* link existente */)}

// Antes do bloco de usuário, adicionar link para Configurações:
<Link href={CONFIG_NAV.href}>
  <CONFIG_NAV.icone size={19} />
  {!colapsado && CONFIG_NAV.rotulo}
</Link>

// Substituir o bloco fixo de usuário por um Popover com dados reais:
const { usuario, vinculoAtivo, trocarUnidade, sair } = useSessao();

// No Popover content:
// - Nome e email
// - Papel do vínculo ativo (rotuloRole)
// - Unidade ativa
// - Se vinculos.length > 1: botões para trocar
// - Botão "Sair"
```

A implementação completa é longa por causa do CSS, mas segue exatamente os padrões
já existentes no componente. O formato do Popover segue o `MenuMais` mobile que já
existe no arquivo.

Para o Command Palette (`CommandPalette` dentro de `BarraDeNavegacao.tsx`):

```tsx
// Substituir:
//   const itens = ITENS_NAV.filter(item => item.disponivelNaFase <= FASE_ATUAL)...
// Por:
const todosOsDestinos = useMemo(() => indiceDeNavegacao(), []);
const itens = useMemo(() => {
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  return todosOsDestinos.filter(
    (item) => !termo
      || item.rotulo.toLocaleLowerCase('pt-BR').includes(termo)
      || (item.descricao?.toLocaleLowerCase('pt-BR').includes(termo) ?? false),
  );
}, [busca, todosOsDestinos]);
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
cd apps/web && pnpm vitest run src/ui/BarraDeNavegacao.test.tsx
```

- [ ] **Step 5: Rodar testes existentes — nenhuma regressão**

```bash
cd apps/web && pnpm vitest run src/ui/nav.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/BarraDeNavegacao.tsx apps/web/src/ui/BarraDeNavegacao.test.tsx
git commit -m "feat(web): sidebar with two groups, real user menu, and expanded command palette

Sidebar splits into Workspace and Gestao groups. Convenios, Relatorios, and
Configuracoes are now reachable. User block reads useSessao() and offers
switch unit + logout. Command palette indexes all destinations via
indiceDeNavegacao() instead of the old 6-item list."
```

---

### Task 3: Corrigir FinanceiroLayout — aba 404 e Cadastros órfão

**Arquivos:**
- Modificar: `apps/web/src/telas/FinanceiroLayout.tsx`
- Modificar: `apps/web/src/telas/FinanceiroLayout.test.tsx` (atualizar expectativas)

O diff é cirúrgico: trocar a aba `convenios → /financeiro/convenios` (404) por
`cadastros → /financeiro/cadastros` (tela que já existe e ninguém linkava).

- [ ] **Step 1: Atualizar o teste**

No arquivo de teste existente, ajustar as expectativas. A aba "Convenios" apontava
para rota inexistente. A nova aba é "Cadastros":

```tsx
// Em FinanceiroLayout.test.tsx, substituir qualquer referência a "Convenios" tab por "Cadastros":
// expect(screen.getByText('Convenios')).toBeDefined()  →  expect(screen.getByText('Cadastros')).toBeDefined()
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
cd apps/web && pnpm vitest run src/telas/FinanceiroLayout.test.tsx
```

- [ ] **Step 3: Editar FinanceiroLayout.tsx**

```tsx
// Em ABAS_FINANCEIRO, substituir a linha 38:
// DE:
{ value: "convenios", rotulo: "Convenios", href: "/financeiro/convenios" },
// PARA:
{ value: "cadastros", rotulo: "Cadastros", href: "/financeiro/cadastros" },

// E no tipo AbaFinanceiro, substituir "convenios" por "cadastros":
export type AbaFinanceiro =
  | "visao" | "caixa" | "a-receber" | "a-pagar"
  | "recebimentos" | "repasse" | "cadastros" | "estoque";
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
cd apps/web && pnpm vitest run src/telas/FinanceiroLayout.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/telas/FinanceiroLayout.tsx apps/web/src/telas/FinanceiroLayout.test.tsx
git commit -m "fix(web): replace dead Convenios tab (404) with Cadastros in FinanceiroLayout

The old tab pointed to /financeiro/convenios which never existed.
Convenios is now a top-level sidebar item at /convenios.
Cadastros (/financeiro/cadastros) existed but was unreachable."
```

---

### Task 4: Sub-navegação — layouts de Agenda, Conversas, Desempenho

**Arquivos:**
- Criar: `apps/web/app/agenda/layout.tsx`
- Criar: `apps/web/app/conversas/layout.tsx`
- Criar: `apps/web/app/desempenho/layout.tsx`
- Modificar: `apps/web/app/desempenho/page.tsx` (remover link inline para NPS)

Os três layouts seguem exatamente o padrão de `app/convenios/layout.tsx`: componente
puro que renderiza tabs e envolve `children`.

- [ ] **Step 1: Criar layout da Agenda**

```tsx
// apps/web/app/agenda/layout.tsx
'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Printer } from '@phosphor-icons/react';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';
import { Botao } from '../../src/ui/Botao';

const ABAS = [
  { value: 'agenda', rotulo: 'Agenda', href: '/agenda' },
  { value: 'lista-espera', rotulo: 'Lista de espera', href: '/agenda/lista-espera' },
] as const;

export default function LayoutAgenda({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Na tela de impressão o layout envolve mas não renderiza tabs — a
  // impressão é ação, não seção.
  const naImpressao = pathname === '/agenda/imprimir';
  if (naImpressao) return <>{children}</>;

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'agenda';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader
        titulo="Agenda"
        semBreadcrumb
        acoes={
          <Botao
            variante="secundario"
            tamanho="sm"
            iconeEsquerda={Printer}
            onClick={() => router.push('/agenda/imprimir')}
          >
            Imprimir
          </Botao>
        }
      />

      <Tabs
        value={abaAtiva}
        onValueChange={(v: string) => {
          const aba = ABAS.find((a) => a.value === v);
          if (aba) router.push(aba.href);
        }}
      >
        <TabsList>
          {ABAS.map((aba) => (
            <TabsTrigger key={aba.value} value={aba.value}>
              {aba.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
```

- [ ] **Step 2: Criar layout de Conversas**

```tsx
// apps/web/app/conversas/layout.tsx
'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';

const ABAS = [
  { value: 'caixa', rotulo: 'Caixa', href: '/conversas' },
  { value: 'automacoes', rotulo: 'Automacoes', href: '/conversas/automacoes' },
  { value: 'templates', rotulo: 'Templates', href: '/conversas/templates' },
] as const;

export default function LayoutConversas({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'caixa';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Conversas" semBreadcrumb />

      <Tabs
        value={abaAtiva}
        onValueChange={(v: string) => {
          const aba = ABAS.find((a) => a.value === v);
          if (aba) router.push(aba.href);
        }}
      >
        <TabsList>
          {ABAS.map((aba) => (
            <TabsTrigger key={aba.value} value={aba.value}>
              {aba.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
```

- [ ] **Step 3: Criar layout de Desempenho**

```tsx
// apps/web/app/desempenho/layout.tsx
'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';

const ABAS = [
  { value: 'indicadores', rotulo: 'Indicadores', href: '/desempenho' },
  { value: 'nps', rotulo: 'NPS', href: '/desempenho/nps' },
] as const;

export default function LayoutDesempenho({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'indicadores';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Desempenho" semBreadcrumb />

      <Tabs
        value={abaAtiva}
        onValueChange={(v: string) => {
          const aba = ABAS.find((a) => a.value === v);
          if (aba) router.push(aba.href);
        }}
      >
        <TabsList>
          {ABAS.map((aba) => (
            <TabsTrigger key={aba.value} value={aba.value}>
              {aba.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
```

- [ ] **Step 4: Remover o link inline de NPS do `app/desempenho/page.tsx`**

No `DesempenhoInner`, remover o bloco:

```tsx
// REMOVER estas linhas (estavam logo antes do <Desempenho>):
<div style={{ maxWidth: 960, margin: '0 auto',
              padding: 'var(--s-8) var(--s-8) 0' }}>
  <Link href="/desempenho/nps"
    className="text-sm text-accent underline-offset-4 hover:underline">
    Ver satisfacao dos pacientes (NPS) →
  </Link>
</div>
```

E remover o import `Link from 'next/link'` se ficar sem uso.

- [ ] **Step 5: Verificar que as telas existentes ainda renderizam**

As páginas dentro de `/agenda`, `/conversas` e `/desempenho` já existem. Os novos
layouts os envolvem. Duas coisas podem quebrar:

1. A página filha já renderiza seu próprio `PageHeader` — nesse caso, duplica.
   Verificar e remover o `PageHeader` da página filha se o layout já o provê.
2. A página filha tem wrapper CSS (`.cadencia-page`) — duplica padding.
   Remover da página filha.

Verificar cada `page.tsx` sob `/agenda`, `/conversas` e `/desempenho`:
- Se já tem `<PageHeader titulo="Agenda" ...>`, remover.
- Se já tem `className="cadencia-page"`, remover.

- [ ] **Step 6: Rodar os testes existentes das telas afetadas**

```bash
cd apps/web && pnpm vitest run src/telas/Agenda.test.tsx src/telas/Conversas.test.tsx src/telas/desempenho/Desempenho.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/agenda/layout.tsx apps/web/app/conversas/layout.tsx \
        apps/web/app/desempenho/layout.tsx apps/web/app/desempenho/page.tsx
git commit -m "feat(web): add tab sub-navigation to Agenda, Conversas, and Desempenho

Each module gets a layout.tsx with tabs, following the pattern of
ConveniosLayout and FinanceiroLayout. Agenda layout adds a Print button.
Desempenho layout replaces the inline NPS link with a proper tab."
```

---

### Task 5: Layout de Configurações

**Arquivos:**
- Criar: `apps/web/app/configuracoes/layout.tsx`
- Modificar: `apps/web/app/configuracoes/page.tsx` (remover `PageHeader` e wrapper se duplicado)

- [ ] **Step 1: Criar o layout**

```tsx
// apps/web/app/configuracoes/layout.tsx
'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '../../src/lib/cn';
import { PageHeader } from '../../src/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '../../src/ui/Tabs';

const ABAS = [
  { value: 'clinica', rotulo: 'Clinica', href: '/configuracoes' },
  { value: 'permissoes', rotulo: 'Permissoes', href: '/configuracoes/permissoes' },
  { value: 'procedimentos', rotulo: 'Procedimentos', href: '/configuracoes/procedimentos' },
  { value: 'prontuario', rotulo: 'Prontuario', href: '/configuracoes/prontuario' },
  { value: 'auditoria', rotulo: 'Auditoria', href: '/configuracoes/auditoria' },
  { value: 'catalogos', rotulo: 'Catalogos', href: '/catalogos' },
  { value: 'perfil', rotulo: 'Meu perfil', href: '/configuracoes/perfil' },
] as const;

export default function LayoutConfiguracoes({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const abaAtiva = ABAS.find((a) => a.href === pathname)?.value ?? 'clinica';

  return (
    <div className="cadencia-page space-y-6 max-sm:p-4">
      <PageHeader titulo="Configuracoes" semBreadcrumb />

      <Tabs
        value={abaAtiva}
        onValueChange={(v: string) => {
          const aba = ABAS.find((a) => a.value === v);
          if (aba) router.push(aba.href);
        }}
      >
        <div className={cn('overflow-x-auto scrollbar-thin', '-mx-1 px-1')}>
          <TabsList className="min-w-max">
            {ABAS.map((aba) => (
              <TabsTrigger key={aba.value} value={aba.value}>
                {aba.rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {children}
    </div>
  );
}
```

- [ ] **Step 2: Ajustar `app/configuracoes/page.tsx`**

Remover o `<PageHeader>` e o wrapper `cadencia-page` da página, porque o layout já
provê ambos. O conteúdo (formulário da unidade + tabela da equipe) fica como está.

```tsx
// Na page.tsx, remover:
// - import { PageHeader } from '../../src/ui/PageHeader';
// - <div className="cadencia-page grid gap-8">  →  <div className="grid gap-8">
// - <PageHeader titulo="Configuracoes" subtitulo={...} />
```

- [ ] **Step 3: Rodar testes existentes de Configuracoes**

```bash
cd apps/web && pnpm vitest run src/telas/CadastrosFinanceiros.test.tsx
```

Não há teste específico para `PaginaConfiguracoes`, mas o typecheck cobre:

```bash
pnpm typecheck:web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/configuracoes/layout.tsx apps/web/app/configuracoes/page.tsx
git commit -m "feat(web): add tab layout to Configuracoes with 7 tabs

Tabs: Clinica, Permissoes, Procedimentos, Prontuario, Auditoria, Catalogos,
Meu perfil. Catalogos tab cross-links to /catalogos (not under /configuracoes)."
```

---

### Task 6: Telas de catálogos — hub, CID-10, CID-11, TUSS

**Arquivos:**
- Criar: `apps/web/src/telas/BuscaDeCatalogo.tsx`
- Criar: `apps/web/src/telas/BuscaDeCatalogo.test.tsx`
- Criar: `apps/web/app/catalogos/page.tsx`
- Criar: `apps/web/app/catalogos/cid10/page.tsx`
- Criar: `apps/web/app/catalogos/cid11/page.tsx`
- Criar: `apps/web/app/catalogos/tuss/page.tsx`

As três APIs de catálogo são de **busca** (`termo` min 2 chars), não de listagem.
As telas começam com estado vazio e campo de busca. O componente
`BuscaDeCatalogo` encapsula: input com debounce → call API → tabela de resultados.

- [ ] **Step 1: Escrever teste do BuscaDeCatalogo**

```tsx
// apps/web/src/telas/BuscaDeCatalogo.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BuscaDeCatalogo } from './BuscaDeCatalogo';

describe('BuscaDeCatalogo', () => {
  const buscar = vi.fn().mockResolvedValue([
    { codigo: 'J45', descricao: 'Asma' },
  ]);

  const colunas = [
    { chave: 'codigo' as const, rotulo: 'Codigo' },
    { chave: 'descricao' as const, rotulo: 'Descricao' },
  ];

  it('mostra estado vazio antes da busca', () => {
    render(
      <BuscaDeCatalogo
        titulo="CID-10"
        placeholder="Buscar por codigo ou descricao"
        colunas={colunas}
        buscar={buscar}
      />,
    );
    expect(screen.getByText(/digite ao menos 2 caracteres/i)).toBeDefined();
  });

  it('exibe resultados apos digitar >= 2 chars', async () => {
    const user = userEvent.setup();
    render(
      <BuscaDeCatalogo
        titulo="CID-10"
        placeholder="Buscar"
        colunas={colunas}
        buscar={buscar}
      />,
    );
    await user.type(screen.getByRole('searchbox'), 'J45');
    await waitFor(() => {
      expect(buscar).toHaveBeenCalledWith('J45');
    });
    await waitFor(() => {
      expect(screen.getByText('Asma')).toBeDefined();
    });
  });

  it('nao busca com menos de 2 chars', async () => {
    const user = userEvent.setup();
    render(
      <BuscaDeCatalogo
        titulo="CID-10"
        placeholder="Buscar"
        colunas={colunas}
        buscar={buscar}
      />,
    );
    await user.type(screen.getByRole('searchbox'), 'J');
    // Debounce de 300ms + margem
    await new Promise((r) => setTimeout(r, 500));
    expect(buscar).not.toHaveBeenCalled();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <BuscaDeCatalogo
        titulo="CID-10"
        placeholder="Buscar"
        colunas={colunas}
        buscar={buscar}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
cd apps/web && pnpm vitest run src/telas/BuscaDeCatalogo.test.tsx
```

- [ ] **Step 3: Implementar BuscaDeCatalogo**

```tsx
// apps/web/src/telas/BuscaDeCatalogo.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Skeleton } from '../ui/Skeleton';

export interface ColunaCatalogo<T> {
  readonly chave: keyof T & string;
  readonly rotulo: string;
}

export interface BuscaDeCatalogoProps<T extends Record<string, unknown>> {
  readonly titulo: string;
  readonly placeholder: string;
  readonly colunas: readonly ColunaCatalogo<T>[];
  readonly buscar: (termo: string) => Promise<T[]>;
}

export function BuscaDeCatalogo<T extends Record<string, unknown>>({
  titulo,
  placeholder,
  colunas,
  buscar,
}: BuscaDeCatalogoProps<T>) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const executarBusca = useCallback(async (t: string) => {
    if (t.length < 2) { setResultados([]); setBuscou(false); return; }
    setCarregando(true);
    try {
      const r = await buscar(t);
      setResultados(r);
      setBuscou(true);
    } finally {
      setCarregando(false);
    }
  }, [buscar]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (termo.length < 2) { setResultados([]); setBuscou(false); return; }
    timerRef.current = setTimeout(() => { void executarBusca(termo); }, 300);
    return () => clearTimeout(timerRef.current);
  }, [termo, executarBusca]);

  return (
    <div className="grid gap-6">
      <div className="relative max-w-lg">
        <MagnifyingGlass
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <input
          type="search"
          role="searchbox"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder={placeholder}
          aria-label={`Buscar em ${titulo}`}
          className="h-10 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {carregando && (
        <div className="grid gap-2">
          <Skeleton variant="table-row" />
          <Skeleton variant="table-row" />
          <Skeleton variant="table-row" />
        </div>
      )}

      {!carregando && !buscou && (
        <p className="py-12 text-center text-sm text-text-muted">
          Digite ao menos 2 caracteres para buscar.
        </p>
      )}

      {!carregando && buscou && resultados.length === 0 && (
        <p className="py-12 text-center text-sm text-text-muted">
          Nenhum resultado para &ldquo;{termo}&rdquo;.
        </p>
      )}

      {!carregando && resultados.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
              <tr>
                {colunas.map((col) => (
                  <th key={col.chave} className="px-4 py-2.5 font-medium">
                    {col.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultados.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {colunas.map((col) => (
                    <td key={col.chave} className="px-4 py-3">
                      {String(row[col.chave] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
cd apps/web && pnpm vitest run src/telas/BuscaDeCatalogo.test.tsx
```

- [ ] **Step 5: Criar o hub de catálogos**

```tsx
// apps/web/app/catalogos/page.tsx
'use client';

import Link from 'next/link';
import { Barcode, FirstAid, Heartbeat, Pill } from '@phosphor-icons/react';
import { PageHeader } from '../../src/ui/PageHeader';

const CATALOGOS = [
  { href: '/catalogos/cid10', icone: Heartbeat, titulo: 'CID-10',
    descricao: 'Classificacao Internacional de Doencas, 10a revisao' },
  { href: '/catalogos/cid11', icone: Heartbeat, titulo: 'CID-11',
    descricao: 'Classificacao Internacional de Doencas, 11a revisao (OMS)' },
  { href: '/catalogos/tuss', icone: Barcode, titulo: 'TUSS',
    descricao: 'Terminologia Unificada da Saude Suplementar (ANS)' },
  { href: '#', icone: Pill, titulo: 'Bulas',
    descricao: 'Em breve — catalogo de bulas ANVISA' },
] as const;

export default function PaginaCatalogos() {
  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader
        titulo="Catalogos"
        subtitulo="Tabelas de referencia do sistema de saude brasileiro."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOGOS.map((cat) => {
          const Icone = cat.icone;
          const desabilitado = cat.href === '#';
          const Wrapper = desabilitado ? 'div' : Link;
          return (
            <Wrapper
              key={cat.titulo}
              {...(desabilitado ? {} : { href: cat.href })}
              className={`rounded-xl border border-line bg-surface p-5 transition
                ${desabilitado ? 'opacity-50' : 'hover:border-accent hover:shadow-elev-1'}`}
            >
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icone size={22} weight="duotone" />
              </div>
              <h2 className="font-semibold text-text">{cat.titulo}</h2>
              <p className="mt-1 text-sm text-text-muted">{cat.descricao}</p>
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Criar página CID-10**

```tsx
// apps/web/app/catalogos/cid10/page.tsx
'use client';

import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';

interface ItemCid10 {
  codigo: string;
  descricao: string;
  capitulo: number | null;
  competencia: string;
}

const COLUNAS = [
  { chave: 'codigo' as const, rotulo: 'Codigo' },
  { chave: 'descricao' as const, rotulo: 'Descricao' },
  { chave: 'capitulo' as const, rotulo: 'Capitulo' },
  { chave: 'competencia' as const, rotulo: 'Competencia' },
];

export default function PaginaCid10() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="CID-10"
        subtitulo="Classificacao Internacional de Doencas, 10a revisao."
        breadcrumbs={[
          { rotulo: 'Catalogos', href: '/catalogos' },
          { rotulo: 'CID-10' },
        ]}
      />
      <BuscaDeCatalogo<ItemCid10>
        titulo="CID-10"
        placeholder="Buscar por codigo ou descricao (ex: J45, asma)"
        colunas={COLUNAS}
        buscar={async (termo) => {
          const r = await apiFetch<{ itens: ItemCid10[] }>(
            `/v1/catalogos/cid?termo=${encodeURIComponent(termo)}&data=${hoje}`,
            { clinicId, csrfToken },
          );
          return r.itens;
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Criar página CID-11**

```tsx
// apps/web/app/catalogos/cid11/page.tsx
'use client';

import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';

interface ItemCid11 {
  codigo: string;
  descricao: string;
  capitulo: string | null;
  uri: string;
  competencia: string;
}

const COLUNAS = [
  { chave: 'codigo' as const, rotulo: 'Codigo' },
  { chave: 'descricao' as const, rotulo: 'Descricao' },
  { chave: 'capitulo' as const, rotulo: 'Capitulo' },
  { chave: 'competencia' as const, rotulo: 'Competencia' },
];

export default function PaginaCid11() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="CID-11"
        subtitulo="Classificacao Internacional de Doencas, 11a revisao. Vigencia a partir de 2027."
        breadcrumbs={[
          { rotulo: 'Catalogos', href: '/catalogos' },
          { rotulo: 'CID-11' },
        ]}
      />
      <BuscaDeCatalogo<ItemCid11>
        titulo="CID-11"
        placeholder="Buscar por codigo ou descricao (ex: BA00, asma)"
        colunas={COLUNAS}
        buscar={async (termo) => {
          const r = await apiFetch<{ itens: ItemCid11[] }>(
            `/v1/catalogos/cid11?termo=${encodeURIComponent(termo)}&data=${hoje}`,
            { clinicId, csrfToken },
          );
          return r.itens;
        }}
      />
    </div>
  );
}
```

- [ ] **Step 8: Criar página TUSS**

```tsx
// apps/web/app/catalogos/tuss/page.tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { Select } from '../../../src/ui/Select';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';

interface ItemTuss {
  tabela: number;
  codigo: string;
  termo: string;
}

const COLUNAS = [
  { chave: 'tabela' as const, rotulo: 'Tabela' },
  { chave: 'codigo' as const, rotulo: 'Codigo' },
  { chave: 'termo' as const, rotulo: 'Termo' },
];

const TABELAS = [
  { value: '18', label: '18 — Diarias e taxas' },
  { value: '19', label: '19 — Materiais e OPME' },
  { value: '20', label: '20 — Medicamentos' },
  { value: '22', label: '22 — Procedimentos e eventos' },
  { value: '98', label: '98 — Outras despesas' },
];

export default function PaginaTuss() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);
  const [tabela, setTabela] = useState('22');

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="TUSS"
        subtitulo="Terminologia Unificada da Saude Suplementar — ANS."
        breadcrumbs={[
          { rotulo: 'Catalogos', href: '/catalogos' },
          { rotulo: 'TUSS' },
        ]}
      />

      <Select
        rotulo="Tabela"
        opcoes={TABELAS}
        value={tabela}
        onChange={setTabela}
        className="max-w-xs"
      />

      <BuscaDeCatalogo<ItemTuss>
        titulo="TUSS"
        placeholder="Buscar por codigo ou termo (ex: consulta)"
        colunas={COLUNAS}
        buscar={async (termo) => {
          const r = await apiFetch<{ itens: ItemTuss[] }>(
            `/v1/catalogos/tuss?tabela=${tabela}&termo=${encodeURIComponent(termo)}&data=${hoje}`,
            { clinicId, csrfToken },
          );
          return r.itens;
        }}
      />
    </div>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/telas/BuscaDeCatalogo.tsx apps/web/src/telas/BuscaDeCatalogo.test.tsx \
        apps/web/app/catalogos
git commit -m "feat(web): catalog hub + CID-10, CID-11, and TUSS search screens

BuscaDeCatalogo is a generic search-first component (debounced input, table).
Hub at /catalogos links to the three catalogs. Bulas placeholder included.
All three catalog APIs require termo >= 2 chars — screens start with empty state."
```

---

### Task 7: Tela de Procedimentos

**Arquivos:**
- Criar: `apps/web/app/configuracoes/procedimentos/page.tsx`

Os dados vêm de `GET /v1/procedimentos`. A tela lista os procedimentos cadastrados
na unidade, com código, nome, cor, duração e frequência de uso.

- [ ] **Step 1: Criar a página**

```tsx
// apps/web/app/configuracoes/procedimentos/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Barbell } from '@phosphor-icons/react';
import { Skeleton } from '../../../src/ui/Skeleton';
import { EstadoVazio } from '../../../src/ui/EstadoVazio';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface Procedimento {
  procedureId: string;
  code: string;
  nome: string;
  cor: string;
  duracaoMin: number;
  usosRecentes: number;
  maisFrequente: boolean;
}

export default function PaginaProcedimentos() {
  const { clinicId, csrfToken } = useSessao();
  const [itens, setItens] = useState<Procedimento[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiFetch<{ itens: Procedimento[] }>(
      '/v1/procedimentos', { clinicId, csrfToken },
    ).then((r) => { if (vivo) setItens(r.itens); });
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  if (itens === null) {
    return (
      <div className="grid gap-2">
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
        <Skeleton variant="table-row" />
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <EstadoVazio
        icone={Barbell}
        titulo="Nenhum procedimento cadastrado"
        descricao="Procedimentos aparecem aqui quando cadastrados na unidade."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Codigo</th>
            <th className="px-4 py-2.5 font-medium">Procedimento</th>
            <th className="px-4 py-2.5 font-medium">Duracao</th>
            <th className="px-4 py-2.5 font-medium">Usos (90 dias)</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.procedureId} className="border-t border-line">
              <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: p.cor }}
                    aria-hidden
                  />
                  <span className="font-medium">{p.nome}</span>
                  {p.maisFrequente && (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
                      frequente
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">{p.duracaoMin} min</td>
              <td className="px-4 py-3 text-text-muted">{p.usosRecentes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/configuracoes/procedimentos/page.tsx
git commit -m "feat(web): procedures listing page at /configuracoes/procedimentos

Lists clinic procedures from GET /v1/procedimentos with code, name, color,
duration, and usage frequency. Read-only in this phase."
```

---

### Task 8: Tela de Permissões (leitura)

**Arquivos:**
- Modificar: `apps/web/package.json` (adicionar `@cadencia/authz`)
- Criar: `apps/web/src/telas/MatrizPermissoes.tsx`
- Criar: `apps/web/src/telas/MatrizPermissoes.test.tsx`
- Criar: `apps/web/app/configuracoes/permissoes/page.tsx`

Renderiza a matriz papel × ação a partir de `@cadencia/authz` (estático, importado
direto). Sem endpoint — o catálogo vive no código.

- [ ] **Step 1: Adicionar dependência**

```bash
cd apps/web && pnpm add "@cadencia/authz@workspace:*"
```

Verificar que o dependency-cruiser permite (web → authz). A regra
`web-nao-fala-com-banco` barra apenas `db`, `jobs` e `outbox`. `authz` é permitido.

- [ ] **Step 2: Escrever o teste**

```tsx
// apps/web/src/telas/MatrizPermissoes.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MatrizPermissoes } from './MatrizPermissoes';

describe('MatrizPermissoes', () => {
  it('renderiza todas as colunas de roles', () => {
    render(<MatrizPermissoes />);
    expect(screen.getByText('Administracao')).toBeDefined();
    expect(screen.getByText('Direcao tecnica')).toBeDefined();
    expect(screen.getByText('Profissional')).toBeDefined();
    expect(screen.getByText('Recepcao')).toBeDefined();
    expect(screen.getByText('Financeiro')).toBeDefined();
  });

  it('renderiza ao menos 10 linhas de acao', () => {
    render(<MatrizPermissoes />);
    const rows = screen.getAllByRole('row');
    // header + >= 10 actions
    expect(rows.length).toBeGreaterThan(10);
  });

  it('indica acoes que exigem MFA', () => {
    render(<MatrizPermissoes />);
    expect(screen.getAllByText('MFA').length).toBeGreaterThan(0);
  });

  it('passa a11y', async () => {
    const { container } = render(<MatrizPermissoes />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Rodar teste — deve falhar**

```bash
cd apps/web && pnpm vitest run src/telas/MatrizPermissoes.test.tsx
```

- [ ] **Step 4: Implementar**

```tsx
// apps/web/src/telas/MatrizPermissoes.tsx
'use client';

import { useMemo } from 'react';
import { Check, ShieldCheck } from '@phosphor-icons/react';
import { ACTIONS, ROLES, type ActionDef, type Role } from '@cadencia/authz';
import { cn } from '../lib/cn';

const ROTULO_ROLE: Record<Role, string> = {
  admin_clinico: 'Administracao',
  diretor_tecnico: 'Direcao tecnica',
  profissional: 'Profissional',
  recepcao: 'Recepcao',
  financeiro: 'Financeiro',
};

/** Agrupa ações por domínio (prefixo antes do primeiro ponto). */
function agrupar(actions: readonly ActionDef[]): Map<string, ActionDef[]> {
  const grupos = new Map<string, ActionDef[]>();
  for (const a of actions) {
    const dominio = a.key.split('.')[0]!;
    const lista = grupos.get(dominio) ?? [];
    lista.push(a);
    grupos.set(dominio, lista);
  }
  return grupos;
}

export function MatrizPermissoes() {
  const grupos = useMemo(() => agrupar(ACTIONS), []);

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="w-80 px-4 py-2.5 font-medium">Acao</th>
            {ROLES.map((r) => (
              <th key={r} className="px-3 py-2.5 text-center font-medium">
                {ROTULO_ROLE[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...grupos.entries()].map(([dominio, acoes]) => (
            <GroupFragment key={dominio} dominio={dominio} acoes={acoes} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupFragment({ dominio, acoes }: {
  readonly dominio: string;
  readonly acoes: readonly ActionDef[];
}) {
  return (
    <>
      <tr className="bg-surface/80">
        <td
          colSpan={ROLES.length + 1}
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-text-faint"
        >
          {dominio}
        </td>
      </tr>
      {acoes.map((a) => (
        <tr key={a.key} className="border-t border-line">
          <td className="px-4 py-2.5">
            <span className="flex items-center gap-2">
              <span className="font-medium">{a.description}</span>
              {a.requiresMfa && (
                <span className="flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  <ShieldCheck size={12} /> MFA
                </span>
              )}
            </span>
            <span className="block text-[11px] text-text-faint font-mono">{a.key}</span>
          </td>
          {ROLES.map((role) => (
            <td key={role} className="px-3 py-2.5 text-center">
              {a.roles.includes(role) ? (
                <Check size={16} weight="bold" className="mx-auto text-ok" aria-label="Permitido" />
              ) : (
                <span className="text-text-faint" aria-label="Negado">—</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 5: Criar a página**

```tsx
// apps/web/app/configuracoes/permissoes/page.tsx
'use client';

import { MatrizPermissoes } from '../../../src/telas/MatrizPermissoes';

export default function PaginaPermissoes() {
  return <MatrizPermissoes />;
}
```

- [ ] **Step 6: Rodar teste — deve passar**

```bash
cd apps/web && pnpm vitest run src/telas/MatrizPermissoes.test.tsx
```

- [ ] **Step 7: Verificar dependency-cruiser**

```bash
pnpm arch:check
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml \
        apps/web/src/telas/MatrizPermissoes.tsx apps/web/src/telas/MatrizPermissoes.test.tsx \
        apps/web/app/configuracoes/permissoes/page.tsx
git commit -m "feat(web): permissions matrix at /configuracoes/permissoes

Renders the 134 actions from @cadencia/authz as a role × action matrix.
Read-only — editable permissions require inverting the source of truth (Phase 7).
Grouped by domain prefix, MFA-required actions flagged."
```

---

### Task 9: Meu Perfil

**Arquivos:**
- Criar: `apps/web/app/configuracoes/perfil/page.tsx`

Leitura da sessão e troca de unidade. `useSessao()` já expõe tudo. Troca de senha
e MFA ficam na Fase 7 (precisa de rota de escrita de credencial).

- [ ] **Step 1: Criar a página**

```tsx
// apps/web/app/configuracoes/perfil/page.tsx
'use client';

import { useState } from 'react';
import { User, Buildings, SignOut } from '@phosphor-icons/react';
import { useSessao, rotulo } from '../../../src/sessao';
import { Botao } from '../../../src/ui/Botao';

export default function PaginaPerfil() {
  const { usuario, vinculoAtivo, trocarUnidade, sair } = useSessao();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  const outrasUnidades = usuario.vinculos.filter(
    (v) => v.clinicId !== vinculoAtivo.clinicId,
  );

  return (
    <div className="grid max-w-2xl gap-8">
      {/* Dados do usuário */}
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Seus dados
        </h2>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <User size={24} weight="bold" />
            </div>
            <div>
              <p className="font-semibold text-text">{usuario.nome}</p>
              <p className="text-sm text-text-muted">{usuario.email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-text-muted">Papel nesta unidade</dt>
              <dd className="font-medium">{rotulo(vinculoAtivo.role)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">MFA</dt>
              <dd className="font-medium">
                {usuario.mfaOk ? 'Ativo' : 'Nao configurado'}
              </dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-text-muted">
          Troca de senha e cadastro de MFA chegam em breve.
        </p>
      </section>

      {/* Unidade ativa */}
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Unidade ativa
        </h2>
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-5">
          <div className="flex items-center gap-3">
            <Buildings size={20} className="text-accent" />
            <div>
              <p className="font-semibold text-text">{vinculoAtivo.clinicNome}</p>
              <p className="text-xs text-text-muted">
                {vinculoAtivo.tenantNome} · {rotulo(vinculoAtivo.role)} · {vinculoAtivo.timezone}
              </p>
            </div>
          </div>
        </div>

        {outrasUnidades.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Trocar para outra unidade
            </h3>
            <ul className="grid gap-2">
              {outrasUnidades.map((v) => (
                <li key={v.clinicId}>
                  <button
                    type="button"
                    disabled={trocando !== null}
                    onClick={() => {
                      setTrocando(v.clinicId);
                      void trocarUnidade(v.clinicId).finally(() => setTrocando(null));
                    }}
                    className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm transition hover:border-accent hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="block font-medium">{v.clinicNome}</span>
                    <span className="block text-xs text-text-muted">
                      {v.tenantNome} · {rotulo(v.role)}
                    </span>
                    {trocando === v.clinicId && (
                      <span className="text-xs text-accent">Trocando…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Sair */}
      <section>
        <Botao
          variante="perigo"
          iconeEsquerda={SignOut}
          carregando={saindo}
          onClick={() => { setSaindo(true); void sair(); }}
        >
          Sair da sessao
        </Botao>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck:web
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/configuracoes/perfil/page.tsx
git commit -m "feat(web): profile page at /configuracoes/perfil

Shows user data, active unit, other available units with switch button,
and logout. Password change and MFA enrollment deferred to Phase 7."
```

---

### Task 10: Teste de alcançabilidade

**Arquivos:**
- Criar: `tools/check-route-reachability.ts`
- Modificar: `package.json` (adicionar script `lint:routes`)

O teste que impede a Fase 7 de recriar o mesmo problema. Enumera
`apps/web/app/**/page.tsx`, compara contra o grafo de navegação, e falha quando uma
rota não tem caminho.

- [ ] **Step 1: Escrever o tool**

```ts
// tools/check-route-reachability.ts
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/* ── Rotas do Next.js App Router ─────────────────────────────────────── */

function coletarRotas(dir: string, base = ''): string[] {
  const rotas: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      // Route groups (parentheses) não viram segmento de URL
      const segmento = nome.startsWith('(') && nome.endsWith(')') ? '' : nome;
      rotas.push(...coletarRotas(caminho, base ? `${base}/${segmento}` : `/${segmento}`));
    } else if (nome === 'page.tsx') {
      rotas.push(base || '/');
    }
  }
  return rotas;
}

/* ── Grafo de navegação ──────────────────────────────────────────────── */

// Importamos a fonte única de navegação.
// Como nav.ts usa imports de @phosphor-icons/react que não existem no Node puro,
// extraímos os hrefs por regex em vez de importar o módulo.
import { readFileSync } from 'node:fs';

function extrairHrefs(arquivo: string): Set<string> {
  const conteudo = readFileSync(arquivo, 'utf-8');
  const hrefs = new Set<string>();
  // Captura href: '/alguma/coisa' e href: "/alguma/coisa"
  for (const match of conteudo.matchAll(/href:\s*['"]([^'"]+)['"]/g)) {
    hrefs.add(match[1]!);
  }
  return hrefs;
}

/* ── Exceções declaradas ─────────────────────────────────────────────── */

/**
 * Rotas que não precisam de caminho de navegação, com justificativa.
 * Cada nova exceção é um ato deliberado, não um esquecimento.
 */
const EXCECOES: Record<string, string> = {
  '/': 'Redirect para /hoje',
  '/entrar': 'Login — rota publica, fora da navegacao interna',
  '/agendar/[clinicId]': 'Agendamento online — rota publica para pacientes',
  '/atendimento/[id]': 'Destino parametrico, alcancado a partir da fila do dia',
  '/pacientes/[id]': 'Destino parametrico, alcancado a partir da lista de pacientes',
  '/convenios/guias/[id]': 'Destino parametrico, alcancado a partir da lista de guias',
  '/convenios/retornos/[id]': 'Destino parametrico, alcancado a partir da lista de retornos',
  '/convenios/recursos/[id]': 'Destino parametrico, alcancado a partir da lista de recursos',
  '/convenios/recursos/novo': 'Destino parametrico, alcancado por botao na lista de recursos',
  '/financeiro/repasse/regras': 'Sub-rota, alcancada por botao na tela de repasse',
  '/agenda/imprimir': 'View de impressao, alcancada por botao no layout de Agenda',
};

/* ── Verificação ─────────────────────────────────────────────────────── */

const APP_DIR = join(import.meta.dirname, '..', 'apps', 'web', 'app');
const NAV_TS = join(import.meta.dirname, '..', 'apps', 'web', 'src', 'ui', 'nav.ts');

// Coleta hrefs de todas as fontes de navegação:
// 1. nav.ts (sidebar + command palette)
// 2. Todos os layout.tsx (sub-navegação por módulo)
const hrefsAlcancaveis = extrairHrefs(NAV_TS);

function coletarLayouts(dir: string): string[] {
  const layouts: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const stat = statSync(caminho);
    if (stat.isDirectory()) {
      layouts.push(...coletarLayouts(caminho));
    } else if (nome === 'layout.tsx') {
      layouts.push(caminho);
    }
  }
  return layouts;
}

for (const layout of coletarLayouts(APP_DIR)) {
  for (const href of extrairHrefs(layout)) {
    hrefsAlcancaveis.add(href);
  }
}

const rotasDoApp = coletarRotas(APP_DIR);
const orfas: string[] = [];

for (const rota of rotasDoApp) {
  if (EXCECOES[rota]) continue;
  if (hrefsAlcancaveis.has(rota)) continue;
  orfas.push(rota);
}

if (orfas.length > 0) {
  console.error('Rotas sem caminho de navegacao:\n');
  for (const rota of orfas.sort()) {
    console.error(`  ${rota}`);
  }
  console.error(
    '\nCada rota precisa ser alcancavel a partir da sidebar, sub-navegacao ou command palette.',
  );
  console.error(
    'Se a rota nao precisa de caminho (publica, parametrica), declare em EXCECOES com justificativa.',
  );
  process.exit(1);
}

console.log(`ok: ${rotasDoApp.length} rotas, todas alcancaveis (${Object.keys(EXCECOES).length} excecoes declaradas)`);
```

- [ ] **Step 2: Adicionar script no `package.json` raiz**

```json
"lint:routes": "tsx tools/check-route-reachability.ts"
```

- [ ] **Step 3: Rodar**

```bash
pnpm lint:routes
```

Esperado: `ok: N rotas, todas alcancaveis (M excecoes declaradas)`

Se alguma rota aparecer como órfã, é porque um layout ou a nav.ts ainda não a
declara — consertar antes de commitar.

- [ ] **Step 4: Commit**

```bash
git add tools/check-route-reachability.ts package.json
git commit -m "feat: add route reachability lint tool

Enumerates app/**/page.tsx and fails if any route has no path from the
navigation graph (sidebar, sub-navs, layouts). Exceptions are declared
with justification. Prevents Phase 7 from recreating the orphan problem."
```

---

### Task 11: Gate de qualidade — todos os checks passam

**Arquivos:** nenhum novo

- [ ] **Step 1: Testes do web**

```bash
cd apps/web && pnpm vitest run
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Dependency cruiser**

```bash
pnpm arch:check
```

- [ ] **Step 4: Lints customizados**

```bash
pnpm lint:session-guc && pnpm lint:terminology-clock && pnpm lint:routes
```

- [ ] **Step 5: Authz check (garante que o lock nao quebrou)**

```bash
pnpm authz:check
```

Se qualquer check falhar, corrigir e commitar antes de declarar a fase completa.
