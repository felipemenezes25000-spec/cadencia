# Fase 6 — Contratos entre tasks

> Cada task consome ou produz artefatos que precisam casar na interface.
> Este documento é a referência que resolve "como a Task N chama o que a Task M criou".

## nav.ts — fonte única de navegação

```ts
// apps/web/src/ui/nav.ts

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

export const ITENS_NAV: readonly ItemNav[];       // 8 itens, 2 grupos
export const CONFIG_NAV: { ... };                  // fora do array — vive no rodapé
export const FASE_ATUAL = 6;
export function indiceDeNavegacao(): readonly SubItemNav[];  // flat, para ⌘K
```

## Sessão — já pronta, zero mudança

```ts
// apps/web/src/sessao.tsx — interface existente
interface Sessao {
  clinicId: string;
  csrfToken: string;
  usuario: QuemSou;          // userId, email, nome, mfaOk, vinculos[]
  vinculoAtivo: Vinculo;     // tenantId, clinicId, clinicNome, timezone, role
  trocarUnidade(clinicId: string): Promise<void>;
  sair(): Promise<void>;
}
```

## Layout de módulo — padrão compartilhado

Todos os novos layouts (Agenda, Conversas, Desempenho, Configurações) seguem o
mesmo padrão de `FinanceiroLayout` e `ConveniosLayout`:

```ts
interface AbaConfig {
  readonly value: string;
  readonly rotulo: string;
  readonly href: string;
  readonly badgeKey?: string;   // opcional
}
```

Usa `PageHeader` + `Tabs`/`TabsList`/`TabsTrigger` do design system existente.

## Catálogos — contrato da API

As três rotas de catálogo exigem `termo` (min 2 chars) + `data` (AAAA-MM-DD).
Não existe "listar tudo" — são endpoints de **busca**, não de navegação.

```ts
// GET /v1/catalogos/cid?termo=J45&data=2026-08-10
{ itens: { codigo: string; descricao: string; capitulo: number | null; competencia: string }[] }

// GET /v1/catalogos/cid11?termo=BA0&data=2026-08-10
{ itens: { codigo: string; descricao: string; capitulo: string | null; uri: string; competencia: string }[] }

// GET /v1/catalogos/tuss?tabela=22&termo=consul&data=2026-08-10
{ itens: { tabela: number; codigo: string; termo: string }[] }
```

## Procedimentos — contrato da API

```ts
// GET /v1/procedimentos?dias=90
{ itens: {
  procedureId: string; code: string; nome: string; cor: string;
  duracaoMin: number; usosRecentes: number; maisFrequente: boolean;
}[] }
```

## Permissões — dado estático

```ts
// @cadencia/authz
ACTIONS: ActionDef[]   // { key, description, roles: Role[], requiresMfa? }
ROLES: ['admin_clinico','diretor_tecnico','profissional','recepcao','financeiro']
```

## Componentes de UI existentes

| Componente | Import | Props chave |
|---|---|---|
| `PageHeader` | `src/ui/PageHeader` | `titulo, subtitulo?, acoes?, semBreadcrumb?` |
| `Skeleton` | `src/ui/Skeleton` | `variant: 'text'|'avatar'|'card'|'table-row', lines?, width?, height?` |
| `EstadoVazio` | `src/ui/EstadoVazio` | `icone, titulo, descricao?, acao?, compacto?` |
| `Campo` | `src/ui/Campo` | `rotulo?, ajuda?, erro?, prefixo?, sufixo?` |
| `Select` | `src/ui/Select` | `rotulo?, opcoes?, grupos?, value?, onChange?` |
| `Botao` | `src/ui/Botao` | `variante?, tamanho?, iconeEsquerda?, carregando?` |
| `Tabs / TabsList / TabsTrigger` | `src/ui/Tabs` | Radix UI wrapper, `value, onValueChange, badge?` |

## Rotas públicas (fora da navegação)

Rotas que NÃO devem aparecer no teste de alcançabilidade:
- `/entrar` — login
- `/agendar/[clinicId]` — agendamento online (público)

Rotas paramétrica (alcançadas por link a partir de listas):
- `/atendimento/[id]`
- `/pacientes/[id]`
- `/convenios/guias/[id]`
- `/convenios/retornos/[id]`
- `/convenios/recursos/[id]`
- `/convenios/recursos/novo`

Estas precisam de declaração explícita no teste de alcançabilidade.
