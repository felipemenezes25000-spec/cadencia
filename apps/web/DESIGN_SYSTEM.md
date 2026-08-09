# Cadencia PRIME — Product & Design System v3

Cadencia PRIME é uma linguagem de produto para software clínico de alta frequência. A direção foi desenhada para parecer autoral e memorável sem sacrificar o que importa em uma clínica: velocidade, previsibilidade, densidade informacional, acessibilidade e baixa fadiga visual.

A interface não tenta ser um “dashboard bonito”. Ela funciona como um **clinical operating system**: cada superfície deve deixar claro o estado da operação, o próximo movimento e a ação segura mais provável.

## 1. Princípios do produto

1. **Decisão antes de decoração** — informação existe para orientar uma ação. Métricas sem consequência visual são ruído.
2. **Contexto mora junto da ação** — check-in, cobrança, mensagem, prescrição e documentos aparecem próximos do paciente/objeto correspondente.
3. **Calma operacional** — o canvas principal é claro e silencioso; cor intensa fica concentrada em ação, seleção e significado clínico.
4. **Uma linguagem, várias densidades** — atendimento, agenda, financeiro e prontuário têm composições próprias, mas compartilham tokens, ritmo, motion e estados.
5. **Mobile é produto, não redução** — navegação vira dock; drawers viram sheets; prioridades mudam; conteúdo crítico continua acessível sem depender de hover.
6. **Falha é um estado de produto** — loading, erro, vazio, offline, sucesso, restrição de acesso e conteúdo extremo fazem parte do design.
7. **Motion explica causalidade** — animação mostra mudança de estado, seleção, entrada, continuidade e foco. Nunca deve atrasar trabalho clínico.
8. **Acessibilidade não é acabamento** — foco visível, semântica, teclado, contraste e `prefers-reduced-motion` são parte da definição de pronto.

## 2. Direção de arte

### Assinatura visual

A marca usa contraste entre dois mundos:

- **Clinical canvas**: Cloud + Ink, superfícies suaves, bordas finas e elevação mínima.
- **Cadencia Aurora**: Royal, Cyan e Violet em linhas, glows e acentos atmosféricos não semânticos.
- **Semantic spectrum**: Emerald, Amber e Red reservados para sucesso, atenção e risco.

A sidebar é propositalmente mais cinematográfica que o conteúdo: um eixo escuro com aurora discreta, marca luminosa e navegação tátil. Isso cria reconhecimento imediato sem contaminar a área clínica com excesso de cor.

### Tokens principais

Os tokens vivem em `app/globals.css` e são expostos ao Tailwind v4 por `@theme`.

- `--bg`, `--surface`, `--surface-sunken`, `--surface-raised`: profundidade do canvas.
- `--text`, `--text-muted`, `--text-faint`: hierarquia editorial.
- `--accent`, `--accent-hover`, `--accent-soft`: ação e seleção.
- `--ok`, `--warn`, `--danger`: estados semânticos.
- `--brand-cyan`, `--brand-violet`, `--brand-lime`: atmosfera de marca.
- `--aurora`, `--aurora-soft`: assinatura visual.
- `--chart-1..5`: paleta analítica consistente.
- `--elev-1..3`, `--elev-float`: profundidade por importância.
- `--dur-1..3`, `--ease-out`: ritmo de interação.

Não introduza hex/OKLCH literal em uma tela quando já houver token semântico apropriado.

## 3. Hierarquia tipográfica

- **Display / page title**: `clamp()` + tracking negativo forte; usado uma vez por superfície.
- **Section title**: 15–18 px, 600, tracking levemente negativo.
- **Body**: 13–14 px, line-height generoso.
- **Metadata**: 9–11 px, uppercase apenas para microestrutura, nunca para parágrafos.
- **Numbers**: `.num` / tabular lining nums para estabilidade de leitura.
- **Documento clínico**: `--font-doc` somente em conteúdo que realmente se beneficia de textura editorial.

## 4. Primitives PRIME

