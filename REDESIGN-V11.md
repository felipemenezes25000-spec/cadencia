# Cadência Clinical OS — Precision Aurora v11

Redesign de frontend aplicado sobre a base real do Cadência, sem trocar arquitetura, contratos de domínio ou integrações da API.

## Direção visual

- Shell midnight/teal com navegação de alta densidade e contraste clínico.
- Canvas neutro, superfícies brancas e profundidade curta para reduzir ruído visual.
- Teal cirúrgico como cor de ação, seleção e foco; status clínicos preservam semântica própria.
- Topbar translúcida com busca global e comandos em destaque.
- Cockpit `/hoje` reconstruído como superfície operacional: hero contextual, KPIs independentes, atenção prioritária, fila refinada e painel de unidade em tempo real.
- Login alinhado à mesma identidade visual do produto.
- Primitives compartilhadas elevadas (botões, tabs, chips, avatar, modal, drawer, estado vazio e page header), propagando o acabamento para todas as rotas que já as utilizam.
- Responsividade e targets de toque mantidos; reduced-motion continua respeitado.

## Arquivos centrais alterados

- `apps/web/app/globals.css`
- `apps/web/app/entrar/page.tsx`
- `apps/web/src/components/shell/{AppShell,Sidebar,TopBar}.tsx`
- `apps/web/src/components/operations/AppointmentRow.tsx`
- `apps/web/src/telas/{Hoje,Financeiro,Explorar}.tsx`
- primitives em `apps/web/src/ui/`
- `apps/web/DESIGN_SYSTEM.md`

## Ajustes na integração

A entrega original trazia a paleta v11 num **segundo `:root`** no fim de `globals.css`. Na tela funcionava (vence pela ordem), mas `contrast.test.ts` lê o arquivo e pega a *primeira* declaração de cada token — o gate de WCAG passaria a medir a paleta azul antiga, que não carrega mais. A paleta foi movida para o `:root` único; a camada v11 ficou só com regras de componente.

Com o gate voltando a medir a paleta real, dois tokens reprovaram e foram escurecidos no mesmo tom:

| Token | v11 propunha | Aplicado | Motivo |
|---|---|---|---|
| `--text-tertiary` | `#6a8183` | `#5c7072` | 3.68:1 sobre `--surface-sunken` (AA exige 4.5:1) |
| `--border-field` | `#7f9f9b` | `#74918e` | 2.86:1 sobre `--surface` (WCAG 1.4.11 exige 3:1) |

Também: `AppShell` passou a escrever `--nav-width` inline, o que vencia o `:root { --nav-width: 0px }` do mobile — abaixo de 768px a sidebar nem é renderizada. A media query agora zera a variável no shell.

Os três tamanhos do `Botao` subiram de 32/36/40px para 34/38/42px; `Botao.test.tsx` e o comentário de alvo de toque acompanham os novos valores.

## Validação

```
pnpm typecheck:web   ok
pnpm test:web        115 arquivos, 1149 testes
pnpm lint:routes     52 rotas, 41 destinos estaticos validos
pnpm build:web       ok
```

O redesign foi mantido estritamente na camada de apresentação; nenhuma rota de API, regra clínica, autorização ou persistência foi removida.
