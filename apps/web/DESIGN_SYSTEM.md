# Cadência Clinical OS — Design System v11 · Precision Aurora

Este documento é o contrato visual oficial do Cadência. O produto usa **um único tema claro**, com um shell clínico de alto contraste e superfícies operacionais claras. Não existe dark mode, seletor de tema ou adaptação baseada no tema do sistema.

## 1. Modelo de produto

Toda superfície operacional segue:

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
8. O shell orienta; a superfície de trabalho domina.
9. O usuário não navega para obter contexto que cabe em um painel lateral.
10. Toda tela operacional deve deixar óbvio o que está acontecendo agora e o que acontece depois.

## 2. Identidade: Precision Aurora

O Cadência deve parecer um sistema operacional clínico premium, e não um dashboard SaaS genérico. A assinatura vem do contraste entre um **chrome tecnológico** e uma **superfície clínica extremamente legível**:

- shell midnight/navy no desktop e dock translúcido no mobile;
- canvas claro e frio com textura geométrica quase imperceptível;
- superfícies clínicas brancas e semanticamente previsíveis;
- teal elétrico controlado como ação, seleção e foco;
- profundidade progressiva por borda, blur e sombra curta;
- tipografia densa, legível e com hierarquia forte;
- microinterações rápidas que explicam causa e efeito;
- overlays e command surfaces podem usar translucidez e glow contido.

Gradiente, blur e glow são recursos de **chrome**, não conteúdo. Nunca ficam atrás de texto clínico denso, tabelas, prontuário ou valores financeiros. O efeito deve desaparecer antes da informação.

## 3. Tokens centrais

Os tokens vivem em `app/globals.css` e são expostos ao Tailwind por `@theme`.

| Token | Valor | Uso |
|---|---:|---|
| `--canvas` | `#F4F7F6` | fundo global |
| `--surface` | `#FFFFFF` | painéis e controles |
| `--surface-subtle` | `#F8FAF9` | agrupamento discreto |
| `--surface-sunken` | `#EDF3F2` | fundos internos |
| `--border` | `#DCE6E4` | divisores e bordas |
| `--text-primary` | `#122F31` | conteúdo principal |
| `--text-secondary` | `#526B6D` | metadados |
| `--text-tertiary` | `#5C7072` | micro-hierarquia AA |
| `--brand` | `#08766F` | ação e seleção |
| `--brand-hover` | `#065F5A` | interação |
| `--brand-strong` | `#064F4B` | ênfase de marca |
| `--brand-soft` | `#E4F5F1` | seleção discreta |
| `--nav` | `#071F24` | shell desktop/mobile |
| `--nav-active` | `#0E3237` | item ativo no shell |
| `--nav-accent` | `#62D9CE` | sinalização no shell |
| `--success` | `#28774F` | concluído/confirmado |
| `--warning` | `#9B6218` | espera/atenção |
| `--danger` | `#A93F4B` | erro/bloqueio |
| `--info` | `#365F99` | informação operacional |

Não introduza cores literais em componentes quando existir token semântico equivalente.

## 4. Tipografia e números

Fonte de interface:

`Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

- Título de página: 30–32 px / 700.
- Título de seção: 16–20 px / 650–700.
- Nome de paciente: 14–15 px / 600–700.
- Corpo: 14 px.
- Metadados: 12–13 px.
- Badge: 11–12 px / 600–700.
- Horários, valores e métricas: numerais tabulares.

Texto abaixo de 11 px fica restrito a indicadores curtos. Evite títulos estruturais em 9–10 px quando 11–12 px couber.

## 5. Geometria

- Escala espacial: 4, 8, 12, 16, 24, 32 e 48 px.
- Controles: raio de 9–10 px.
- Cards: raio de 14 px.
- Painéis, drawers e dialogs: raio de 18 px.
- Badges e avatares: raio total quando semântica pedir.
- Cards comuns: borda precisa e elevação curta; cards interativos podem subir até 2 px no hover.
- Menus, command surfaces e drawers: blur/elevação suficientes para indicar sobreposição sem perder contraste.
- Workspaces como Agenda e Conversas não devem parecer um “card gigante dentro do app”.

## 6. AppShell

O `AppShell` é compartilhado por todas as rotas privadas.

### Desktop

- Sidebar: 248 px; recolhida: 76 px.
- Sidebar usa `--nav` e é a principal assinatura visual do produto.
- Topbar: 72 px, sticky e translúcida, com blur controlado sobre o workspace.
- Conteúdo: flexível, máximo de 1740 px (`--page-max`) para páginas convencionais.
- Busca global abre com `Ctrl/⌘ K`.
- Busca é um comando do sistema, não apenas um campo decorativo.

### Mobile

- Sidebar sai do fluxo.
- Topbar mantém busca, notificações e criação.
- Navegação vira dock inferior translúcido: Hoje, Agenda, Pacientes, Mensagens e Mais.
- Tabelas operacionais viram cards ou mantêm overflow explicitamente controlado.

## 7. Primitives canônicas

Existe uma única família de primitives em `src/ui/`. `src/components/` contém composição de domínio, nunca uma segunda cópia de geometria básica.

Primitives centrais:

- `Botao` e `BotaoIcone`;
- `Campo`, `Select` e `ComboboxDePaciente`;
- `Avatar`, `ChipDeStatus` e `PageHeader`;
- `Tabs`, `Tooltip` e `PainelLateral`;
- `Skeleton`, `EstadoVazio` e `Toast`.

Antes de adicionar um componente, confirme se a intenção já existe em uma primitive compartilhada.

## 7.1 Motion e profundidade

A animação é funcional e curta. O padrão de entrada usa 140–220 ms; hover/press usa 100–160 ms. Evite loops decorativos contínuos. Toda animação deve respeitar `prefers-reduced-motion`.

Níveis de profundidade:

1. **Canvas:** textura e luz ambiente, sem competir com dados.
2. **Surface:** cards, tabelas e controles clínicos.
3. **Raised:** hover, menus e estados selecionados.
4. **Overlay:** dialogs, drawers e Command Palette, onde blur e glow contido são permitidos.

O usuário deve perceber tecnologia pelo acabamento e pela resposta da interface, não por ruído visual.

## 8. Padrões de assinatura

### Patient Identity

Nome, avatar, identidade secundária e alertas devem manter anatomia consistente entre fila, diretório, conversa, drawer e prontuário.

### Live Clinical State

`Agora`, `Próximo`, `Aguardando`, `Em atendimento`, `Atrasado` e pendências são estados operacionais. Texto, ícone e posição devem comunicar o estado antes da cor.

### Context Rail

Quando a tarefa principal ocupa o centro da tela, contexto curto do paciente pode viver em rail lateral persistente. Conversas é o arquétipo.

### Next Action

Listas operacionais exibem a próxima ação por linha. Ações secundárias ficam em menu ou drawer.

## 9. Arquétipos das rotas principais

### `/hoje`

Cockpit operacional. KPIs são contexto compacto; atenção necessária vem antes do fluxo. A composição combina fluxo do dia, “Agora”, “Próximo” e pendências. Não é uma dashboard analítica.

### `/agenda`

Superfície temporal. Semana é a visualização padrão. Eventos usam tons semânticos suaves, horário atual é inequívoco e qualquer reagendamento exige confirmação.

### `/atendimentos/[id]`

Workspace clínico. O registro domina a página, a navegação clínica é persistente e sinais vitais/ações rápidas formam um rail auxiliar. Autosave sempre informa salvando, salvo ou erro.

### `/pacientes`

Diretório clínico escaneável, não lista de contatos. Busca e facetas precedem uma tabela responsiva que evidencia identidade, nascimento, contato e integridade cadastral.

### `/pacientes/[id]`

Visão 360°. Alertas críticos aparecem junto da identidade. Resumo, histórico e próximos passos convivem sem esconder o contexto clínico.

### `/conversas`

Workspace edge-to-edge. Lista de conversas à esquerda, thread no centro e contexto clínico à direita no desktop. Mensageria deve parecer parte do prontuário, não um app embutido.

### `/financeiro`

Gestão de recebíveis. Métricas são compactas e a tabela operacional é a superfície principal. O drawer preserva contexto; cancelamento exige confirmação.

### `/convenios`

Linha de produção do ciclo de receita. Cada estado deve deixar claro valor, risco e próximo bloqueio a resolver.

### `/desempenho`

Narrativa de gestão: **o que mudou → por que mudou → evidência → o que fazer agora**. Waterfall e drill-down servem à decisão, não ao volume de gráficos.

### `/configuracoes`

Navegação local vertical no desktop e horizontal no mobile. Configurações são agrupadas por intenção, não espremidas em uma fileira longa de abas.

## 10. Progressive disclosure

- Clique no paciente: quick view em drawer quando disponível.
- “Abrir paciente”: página 360°.
- “Abrir atendimento”: workspace clínico.
- Evento da agenda: drawer de contexto.
- Título financeiro: drawer financeiro.

O usuário não perde a posição na fila, agenda, diretório ou conversa para consultar informação curta.

## 11. Estados de interface

- **Loading:** skeleton com geometria próxima do conteúdo final.
- **Empty:** explica o estado e indica a próxima informação relevante.
- **Error:** confirma que a mudança não foi persistida, apresenta código quando existir e oferece retry.
- **Blocked:** explica o motivo e a ação para resolver.
- **Success:** transição contextual e toast discreto; operações reversíveis oferecem “Desfazer”.
- **Restricted:** explica por que o conteúdo não está disponível.

## 12. Acessibilidade

Meta: WCAG AA.

- foco global de 2 px em `--brand`, com offset;
- navegação completa por teclado;
- labels reais em inputs e selects;
- icon buttons com nome acessível;
- dialogs/drawers Radix com focus trap, Escape e retorno de foco;
- status com texto e sinal visual;
- mensagens de erro textuais;
- alvos de toque confortáveis;
- `prefers-reduced-motion` reduz animações e transições;
- conteúdo mobile não depende de hover.

## 13. Regra de evolução

Antes de criar ou alterar uma superfície, confirme:

1. A intenção já existe em uma primitive compartilhada?
2. A ação principal continua óbvia?
3. O estado atual do paciente/tarefa está visível?
4. O próximo passo está evidente?
5. O componente funciona a 390 px?
6. Loading, vazio, erro e bloqueio foram considerados?
7. Teclado e leitor de tela concluem o fluxo?
8. A cor carrega significado ou apenas decoração?
9. O usuário precisa navegar ou um drawer/rail resolve?
10. A nova tela ainda parece inequivocamente Cadência?

Se uma regra de negócio aparecer em mais de uma tela, ela pertence ao domínio, não ao componente.