### Estrutura

- `.cadencia-page` — largura, gutter e área segura da página.
- `.cadencia-shell-grid` — conteúdo primário + rail operacional.
- `.cadencia-panel` — superfície padrão de produto.
- `.cadencia-panel-hero` — superfície de síntese/narrativa.
- `.cadencia-data-grid` — tabela/lista densa com linguagem PRIME.
- `.cadencia-sticky-rail` — contexto secundário persistente em desktop.

### Sinais

- `.cadencia-metric` — métrica compacta e interativa.
- `.cadencia-eyebrow` — microhierarquia com assinatura Aurora.
- `.cadencia-icon-orb` — contêiner de ícone para ação/contexto.
- `.cadencia-segmented` — seletor curto de período/modo.
- `.cadencia-command-key` — representação de atalhos.
- `.cadencia-mobile-dock` — navegação mobile com safe-area.

## 5. Navegação e command layer

### Desktop

- Sidebar expandida: 276 px.
- Sidebar recolhida: 76 px.
- Estado ativo usa trilho Cyan + superfície translúcida.
- Atalhos `Alt+1..n` continuam disponíveis.
- `Ctrl/⌘ K` abre a **Command Palette**, com filtro e navegação rápida.

### Mobile

- Sidebar desaparece por completo.
- Navegação principal vira dock inferior com alvo confortável e indicador ativo animado.
- Itens excedentes entram em “Mais”.
- Bottom sheets respeitam `env(safe-area-inset-bottom)`.

## 6. Motion system

Motion usa spring/curvas rápidas para preservar sensação de velocidade.

| Evento | Tratamento |
|---|---|
| Entrada de página | fade + translate curto (`cadencia-enter`) |
| Botão | lift de 1 px no hover, scale no press |
| Tab ativa | indicador com layout animation |
| Sidebar | width spring-like suave |
| Drawer | slide lateral desktop / bottom sheet mobile |
| Estado de erro/offline | entrada curta e inequívoca |
| Toast | entrada/saída direcional + estado semântico |
| Métrica | elevação mínima no hover |

`prefers-reduced-motion: reduce` reduz animações e transições para duração praticamente nula.

## 7. Arquétipos de tela

### Hoje — cockpit operacional

- Hero responde “como está o ritmo?” antes de listar compromissos.
- Próximo movimento é destacado.
- Ações aparecem na própria linha do paciente.
- “Precisa de você” funciona como inbox operacional e não como widget decorativo.

### Agenda — superfície temporal

- Grade é a protagonista.
- Header permanece legível com navegação de dia/visão.
- Drag/reagendamento, vazio clicável e confirmação mantêm feedback contextual.
- Mobile prioriza lista temporal em vez de tentar miniaturizar uma grade desktop.

### Pacientes — diretório clínico

- Busca, facetamento e contexto vivem na mesma superfície.
- Linha/cell mobile preserva identidade, status e dados essenciais.
- Cadastro preliminar recebe sinal inequívoco sem competir com o nome do paciente.

### Ficha do paciente — identidade + timeline

- Cabeçalho funciona como “cartão de identidade clínica”.
- Acesso restrito é um estado explícito.
- Histórico é timeline, não tabela sem contexto.
- Ações clínicas primárias ficam visíveis sem soterrar informação sensível.

### Atendimento — focus mode

- Editor clínico é a superfície dominante.
- Dados do paciente ficam em rail de contexto.
- Ações frequentes vivem em command shelf.
- Finalização, prescrição, exames, documentos e cobrança têm feedback direto.

### Financeiro — narrativa de liquidez

- Caixa e recebíveis são lidos como fluxo, não como coleção de cards.
- Data-viz mostra cadência de receita e relação com despesa.
- Valores usam numerais tabulares e hierarquia consistente.
- “Próximos movimentos” aparece separado de métricas históricas.

### Desempenho — inteligência operacional

