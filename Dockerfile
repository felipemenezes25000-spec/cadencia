# Imagem unica para `api` e `worker`.
#
# Os dois compartilham o mesmo grafo de dependencias — separar em duas imagens
# custaria dois builds do monorepo para nao economizar nada. O que distingue os
# processos e o `command` de cada servico no compose.
#
# NAO ha estagio de build. `apps/api` e `apps/worker` declaram `main` apontando
# para `.ts` e sobem com tsx: nao existe `dist/` para copiar de um estagio
# anterior. Isso e escolha do repositorio, nao omissao deste arquivo.
FROM node:24-slim

# Versao CRAVADA, e nao `corepack enable` sozinho.
#
# O repositorio nao declara `packageManager` no package.json, entao o corepack
# baixa o pnpm mais recente do dia — que hoje e o 11.21.0. O pnpm 11 promoveu
# ERR_PNPM_IGNORED_BUILDS a erro fatal, e o build morria em `pnpm install` com
# uma lista de scripts ignorados (esbuild, sharp, ssh2...) que a versao 10 apenas
# ignora em silencio. Local e CI rodam pnpm 10; sem esta linha, so a imagem ficava
# uma major inteira a frente do que o projeto testou.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# O Chromium do Playwright (dependencia de @cadencia/documents, usado para gerar
# PDF) fica FORA desta imagem de proposito. Sao ~400 MB e um conjunto de libs de
# sistema, e este e o passo com maior chance de estourar memoria num host de 2 GB.
# O nucleo sobe primeiro; emissao de PDF entra depois, verificada em separado.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app
COPY . .

# `--frozen-lockfile`: se o lockfile divergir dos manifestos, o build falha aqui em
# vez de resolver versoes diferentes das que passaram no CI.
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3001

CMD ["pnpm", "--filter", "@cadencia/api", "exec", "tsx", "src/server.ts"]
