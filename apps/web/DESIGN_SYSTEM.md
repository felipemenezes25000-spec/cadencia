# Cadencia Clinical UI — Design System v4

Este documento é o contrato visual oficial do Cadencia. O produto usa **um único tema claro**. Não existe variante dark, seletor de tema ou adaptação baseada no tema do sistema operacional.

## 1. Modelo de produto

Toda superfície operacional segue a sequência:

**Paciente → estado atual → contexto → próxima ação**

A interface deve responder primeiro ao que exige decisão. Métricas, gráficos e detalhes complementares entram apenas quando ajudam a decidir ou concluir um fluxo.

Princípios:

1. Uma única ação primária por contexto.
2. Informação relacionada permanece visualmente próxima.
3. Estado nunca é comunicado apenas por cor.
4. Drawers oferecem contexto rápido; páginas completas sustentam trabalho profundo.
5. Densidade alta não significa tipografia minúscula.
6. Borda, alinhamento e espaço definem hierarquia antes de sombra.
7. Erro, bloqueio, loading e vazio fazem parte da experiência final.

## 2. Tema claro único

Os tokens vivem em `app/globals.css` e são expostos ao Tailwind por `@theme`.

| Token | Valor | Uso |
|---|---:|---|
| `--canvas` | `#F6F8FB` | fundo global |
| `--surface` | `#FFFFFF` | painéis e controles |
| `--surface-subtle` | `#F8FAFC` | hover e agrupamento |
| `--border` | `#DDE5EE` | divisores e bordas |
| `--text-primary` | `#13233A` | conteúdo principal |
| `--text-secondary` | `#50627A` | metadados |
| `--text-tertiary` | `#718096` | micro-hierarquia |
| `--brand` | `#075985` | ação e seleção |
| `--brand-hover` | `#0369A1` | interação |
| `--brand-soft` | `#E0F2FE` | seleção discreta |
| `--success` | `#166534` | concluído/confirmado |
| `--warning` | `#92400E` | espera/atenção |
| `--danger` | `#991B1B` | erro/bloqueio |
| `--info` | `#1E40AF` | informação operacional |

Não introduza cores literais nos componentes. Quando um módulo legado usa `bg-bg`, `text-text`, `accent`, `ok`, `warn` ou `line`, o alias aponta para este mesmo sistema claro.

## 3. Tipografia e números

Fonte de interface:

`Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

- Título da página: 28 px / 700.
- Título de seção: 16–18 px / 650–700.
- Nome de paciente: 14–15 px / 600–700.
- Corpo: 14 px.
- Metadados: 12–13 px.
- Badge: 11–12 px / 600.
- Horários, valores e métricas: numerais tabulares.

Texto abaixo de 11 px fica restrito a labels muito curtas, como dias do calendário e indicadores da navegação.

## 4. Geometria

- Escala espacial: 4, 8, 12, 16, 24, 32 e 48 px.
- Controles: raio de 8 px.
- Cards: raio de 12 px.
- Painéis, drawers e dialogs: raio de 16 px.
- Badges e avatares: raio total.
- Cards comuns: borda e sombra quase imperceptível.
- Menus e drawers: elevação suficiente para indicar sobreposição.

Não use glassmorphism, gradiente decorativo ou sombra forte em conteúdo regular.

## 5. AppShell

O `AppShell` é compartilhado por todas as rotas privadas.

### Desktop

- Sidebar: 240 px; recolhida: 72 px.
- Topbar: 68 px, sticky.
- Conteúdo: flexível, máximo de 1680 px.
- Busca global abre com `Ctrl/⌘ K`.

### Mobile

- Sidebar sai do fluxo.
- Topbar mantém busca, notificações e criação.
- Navegação vira dock inferior: Hoje, Agenda, Pacientes, Mensagens e Mais.
- Tabelas operacionais viram cards ou mantêm overflow explicitamente controlado.

## 6. Primitives canônicas

Existe uma única família de primitives em `src/ui/`. `src/components/` contém
composição de domínio (shell, operação, pacientes), nunca uma segunda cópia de
Button, Drawer, Tabs ou PageHeader.

Primitives centrais:

- `Botao` e `BotaoIcone`;
- `Campo`, `Select` e `ComboboxDePaciente`;
- `Avatar`, `ChipDeStatus` e `PageHeader`;
- `Tabs`, `Tooltip` e `PainelLateral`;
- `Skeleton`, `EstadoVazio` e `Toast`.

Antes de adicionar um arquivo em `src/components`, confirme que ele combina
primitives e contexto de produto, em vez de duplicar geometria básica.

## 7. Status e ações

O domínio central está em:

- `src/domain/appointments/types.ts`
- `src/domain/appointments/states.ts`
- `src/domain/appointments/actions.ts`

`AppointmentStatus` representa exatamente os estados persistidos pela API. A UI
não inventa etapas como “chamado” ou “finalização” quando elas não existem no
backend. Componentes não criam regras próprias.

Exemplos:

- `confirmado` → ícone + “Confirmado” → **Fazer check-in**
- `aguardando` → ícone + “Aguardando” → **Iniciar**
- `atendendo` → ícone + “Em atendimento” → **Continuar**
- `faltou` → ícone + “Falta” → **Reagendar**

Ações secundárias vivem no menu `⋯`.

## 8. Arquétipos das rotas principais

### `/hoje`

Cockpit operacional. KPIs são contexto compacto; atenção necessária vem antes do fluxo. A composição principal combina fluxo do dia, “Agora” e caixa de ações. Não é uma dashboard analítica.

### `/agenda`

Superfície temporal. Semana é a visualização padrão. Eventos usam tons semânticos suaves, horário atual é inequívoco e qualquer reagendamento exige confirmação.

### `/atendimentos/[id]`

Workspace clínico. O registro domina a página, a navegação clínica é persistente e sinais vitais/ações rápidas formam um rail auxiliar. Autosave sempre informa salvando, salvo ou erro.

### `/pacientes/[id]`

Visão 360°. Alertas críticos aparecem junto da identidade. Resumo, histórico e próximos passos convivem sem esconder o contexto clínico.

### `/financeiro`

Gestão de recebíveis. Métricas são compactas e a tabela é a superfície principal. O drawer preserva contexto; cancelamento exige confirmação.

## 9. Progressive disclosure

- Clique no paciente: quick view em drawer.
- “Abrir paciente”: página 360°.
- “Abrir atendimento”: workspace clínico.
- Evento da agenda: drawer de contexto.
- Título financeiro: drawer financeiro.

O usuário não perde a posição na fila ou na agenda para consultar informação curta.

## 10. Estados de interface

- **Loading:** skeleton com geometria próxima do conteúdo final.
- **Empty:** explica o estado e indica a próxima informação relevante.
- **Error:** confirma que a mudança não foi persistida, apresenta código quando existir e oferece retry.
- **Blocked:** explica o motivo e a ação para resolver.
- **Success:** transição contextual e toast discreto; operações reversíveis oferecem “Desfazer”.
- **Restricted:** explica por que o conteúdo não está disponível.

## 11. Acessibilidade

Meta: WCAG AA.

- foco global de 2 px em `--brand`, com offset;
- navegação completa por teclado;
- labels reais em inputs e selects;
- icon buttons com nome acessível;
- dialogs/drawers Radix com focus trap, Escape e retorno de foco;
- status com ícone, texto e cor;
- mensagens de erro textuais;
- alvos de toque confortáveis;
- `prefers-reduced-motion` reduz animações e transições;
- conteúdo mobile não depende de hover.

## 12. Regra de evolução

Antes de criar um componente, confirme:

1. A intenção já existe em uma primitive compartilhada?
2. A ação principal continua óbvia?
3. O componente funciona a 390 px?
4. Loading, vazio, erro e bloqueio foram considerados?
5. Teclado e leitor de tela concluem o fluxo?
6. A cor carrega significado ou apenas decoração?

Se uma regra de negócio aparecer em mais de uma tela, ela pertence ao domínio, não ao componente.