- Atendimentos une volume, receita e tempo.
- Satisfação transforma NPS em narrativa de experiência.
- Explorar é um canvas analítico com barras, linhas e distribuição.
- Exportar é um fluxo guiado com resumo do pacote antes da ação.

### Conversas — inbox de atenção

- Busca, não lidas e canais são sinais de triagem.
- Conversa ativa e lista adaptam-se ao mobile como panes mutuamente prioritários.
- Templates e automações compartilham a mesma linguagem de biblioteca/estado.

### Convênios / TISS

- Contadores funcionam como sinais operacionais clicáveis.
- Tabelas densas recebem chrome, foco e legibilidade consistentes.
- Glosa, retorno e recurso usam semântica de risco sem inundar a tela de vermelho/amarelo.

## 8. Estados completos

Toda nova superfície deve prever:

- **Loading**: skeleton com geometria próxima do conteúdo real.
- **Empty**: título, explicação curta e ação quando existir próximo passo.
- **Error**: mensagem compreensível + retry quando aplicável.
- **Offline**: banner global de conectividade e confirmação de reconexão.
- **Success**: toast ou transição contextual; evitar modais de confirmação desnecessários.
- **Restricted**: explicar por que algo está indisponível e como solicitar acesso.
- **First use**: empty state deve ensinar a primeira ação.
- **Extreme content**: truncate onde a identidade não pode quebrar layout; wrap onde o conteúdo precisa ser lido; tabelas ganham overflow horizontal.

## 9. Inputs e formulários

- Altura alvo: ~44 px em superfícies principais.
- Foco: borda Accent + halo discreto.
- Erro: texto + ícone/semântica; nunca apenas cor.
- Select/popover: superfície elevada e ativações de teclado preservadas.
- Combobox de paciente: debounce, loading, keyboard navigation e “Novo paciente” continuam acessíveis.

## 10. Drawers, dialogs e overlays

- Desktop: painel lateral direito com largura por contexto.
- Mobile: sheet inferior até ~92dvh.
- Overlay desfoca o canvas sem destruir orientação espacial.
- Título é semântico mesmo quando visualmente oculto.
- Escape/close/keyboard continuam responsabilidade do primitive Radix.

## 11. Data-viz

- Cor nunca é o único meio de distinguir estado quando há interação.
- Grid lines são secundárias; dados são protagonistas.
- Números mantêm tabular nums.
- Gráficos possuem `role="img"` + `aria-label` ou alternativa tabular.
- Barras/linhas usam a paleta `--chart-*`; cores de erro/sucesso permanecem reservadas para semântica quando necessário.
- Tooltip deve adicionar informação, não ser o único lugar onde a informação existe.

## 12. Responsividade

Breakpoints seguem Tailwind, mas a regra é de **prioridade**, não de escala:

- `< 768px`: dock inferior, sheet, grid reduzido, headers empilham, ações compactam.
- `768–1100px`: rails deixam de ser sticky/laterais e caem para fluxo.
- `> 1100px`: composição completa com rails, painéis paralelos e maior densidade.

Evite “desktop espremido”. Se a intenção muda no mobile, a composição também deve mudar.

## 13. Acessibilidade

Checklist mínimo:

- uma hierarquia de headings coerente;
- foco visível por teclado;
- roles/labels em tabs, radiogroups, listas, gráficos e feedback;
- alvos de toque confortáveis;
- contraste semântico;
- `aria-live` apenas onde feedback realmente precisa ser anunciado;
- `prefers-reduced-motion` respeitado;
- navegação não depende exclusivamente de cor ou hover.

## 14. Regra para evolução futura

Antes de criar um novo componente, pergunte:

1. É uma nova intenção de produto ou só uma nova aparência?
2. Um primitive PRIME já resolve 80% do caso?
3. A ação permanece clara em 390 px?
4. O estado loading/empty/error/offline foi pensado?
5. Teclado e leitor de tela conseguem completar o fluxo?
6. A cor usada tem significado semântico ou é apenas atmosfera?

Se a resposta não estiver clara, refine o modelo de interação antes de adicionar CSS.
