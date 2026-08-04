# Cadência — Fase 0 (Fundação): Plano de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** construir a fundação inegociável do Cadência — kernel, banco com isolamento multi-tenant provado por teste, papéis, trilha de auditoria e o pipeline de invariantes — antes de existir qualquer tela.

**Arquitetura:** monorepo pnpm com quatro camadas em DAG estrito (L0 plataforma → L1 cadastros → L2 operação → L3 apps), setas só descem e irmão nunca importa irmão. Todo o isolamento entre clínicas é propriedade estrutural do PostgreSQL — RLS `FORCE` com verificação de vínculo, FK sempre composta `(tenant_id, id)`, papel de login sem posse e sem `BYPASSRLS` — e um único lugar da aplicação abre transação, gravando o contexto com escopo de transação. A trilha de auditoria mora em schema com dono próprio, é append-only por trigger e registra que algo aconteceu, nunca o que foi escrito.

**Stack:** TypeScript 5.9 `strict` + `noUncheckedIndexedAccess` · Node.js 24 LTS (ESM) · PostgreSQL 18 (extensões `pgcrypto`, `btree_gist`, `btree_gin`, `pg_trgm`, `unaccent`, `citext`) · `pg` 8.16 (Pool) · Vitest 3 · Testcontainers · Docker Compose · pnpm workspaces.

---

## Antes de começar

### Pré-requisitos de ambiente

| Ferramenta | Versão | Como conferir |
|---|---|---|
| Node.js | 24 LTS ou superior | `node --version` |
| pnpm | 9 ou superior | `pnpm --version` (instalar com `corepack enable pnpm`) |
| Docker Engine / Docker Desktop | qualquer versão com `docker compose` v2 | `docker compose version` |
| git | qualquer | `git --version` |

Nenhuma tarefa deste plano instala essas quatro ferramentas. Se `docker compose version` falhar, pare aqui: metade do plano é DDL verificada contra um PostgreSQL real.

**Raiz do repositório:** o diretório que já contém `docs/superpowers/specs/`. Todos os caminhos deste plano são relativos a ele.

**Convenção de commit:** Conventional Commits, mensagem em inglês. Código, identificadores e nomes de arquivo em inglês; comentários e nomes de teste em português.

### Como subir o Postgres local

O banco de desenvolvimento é um container só, declarado em `docker-compose.yml` (Task 2). Depois da Task 2 existirem:

```bash
cp .env.example .env      # uma vez, na primeira máquina
pnpm db:up                # sobe o PostgreSQL 18 em localhost:5433 e espera ficar healthy
pnpm db:migrate           # aplica todas as migrations pendentes, em ordem
```

Para zerar tudo (apaga o volume e reaplica do zero):

```bash
pnpm db:reset
pnpm db:migrate
```

A suíte `pnpm test:iso` **não** usa esse container: ela sobe um PostgreSQL 18 descartável por Testcontainers e aplica as migrations reais nele, porque o canário do isolamento exige um banco em estado conhecido byte a byte.

### Por que a Fase 0 não tem entregável visível — e por que isso é inegociável

A ordem do projeto é: primeiro o que é impossível retrofitar, depois o que é vendável sozinho. Isolamento entre clínicas, append-only, trilha de auditoria e canonicalização não entram depois — cada um deles, adicionado com dados em produção, é migração de dezenas de milhões de linhas imutáveis ou perda do valor probatório do acervo inteiro. Um vazamento entre clínicas é incidente P0 com notificação à ANPD em três dias úteis, e nenhum teste de unidade o pega: só a estrutura do banco pega. Por isso a Fase 0 entrega zero tela e a suíte `test:iso` é o primeiro teste do repositório, antes da primeira tela. Quem antecipar uma tela aqui está trocando quatro semanas de fundação por uma reescrita da camada de leitura clínica inteira.

### Ordem de execução e por que ela é essa

1. **Tasks 1–2 — chão do repositório.** Monorepo, TypeScript estrito, Vitest, PostgreSQL 18 local.
2. **Tasks 3–18 — banco e isolamento.** Harness de migration, papéis, contexto de transação e, na primeira oportunidade em que ela pode existir (Task 7), a suíte `test:iso`. Tudo que cria tabela com `tenant_id` depois disso já nasce com o teste de isolamento correspondente.
3. **Tasks 19–24 — `kernel`.** `Result`, erros, UUIDv7, `Clock`, `Money`, canonicalização JCS e validadores brasileiros. Vem depois do banco de propósito: `packages/db` **não** importa `packages/kernel` (são irmãos em L0, e a §2.2 proíbe import entre irmãos sem exceção), então o kernel não bloqueia nada do isolamento.
4. **Tasks 25–27 — trilha de auditoria.** Schema com dono próprio, RLS forçada com policy de INSERT e o trigger que torna a trilha append-only para qualquer papel.

---

## Parte I — Chão do repositório

### Task 1: Scaffold do monorepo (pnpm workspaces + TypeScript 5.9 + Vitest)

**Arquivos:**
- Criar: `package.json`
- Criar: `pnpm-workspace.yaml`
- Criar: `tsconfig.base.json`
- Criar: `tsconfig.json`
- Criar: `vitest.config.ts`
- Criar: `vitest.int.config.ts`
- Criar: `tools/test/load-env.ts`
- Criar: `.gitignore`
- Criar: `packages/<modulo>/package.json`, `packages/<modulo>/tsconfig.json`, `packages/<modulo>/src/index.ts` para os 27 módulos de L0/L1/L2
- Criar: `apps/{web,api,worker}/package.json`, `apps/{web,api,worker}/tsconfig.json`, `apps/{web,api,worker}/src/index.ts`
- Teste: `tools/repo/workspace.test.ts`

O grafo da §2.2 tem quatro camadas e as setas só descem:

```
L3  apps         web ──HTTP──► api        worker
L2  operação   scheduling emr documents prescriptions billing payments
               tiss messaging inventory reports export retention
L1  cadastros  identity tenancy people patients catalogs
L0  plataforma kernel db audit authn authz storage jobs outbox integrations events
```

> **Regra de import entre pacotes.** Irmão nunca importa irmão (§2.2, regra 2) — mas L1 importa L0 e L2 importa L1/L0, sempre pelo nome `@cadencia/<modulo>`, nunca por caminho relativo `../../`. Quando um pacote passa a importar outro, duas coisas acontecem juntas: (1) declara `"dependencies": { "@cadencia/<outro>": "workspace:*" }` no próprio `package.json` e roda `pnpm install`; (2) nada mais — o alias do Vitest já resolve, e o `paths` do tsconfig já tipa. A dependência declarada não é burocracia: é por ela que o `dependency-cruiser` enxerga a aresta e reprova import ascendente ou entre irmãos.
>
> **Consequência imediata e vinculante:** `packages/db` **não** importa `packages/kernel`, e vice-versa. Os dois são L0. É por isso que `withTenantTx` (Task 15) relança o erro cru do PostgreSQL em vez de traduzi-lo com `domainErrorFromSqlState` (Task 19) — a tradução acontece na borda HTTP, em L3.

- [ ] **Passo 1: Criar o repositório e instalar o toolchain**

```bash
git init
```

Criar `package.json` na raiz:

```json
{
  "name": "cadencia",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:int": "vitest run --config vitest.int.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "db:up": "docker compose up -d --wait db",
    "db:down": "docker compose down",
    "db:reset": "docker compose down -v && docker compose up -d --wait db"
  }
}
```

Instalar (o `pnpm add` preenche a seção `devDependencies` sozinho):

```bash
pnpm add -D -w typescript@5.9 vitest @types/node yaml
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `tools/repo/workspace.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// §2.2 — o grafo de modulos. Uma pasta por modulo, nome @cadencia/<modulo>.
const L0 = ['kernel', 'db', 'audit', 'authn', 'authz', 'storage', 'jobs', 'outbox', 'integrations', 'events'];
const L1 = ['identity', 'tenancy', 'people', 'patients', 'catalogs'];
const L2 = ['scheduling', 'emr', 'documents', 'prescriptions', 'billing', 'payments',
            'tiss', 'messaging', 'inventory', 'reports', 'export', 'retention'];
const L3 = ['web', 'api', 'worker'];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('scaffold do monorepo', () => {
  it('compila em strict com noUncheckedIndexedAccess: acesso a indice devolve undefined no tipo, e nao um valor que nao existe', () => {
    const options = readJson('tsconfig.base.json')['compilerOptions'] as Record<string, unknown>;
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['exactOptionalPropertyTypes']).toBe(true);
  });

  it('declara apps/* e packages/* como workspaces do pnpm', () => {
    const workspace = parseYaml(readFileSync('pnpm-workspace.yaml', 'utf8')) as { packages: string[] };
    expect(workspace.packages).toContain('apps/*');
    expect(workspace.packages).toContain('packages/*');
  });

  it('tem um pacote por modulo de L0, L1 e L2 do grafo da secao 2.2', () => {
    for (const name of [...L0, ...L1, ...L2]) {
      expect(existsSync(`packages/${name}/package.json`), `packages/${name} nao existe`).toBe(true);
      expect(readJson(`packages/${name}/package.json`)['name']).toBe(`@cadencia/${name}`);
      expect(existsSync(`packages/${name}/src/index.ts`), `packages/${name}/src/index.ts nao existe`).toBe(true);
    }
  });

  it('tem os tres deployables de L3 em apps/', () => {
    for (const name of L3) {
      expect(existsSync(`apps/${name}/package.json`), `apps/${name} nao existe`).toBe(true);
      expect(readJson(`apps/${name}/package.json`)['name']).toBe(`@cadencia/${name}`);
    }
  });

  it('expoe os comandos do Apendice B que ja existem na Fase 0', () => {
    const scripts = readJson('package.json')['scripts'] as Record<string, string>;
    expect(Object.keys(scripts)).toEqual(
      expect.arrayContaining(['test', 'test:int', 'typecheck', 'db:up', 'db:down']),
    );
  });

  it('resolve import entre pacotes pelo nome @cadencia/<modulo>, e nao por caminho relativo', async () => {
    const kernel: unknown = await import('@cadencia/kernel');
    expect(kernel).toBeTypeOf('object');
  });
});
```

- [ ] **Passo 3: Rodar o teste e confirmar que falha**

Rodar: `pnpm vitest run tools/repo/workspace.test.ts`
Esperado: FALHA com `ENOENT: no such file or directory, open 'tsconfig.base.json'`

- [ ] **Passo 4: Criar os arquivos de configuração**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`tsconfig.base.json` (sem comentários: o teste faz `JSON.parse`):

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@cadencia/*": ["packages/*/src"] }
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "apps/*/src/**/*.ts", "tools/**/*.ts", "*.config.ts"]
}
```

`vitest.config.ts` (testes de unidade: nada aqui toca em banco):

```ts
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Um alias por pacote do workspace. O `paths` do tsconfig resolve o TIPO;
// isto resolve o MODULO em tempo de teste. Os dois precisam existir: sem este
// alias, o primeiro import de irmao quebra com "Failed to resolve import".
const alias = Object.fromEntries(
  (existsSync('packages') ? readdirSync('packages', { withFileTypes: true }) : [])
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@cadencia/${entry.name}`, resolve('packages', entry.name, 'src', 'index.ts')]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts', '**/*.iso.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
  },
});
```

`vitest.int.config.ts` (tudo que precisa de PostgreSQL de verdade; `pnpm test:int`):

```ts
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = Object.fromEntries(
  (existsSync('packages') ? readdirSync('packages', { withFileTypes: true }) : [])
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@cadencia/${entry.name}`, resolve('packages', entry.name, 'src', 'index.ts')]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: [
      'packages/*/src/**/*.int.test.ts',
      'packages/*/test/**/*.int.test.ts',
      'tools/**/*.int.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./tools/test/load-env.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Existe UM Postgres local. Arquivos em paralelo brigariam pelo mesmo banco.
    fileParallelism: false,
  },
});
```

`tools/test/load-env.ts`:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Node 24 tem process.loadEnvFile nativo. Sem isto, DATABASE_URL_ADMIN nao chega
// aos testes de integracao e cada arquivo teria que ler o .env por conta propria.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
```

`.gitignore`:

```
node_modules/
dist/
.next/
coverage/
*.tsbuildinfo
.env
.env.local
```

- [ ] **Passo 5: Criar os 30 pacotes do grafo**

```bash
set -euo pipefail

for pkg in kernel db audit authn authz storage jobs outbox integrations events \
           identity tenancy people patients catalogs \
           scheduling emr documents prescriptions billing payments tiss messaging \
           inventory reports export retention; do
  mkdir -p "packages/$pkg/src"
  cat > "packages/$pkg/package.json" <<JSON
{
  "name": "@cadencia/$pkg",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
JSON
  cat > "packages/$pkg/tsconfig.json" <<'JSON'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
JSON
  [ -f "packages/$pkg/src/index.ts" ] || echo "export {};" > "packages/$pkg/src/index.ts"
done

for app in web api worker; do
  mkdir -p "apps/$app/src"
  cat > "apps/$app/package.json" <<JSON
{
  "name": "@cadencia/$app",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
  cat > "apps/$app/tsconfig.json" <<'JSON'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
JSON
  [ -f "apps/$app/src/index.ts" ] || echo "export {};" > "apps/$app/src/index.ts"
done

pnpm install
```

- [ ] **Passo 6: Rodar e confirmar que passa**

Rodar: `pnpm test`
Esperado: PASSA — 6 testes em `tools/repo/workspace.test.ts`

- [ ] **Passo 7: Commitar**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json \
        vitest.config.ts vitest.int.config.ts .gitignore tools packages apps
git commit -m "chore(repo): bootstrap pnpm workspace with strict TypeScript and Vitest"
```

---

### Task 2: PostgreSQL 18 local com as extensões e o cluster em UTC

**Arquivos:**
- Criar: `docker-compose.yml`
- Criar: `db/init/00-extensions.sql`
- Criar: `.env.example`
- Teste: `tools/db/compose.int.test.ts`

`btree_gin` não é opcional: sem ele não existe índice GIN liderado por `tenant_id`, e a busca de paciente de uma clínica passa a pagar o crescimento da base de todas as outras (§2.3, §3.3). Das sete extensões da §2.3, seis vêm na imagem oficial e são criadas aqui; `pg_partman` fica declaradamente de fora da Fase 0 e tem teste próprio afirmando a ausência.

O cluster local autentica com `trust`. Isso é **somente desenvolvimento**: em produção os papéis `api`, `jobs` e `support` autenticam com credencial do Secrets Manager. `trust` existe aqui para que o teste consiga conectar como `api` e como `jobs` sem inventar senha.

- [ ] **Passo 1: Instalar o cliente Postgres usado pelo teste**

```bash
pnpm add -D -w pg @types/pg
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `tools/db/compose.int.test.ts`:

```ts
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// DATABASE_URL_ADMIN, nao DATABASE_URL: o papel `api` so passa a existir na
// migration 0001, e este teste roda antes de qualquer migration.
const DATABASE_URL_ADMIN =
  process.env['DATABASE_URL_ADMIN'] ?? 'postgres://postgres@localhost:5433/cadencia';
const client = new Client({ connectionString: DATABASE_URL_ADMIN });

beforeAll(async () => { await client.connect(); });
afterAll(async () => { await client.end(); });

async function scalar(sql: string): Promise<string> {
  const result = await client.query<{ v: string }>(sql);
  return String(result.rows[0]?.v);
}

describe('cluster local de desenvolvimento', () => {
  it('roda PostgreSQL 18 ou superior', async () => {
    const version = Number(await scalar("SELECT current_setting('server_version_num') AS v"));
    expect(version).toBeGreaterThanOrEqual(180000);
  });

  it('roda em UTC: horario de Brasilia entra e volta convertido, e nenhuma data do sistema depende do fuso da maquina', async () => {
    expect(await scalar("SELECT current_setting('TimeZone') AS v")).toBe('UTC');
    expect(await scalar("SELECT ('2026-08-03 00:00:00-03'::timestamptz)::text AS v"))
      .toBe('2026-08-03 03:00:00+00');
  });

  it('tem as seis extensoes da secao 2.3 que a imagem oficial do PostgreSQL 18 fornece', async () => {
    const result = await client.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const installed = result.rows.map((row) => row.extname);
    for (const extension of ['pgcrypto', 'btree_gist', 'btree_gin', 'pg_trgm', 'unaccent', 'citext']) {
      expect(installed, `extensao ${extension} ausente`).toContain(extension);
    }
  });

  it('nao tem pg_partman, e a ausencia e uma decisao registrada, nao um esquecimento', async () => {
    // pg_partman e a SETIMA extensao da secao 2.3 e NAO acompanha a imagem oficial
    // (nao e contrib). A Fase 0 cria as particoes com DDL declarativa nativa, escrita
    // a mao na migration; a manutencao automatica por pg_partman entra junto com a
    // imagem propria. Este teste falha no dia em que alguem instalar pg_partman sem
    // trocar a imagem — que e quando o dev diverge de producao.
    const result = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_partman'",
    );
    expect(result.rows).toHaveLength(0);
  });

  it('aceita indice GIN liderado por tenant_id — e exatamente isso que btree_gin habilita', async () => {
    await client.query('DROP TABLE IF EXISTS gin_probe');
    await client.query('CREATE TABLE gin_probe (tenant_id uuid NOT NULL, search_name text NOT NULL)');
    await client.query('CREATE INDEX ix_gin_probe ON gin_probe USING gin (tenant_id, search_name gin_trgm_ops)');
    const result = await client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_gin_probe'",
    );
    expect(result.rows[0]?.indexdef).toContain('USING gin (tenant_id, search_name gin_trgm_ops)');
    await client.query('DROP TABLE gin_probe');
  });

  it('remove acento na busca (unaccent) e compara nome sem diferenciar caixa (citext)', async () => {
    expect(await scalar("SELECT unaccent('Coração') AS v")).toBe('Coracao');
    expect(await scalar("SELECT ('Ana'::citext = 'ana'::citext) AS v")).toBe('true');
  });
});
```

- [ ] **Passo 3: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int tools/db/compose.int.test.ts`
Esperado: FALHA com `connect ECONNREFUSED 127.0.0.1:5433`

- [ ] **Passo 4: Escrever o compose, o script de inicialização e o `.env`**

`docker-compose.yml`:

```yaml
name: cadencia

services:
  db:
    # postgres:18 oficial. Traz pgcrypto, btree_gist, btree_gin, pg_trgm, unaccent,
    # citext e pg_stat_statements. NAO traz pg_partman — ver db/init/00-extensions.sql.
    image: postgres:18
    container_name: cadencia-db
    environment:
      # SOMENTE DESENVOLVIMENTO LOCAL. Em producao os papeis api/jobs/support
      # autenticam com credencial do Secrets Manager. `trust` aqui existe para que
      # o teste consiga conectar como `api` e como `jobs` sem inventar senha.
      POSTGRES_USER: postgres
      POSTGRES_DB: cadencia
      POSTGRES_HOST_AUTH_METHOD: trust
      TZ: UTC
      PGTZ: UTC
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C.UTF-8"
    command:
      - postgres
      - -c
      - timezone=UTC
      - -c
      - log_timezone=UTC
      - -c
      - shared_preload_libraries=pg_stat_statements
    ports:
      - "5433:5432"
    volumes:
      - ./db/init:/docker-entrypoint-initdb.d:ro
      # postgres:18 mudou o PGDATA para /var/lib/postgresql/18/docker e declara o
      # VOLUME em /var/lib/postgresql. Montar em /var/lib/postgresql/data (caminho
      # das imagens ate a 17) deixaria o volume vazio e o banco morreria no primeiro
      # `docker compose down`.
      - cadencia-pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d cadencia"]
      interval: 2s
      timeout: 3s
      retries: 40

volumes:
  cadencia-pgdata:
```

`db/init/00-extensions.sql`:

```sql
-- Roda UMA vez, quando o volume e criado. As mesmas extensoes entram tambem pela
-- migration 0002 (e e a migration que vale em producao e no test:iso); aqui e so
-- para o cluster de desenvolvimento nascer pronto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- pg_partman (setima extensao da secao 2.3) NAO entra aqui: nao acompanha a imagem
-- oficial postgres:18. A Fase 0 particiona com DDL declarativa nativa; a manutencao
-- automatica de particao entra no bloco de migrations, junto com uma imagem propria
-- (FROM postgres:18 + build de pg_partman) usada tanto no compose quanto em RDS.

-- Cluster em UTC. A data do evento vem de occurred_date, derivada do fuso da
-- clinica na escrita; nenhuma derivacao diaria usa timestamptz::date.
ALTER DATABASE cadencia SET timezone TO 'UTC';
```

`.env.example`:

```
# Conexao administrativa: roda migrations. Local = superusuario do container.
DATABASE_URL_ADMIN=postgres://postgres@localhost:5433/cadencia
# Conexao da aplicacao: papel `api`, sujeito a RLS, sem posse de relacao.
DATABASE_URL=postgres://api@localhost:5433/cadencia
# Conexao dos jobs internos: papel `jobs`, UNICO com BYPASSRLS.
DATABASE_URL_JOBS=postgres://jobs@localhost:5433/cadencia
```

- [ ] **Passo 5: Subir o banco e confirmar que o teste passa**

Rodar:

```bash
cp .env.example .env
pnpm db:up
pnpm test:int tools/db/compose.int.test.ts
```

Esperado: PASSA — 6 testes em `tools/db/compose.int.test.ts`

- [ ] **Passo 6: Commitar**

```bash
git add docker-compose.yml db/init/00-extensions.sql .env.example \
        tools/db/compose.int.test.ts tools/test/load-env.ts package.json pnpm-lock.yaml
git commit -m "chore(db): local PostgreSQL 18 in UTC with required extensions"
```

---
## Parte II — Banco, isolamento e a suíte `test:iso`

> **Contexto para quem executa.** Esta parte constrói a fundação do banco: o mecanismo que aplica DDL, os papéis do PostgreSQL, as funções que carregam o contexto de tenant e a única função da aplicação que abre transação. Nada aqui tem tela. Se algum passo parecer excessivo, releia esta frase: metade do schema do produto é DDL de segurança que nenhum ORM gera, e isolamento entre clínicas é o único item do sistema que não se conserta depois.
>
> **Glossário mínimo:**
> - **tenant** = cliente do SaaS (uma empresa/rede de clínicas). **clinic** = unidade física dentro do tenant.
> - **RLS** (*Row Level Security*) = filtro de linhas aplicado pelo próprio PostgreSQL, não pela aplicação.
> - **GUC** (*Grand Unified Configuration*) = variável de configuração de sessão do PostgreSQL. Usamos GUCs customizadas (`app.tenant_id`, etc.) para carregar o contexto da requisição para dentro do banco.
> - **PgBouncer em *transaction mode*** = pooler que devolve a conexão ao pool ao final de **cada transação**, não ao final da sessão. É por isso que qualquer estado de sessão vaza para a requisição seguinte, de outro tenant.

---

### Task 3: Pacote `packages/db` e o harness de migration

**Por que existe:** migrations em `.sql` puro, forward-only, sem *down migration*. O engenheiro escreve DDL à mão porque `GRANT`, `POLICY`, `EXCLUDE USING gist`, partição e função `SECURITY DEFINER` não são gerados por ORM nenhum. O harness só precisa fazer três coisas certas: aplicar os arquivos **em ordem**, aplicar **uma transação por arquivo**, e **registrar o que já rodou** com checksum, para que ninguém edite uma migration já aplicada em produção.

**Arquivos:**
- Modificar: `packages/db/package.json` (acrescentar a dependência `pg`)
- Modificar: `package.json` (raiz) — bloco `scripts`
- Criar: `packages/db/migrations/.gitkeep`
- Criar: `packages/db/src/paths.ts`
- Criar: `packages/db/src/migration-files.ts`
- Criar: `packages/db/src/migrate.ts`
- Criar: `packages/db/src/migrate-cli.ts`
- Criar: `packages/db/src/new-migration.ts`
- Modificar: `packages/db/src/index.ts`
- Teste: `packages/db/src/migration-files.test.ts`
- Teste: `packages/db/src/migrate.int.test.ts`

- [ ] **Passo 1: Instalar as dependências do pacote**

```bash
pnpm add pg --filter @cadencia/db
pnpm add -D @types/pg --filter @cadencia/db
pnpm add -D -w tsx
mkdir -p packages/db/migrations && touch packages/db/migrations/.gitkeep
```

- [ ] **Passo 2: Escrever o teste que falha — helpers puros do harness**

Criar `packages/db/src/migration-files.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertForwardOnly,
  checksumOf,
  isMigrationName,
  nextMigrationName,
  type MigrationFile,
} from './migration-files';

function fake(version: string, name: string, sql: string): MigrationFile {
  return { version, name, sql, checksum: checksumOf(sql) };
}

describe('nomeacao de migration', () => {
  it('aceita apenas quatro digitos seguidos de snake_case e extensao .sql', () => {
    expect(isMigrationName('0001_roles.sql')).toBe(true);
    expect(isMigrationName('0002_transaction_context.sql')).toBe(true);
    expect(isMigrationName('1_roles.sql')).toBe(false);
    expect(isMigrationName('0001-roles.sql')).toBe(false);
    expect(isMigrationName('0001_Roles.sql')).toBe(false);
    expect(isMigrationName('README.md')).toBe(false);
  });

  it('a primeira migration do repositorio e a 0001', () => {
    expect(nextMigrationName([], 'roles')).toBe('0001_roles.sql');
  });

  it('numera a proxima a partir da maior existente, ignorando arquivos estranhos', () => {
    const existing = ['0001_roles.sql', 'README.md', '0002_transaction_context.sql'];
    expect(nextMigrationName(existing, 'patient')).toBe('0003_patient.sql');
  });

  it('recusa nome com espaco ou maiuscula em vez de gerar arquivo invisivel para o runner', () => {
    expect(() => nextMigrationName([], 'Papeis Do Banco')).toThrowError(
      /nome de migration invalido/,
    );
  });
});

describe('forward-only', () => {
  it('devolve so as migrations ainda nao aplicadas, na ordem dos arquivos', () => {
    const files = [
      fake('0001', '0001_roles.sql', 'CREATE ROLE a;'),
      fake('0002', '0002_transaction_context.sql', 'CREATE SCHEMA app;'),
      fake('0003', '0003_patient.sql', 'CREATE TABLE t();'),
    ];
    const applied = new Map([['0001', checksumOf('CREATE ROLE a;')]]);

    const pending = assertForwardOnly(files, applied);

    expect(pending.map((m) => m.name)).toEqual([
      '0002_transaction_context.sql',
      '0003_patient.sql',
    ]);
  });

  it('recusa migration ja aplicada que foi editada depois', () => {
    const files = [fake('0001', '0001_roles.sql', 'CREATE ROLE a; -- editado')];
    const applied = new Map([['0001', checksumOf('CREATE ROLE a;')]]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /0001_roles\.sql foi alterada depois de aplicada/,
    );
  });

  it('recusa arquivo novo com numero menor que uma migration ja aplicada', () => {
    const files = [
      fake('0001', '0001_roles.sql', 'CREATE ROLE a;'),
      fake('0002', '0002_intruso.sql', 'CREATE SCHEMA x;'),
      fake('0003', '0003_transaction_context.sql', 'CREATE SCHEMA app;'),
    ];
    const applied = new Map([
      ['0001', checksumOf('CREATE ROLE a;')],
      ['0003', checksumOf('CREATE SCHEMA app;')],
    ]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /0002_intruso\.sql e anterior a 0003 ja aplicada/,
    );
  });

  it('recusa migration que sumiu do repositorio mas consta como aplicada', () => {
    const files = [fake('0001', '0001_roles.sql', 'CREATE ROLE a;')];
    const applied = new Map([
      ['0001', checksumOf('CREATE ROLE a;')],
      ['0002', 'deadbeef'],
    ]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /aplicadas e ausentes do repositorio: 0002/,
    );
  });
});
```

- [ ] **Passo 3: Rodar o teste e confirmar que falha**

Rodar: `pnpm test packages/db/src/migration-files.test.ts`

Esperado: FALHA com `Failed to resolve import "./migration-files"` (o arquivo ainda não existe).

- [ ] **Passo 4: Implementar os helpers puros**

Criar `packages/db/src/migration-files.ts`:

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationFile {
  readonly version: string; // '0001'
  readonly name: string; // '0001_roles.sql'
  readonly sql: string;
  readonly checksum: string; // sha256 hex do conteudo
}

const MIGRATION_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isMigrationName(name: string): boolean {
  return MIGRATION_NAME.test(name);
}

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function readMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter(isMigrationName)
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { version: name.slice(0, 4), name, sql, checksum: checksumOf(sql) };
    });
}

export function nextMigrationName(existing: readonly string[], slug: string): string {
  if (!SLUG.test(slug)) {
    throw new Error(
      `nome de migration invalido: "${slug}" (use apenas a-z, 0-9 e _, por exemplo transaction_context)`,
    );
  }
  const versions = existing.filter(isMigrationName).map((n) => Number(n.slice(0, 4)));
  const next = (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
  if (next > 9999) {
    throw new Error('limite de 9999 migrations atingido');
  }
  return `${String(next).padStart(4, '0')}_${slug}.sql`;
}

/**
 * Regras forward-only, verificadas antes de qualquer escrita no banco:
 * 1. migration aplicada nunca muda de conteudo (checksum);
 * 2. arquivo novo nunca entra com numero menor que uma migration ja aplicada
 *    (senao ele roda em producao numa ordem diferente da que rodou no dev);
 * 3. migration aplicada nunca some do repositorio.
 */
export function assertForwardOnly(
  files: readonly MigrationFile[],
  applied: ReadonlyMap<string, string>,
): MigrationFile[] {
  const pending: MigrationFile[] = [];
  let lastApplied = '0000';

  for (const file of files) {
    const previousChecksum = applied.get(file.version);
    if (previousChecksum === undefined) {
      pending.push(file);
      continue;
    }
    if (previousChecksum !== file.checksum) {
      throw new Error(
        `migration ${file.name} foi alterada depois de aplicada: migrations sao forward-only, crie uma nova`,
      );
    }
    lastApplied = file.version;
  }

  for (const file of pending) {
    if (file.version <= lastApplied) {
      throw new Error(
        `migration ${file.name} e anterior a ${lastApplied} ja aplicada: renomeie para o proximo numero livre`,
      );
    }
  }

  const known = new Set(files.map((f) => f.version));
  const missing = [...applied.keys()].filter((v) => !known.has(v)).sort();
  if (missing.length > 0) {
    throw new Error(`migrations aplicadas e ausentes do repositorio: ${missing.join(', ')}`);
  }

  return pending;
}
```

- [ ] **Passo 5: Rodar e confirmar que passa**

Rodar: `pnpm test packages/db/src/migration-files.test.ts`

Esperado: PASSA, 8 testes.

- [ ] **Passo 6: Escrever o teste que falha — o runner contra um PostgreSQL real**

Criar `packages/db/src/migrate.int.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const TEST_DB = 'cadencia_harness_test';

function adminUrl(): string {
  const url = process.env.DATABASE_URL_ADMIN;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente: rode `cp .env.example .env` e `pnpm db:up`');
  }
  return url;
}

function testDbUrl(): string {
  const url = new URL(adminUrl());
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

let admin: Pool;
let dir: string;

beforeAll(() => {
  admin = new Pool({ connectionString: adminUrl(), max: 1 });
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  dir = mkdtempSync(join(tmpdir(), 'cadencia-mig-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function queryTestDb<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const pool = new Pool({ connectionString: testDbUrl(), max: 1 });
  try {
    const result = await pool.query<T>(sql);
    return result.rows;
  } finally {
    await pool.end();
  }
}

describe('pnpm db:migrate', () => {
  it('aplica os arquivos .sql em ordem numerica e registra cada um', async () => {
    // A segunda migration so funciona se a primeira ja tiver rodado.
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');
    writeFileSync(join(dir, '0002_probe_nome.sql'), 'ALTER TABLE public.probe ADD COLUMN nome text;');

    const result = await runMigrations({ connectionString: testDbUrl(), dir });

    expect(result.applied).toEqual(['0001_probe.sql', '0002_probe_nome.sql']);
    const columns = await queryTestDb<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'probe' ORDER BY column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(['id', 'nome']);
  });

  it('e idempotente: a segunda execucao nao reaplica nada', async () => {
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');

    await runMigrations({ connectionString: testDbUrl(), dir });
    const second = await runMigrations({ connectionString: testDbUrl(), dir });

    expect(second.applied).toEqual([]);
    const rows = await queryTestDb<{ version: string }>(
      'SELECT version FROM public.schema_migration ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual(['0001']);
  });

  it('recusa rodar quando uma migration ja aplicada foi editada', async () => {
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE public.probe (id int PRIMARY KEY);');
    await runMigrations({ connectionString: testDbUrl(), dir });

    writeFileSync(
      join(dir, '0001_probe.sql'),
      'CREATE TABLE public.probe (id int PRIMARY KEY, nome text);',
    );

    await expect(runMigrations({ connectionString: testDbUrl(), dir })).rejects.toThrowError(
      /0001_probe\.sql foi alterada depois de aplicada/,
    );
  });

  it('aborta a migration inteira quando o SQL falha no meio, sem registrar meia-migration', async () => {
    writeFileSync(
      join(dir, '0001_probe.sql'),
      ['CREATE TABLE public.probe (id int PRIMARY KEY);', 'CREATE TABLE public.probe (id int);'].join(
        '\n',
      ),
    );

    await expect(runMigrations({ connectionString: testDbUrl(), dir })).rejects.toThrowError(
      /migration 0001_probe\.sql falhou/,
    );

    const tables = await queryTestDb<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'probe'`,
    );
    expect(tables).toEqual([]);
    const applied = await queryTestDb<{ version: string }>(
      'SELECT version FROM public.schema_migration',
    );
    expect(applied).toEqual([]);
  });
});
```

- [ ] **Passo 7: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/migrate.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./migrate"`.

- [ ] **Passo 8: Implementar o runner**

Criar `packages/db/src/paths.ts`:

```ts
import { resolve } from 'node:path';

export function migrationsDir(): string {
  return resolve(import.meta.dirname, '../migrations');
}
```

Criar `packages/db/src/migrate.ts`:

```ts
import { Pool } from 'pg';
import { assertForwardOnly, readMigrationFiles } from './migration-files';
import { migrationsDir } from './paths';

// Chave arbitraria e fixa do advisory lock: dois deploys simultaneos nao aplicam
// a mesma migration duas vezes.
const LOCK_KEY = 4_021_976;

export interface MigrateOptions {
  readonly connectionString?: string;
  readonly dir?: string;
}

export interface MigrateResult {
  readonly applied: string[];
}

export async function runMigrations(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL_ADMIN;
  if (connectionString === undefined || connectionString === '') {
    throw new Error(
      'DATABASE_URL_ADMIN ausente: migrations usam a conexao administrativa, nunca a do papel `api`',
    );
  }
  const dir = opts.dir ?? migrationsDir();

  const pool = new Pool({ connectionString, max: 1, application_name: 'cadencia-migrate' });
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migration (
        version     text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        duration_ms integer NOT NULL)`);

    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const state = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM public.schema_migration',
    );
    const pending = assertForwardOnly(
      readMigrationFiles(dir),
      new Map(state.rows.map((r) => [r.version, r.checksum])),
    );

    for (const migration of pending) {
      // performance.now(), nunca Date.now(): duracao e MEDICAO, e a guarda de fonte
      // de tempo (tools/repo/time-source.ts) reprova relogio de parede em packages/**.
      const startedAt = performance.now();
      try {
        // Uma transacao por arquivo: ou o arquivo inteiro entra, ou nada entra.
        // Consequencia consciente: nada de CREATE INDEX CONCURRENTLY numa migration.
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.schema_migration (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [
            migration.version,
            migration.name,
            migration.checksum,
            Math.round(performance.now() - startedAt),
          ],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migration.name} falhou: ${(err as Error).message}`, {
          cause: err,
        });
      }
      applied.push(migration.name);
    }

    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}
```

Criar `packages/db/src/migrate-cli.ts`:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from './migrate';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const result = await runMigrations();
if (result.applied.length === 0) {
  console.log('nenhuma migration pendente');
} else {
  for (const name of result.applied) {
    console.log(`aplicada: ${name}`);
  }
}
```

Criar `packages/db/src/new-migration.ts`:

```ts
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextMigrationName } from './migration-files';
import { migrationsDir } from './paths';

const slug = process.argv[2];
if (slug === undefined) {
  console.error('uso: pnpm db:new <nome_da_migration>   (exemplo: pnpm db:new transaction_context)');
  process.exit(1);
}

const dir = migrationsDir();
const name = nextMigrationName(readdirSync(dir), slug);
const path = join(dir, name);

writeFileSync(
  path,
  [
    `-- ${name}`,
    '-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.',
    '-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.',
    '',
    '',
  ].join('\n'),
  { flag: 'wx' },
);

console.log(path);
```

Acrescentar ao bloco `scripts` do `package.json` da raiz:

```json
    "db:new": "tsx packages/db/src/new-migration.ts",
    "db:migrate": "tsx packages/db/src/migrate-cli.ts"
```

- [ ] **Passo 9: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/migrate.int.test.ts`

Esperado: PASSA, 4 testes.

- [ ] **Passo 10: Criar o barril do pacote**

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
```

Rodar: `pnpm typecheck`

Esperado: sem saída (zero erros de tipo).

- [ ] **Passo 11: Commitar**

```bash
git add package.json pnpm-lock.yaml packages/db
git commit -m "feat(db): sql migration harness, forward-only, with checksum and advisory lock"
```

---

### Task 4: Migration 0001 — papéis e GRANTs

**Por que existe:** este é o item 1 das decisões irreversíveis. O isolamento entre clínicas não é uma checagem da aplicação: é uma propriedade do grafo de permissões do banco. Três consequências que o engenheiro precisa entender antes de escrever a migration:

1. **`api` não pode ser dono de nenhuma relação.** O dono de uma tabela pode executar `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` e `DROP POLICY` — ou seja, o dono desliga o isolamento com um comando. Por isso o papel que faz login em runtime (`api`) é criado sem posse nenhuma, e quem cria as tabelas é `app_owner`, que não faz login.
2. **`jobs` é o único papel com `BYPASSRLS`.** O selo diário da auditoria, o detector de divergência do financeiro e a carga da tabela TUSS precisam ver **todas** as linhas de **todos** os tenants. Sem esse papel, esses três jobs rodariam vendo zero linhas e reportando sucesso para sempre — a falha silenciosa que mata dois controles compensatórios do desenho.
3. **`api` é `NOINHERIT`.** Ele é *membro* de `app_rw`, mas não herda os privilégios automaticamente: precisa executar `SET ROLE app_rw` dentro da transação. Isso é deliberado e tem consequência prática forte — sem o `SET LOCAL ROLE app_rw` que a Task 15 coloca no preâmbulo, toda query da aplicação retorna `permission denied`. É uma trava a mais: código que não passa pelo preâmbulo não lê nada.

> **Divergência conhecida com a spec, resolvida aqui.** A spec §3.1 escreve `CREATE ROLE support LOGIN IN ROLE app_support;` mas nunca cria `app_support`. Executado literalmente, o SQL falha com `role "app_support" does not exist`. A §9 confirma que `app_support` é um papel real ("Papel de banco separado (`app_support`)" na mitigação de break-glass). A migration abaixo cria `app_support NOLOGIN` junto com os demais papéis funcionais.

**Arquivos:**
- Criar: `packages/db/migrations/0001_roles.sql`
- Teste: `packages/db/src/roles.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/roles.int.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolcanlogin: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
}

let admin: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
});

afterAll(async () => {
  await admin.end();
});

async function role(name: string): Promise<RoleRow | undefined> {
  const result = await admin.query<RoleRow>(
    `SELECT rolname, rolsuper, rolcanlogin, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = $1`,
    [name],
  );
  return result.rows[0];
}

describe('papeis do banco (§3.1)', () => {
  it('cria os seis papeis funcionais sem login', async () => {
    for (const name of ['app_owner', 'app_rw', 'clin_writer', 'audit_owner', 'rpt_owner', 'app_support']) {
      const r = await role(name);
      expect(r, `papel ${name} nao existe`).toBeDefined();
      expect(r?.rolcanlogin, `papel ${name} nao pode fazer login`).toBe(false);
    }
  });

  it('cria os tres papeis de login: api, support e jobs', async () => {
    for (const name of ['api', 'support', 'jobs']) {
      const r = await role(name);
      expect(r, `papel ${name} nao existe`).toBeDefined();
      expect(r?.rolcanlogin, `papel ${name} precisa fazer login`).toBe(true);
    }
  });

  it('api nao e superusuario, nao cria banco, nao cria papel e nao herda privilegio', async () => {
    const api = await role('api');
    expect(api?.rolsuper).toBe(false);
    expect(api?.rolcreatedb).toBe(false);
    expect(api?.rolcreaterole).toBe(false);
    expect(api?.rolbypassrls).toBe(false);
    // NOINHERIT: `api` e membro de app_rw mas so usa os privilegios apos SET ROLE.
    expect(api?.rolinherit).toBe(false);
  });

  it('api e membro de app_rw e support e membro de app_support', async () => {
    const result = await admin.query<{ member: string; grantee: string }>(
      `SELECT m.rolname AS member, g.rolname AS grantee
         FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member
         JOIN pg_roles g ON g.oid = am.roleid
        WHERE m.rolname IN ('api', 'support')`,
    );
    const pairs = result.rows.map((r) => `${r.member}->${r.grantee}`).sort();
    expect(pairs).toEqual(['api->app_rw', 'support->app_support']);
  });

  it('app_owner e membro de audit_owner: sem isso a migration da trilha nao consegue SET ROLE', async () => {
    const result = await admin.query<{ ok: boolean }>(
      `SELECT pg_has_role('app_owner', 'audit_owner', 'MEMBER') AS ok`,
    );
    expect(result.rows[0]?.ok).toBe(true);
  });

  it('api tem row_security ligado explicitamente na configuracao do papel', async () => {
    const result = await admin.query<{ rolconfig: string[] | null }>(
      `SELECT rolconfig FROM pg_roles WHERE rolname = 'api'`,
    );
    expect(result.rows[0]?.rolconfig ?? []).toContain('row_security=on');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/roles.int.test.ts`

Esperado: FALHA com `papel app_owner nao existe` (`expected undefined to be defined`).

- [ ] **Passo 3: Criar o arquivo da migration**

Rodar: `pnpm db:new roles`

Esperado: imprime `.../packages/db/migrations/0001_roles.sql`.

- [ ] **Passo 4: Escrever a migration**

Substituir o conteúdo de `packages/db/migrations/0001_roles.sql` por:

```sql
-- 0001_roles.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

-- §3.1 Papeis — a fundacao.
--
-- Papeis funcionais (NOLOGIN): sao alvo de GRANT e de POLICY, nunca abrem conexao.
CREATE ROLE app_owner   NOLOGIN;   -- dono do schema, roda migrations, sem login em runtime
CREATE ROLE app_rw      NOLOGIN;   -- papel funcional da aplicacao, sujeito a RLS
CREATE ROLE clin_writer NOLOGIN;   -- unico com INSERT no nucleo clinico; funcoes SECURITY DEFINER
CREATE ROLE audit_owner NOLOGIN;   -- dono exclusivo do schema audit
CREATE ROLE rpt_owner   NOLOGIN;   -- dono das matviews; app_rw nao tem GRANT nelas
-- app_support NAO consta do trecho literal da spec, mas `support` e criado IN ROLE
-- app_support e a §9 o cita como o papel do break-glass. Sem esta linha o SQL nao roda.
CREATE ROLE app_support NOLOGIN;   -- break-glass do suporte, sem escrita clinica

-- Papeis de login: abrem conexao, nao possuem relacao nenhuma.
CREATE ROLE api     LOGIN IN ROLE app_rw;      -- pool da aplicacao
CREATE ROLE support LOGIN IN ROLE app_support; -- break-glass, pool separado
CREATE ROLE jobs    LOGIN;                     -- UNICO papel com BYPASSRLS

ALTER ROLE api     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE support NOSUPERUSER NOBYPASSRLS;
ALTER ROLE jobs    NOSUPERUSER BYPASSRLS;      -- selo, drift, expurgo, partman, carga TUSS
ALTER ROLE api SET row_security = on;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- A migration da trilha (0008) faz `SET ROLE audit_owner` para que o schema audit
-- nasca com dono proprio. Em producao as migrations rodam como app_owner, que
-- precisa ser MEMBRO de audit_owner — senao o SET ROLE falha com 42501 e a trilha
-- nunca e criada. Localmente rodamos como superusuario, mas a dependencia e a mesma.
GRANT audit_owner TO app_owner;

-- Por que `api` e NOINHERIT: ser membro de app_rw sem herdar obriga a transacao a
-- executar SET LOCAL ROLE app_rw. Codigo que nao passa pelo preambulo de
-- packages/db/src/tx.ts recebe `permission denied`, nao dado de outro tenant.
--
-- Por que `api` nunca sera dono de relacao: o dono de uma tabela pode executar
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY e DROP POLICY. Dono e login sao
-- separados exatamente para que o papel exposto a internet nao possa desligar a RLS.
--
-- Por que `jobs` tem BYPASSRLS: o selo diario da auditoria, o detector de divergencia
-- do financeiro e a carga bimestral da TUSS precisam ver todos os tenants. Sem
-- BYPASSRLS eles veriam zero linhas e reportariam sucesso para sempre.
```

- [ ] **Passo 5: Aplicar a migration**

Rodar: `pnpm db:migrate`

Esperado: imprime `aplicada: 0001_roles.sql`.

- [ ] **Passo 6: Rodar o teste e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/roles.int.test.ts`

Esperado: PASSA, 6 testes.

- [ ] **Passo 7: Commitar**

```bash
git add packages/db/migrations/0001_roles.sql packages/db/src/roles.int.test.ts
git commit -m "feat(db): migration 0001 creates database roles and revokes public schema"
```

---

### Task 5: Invariante de CI — `api` sem posse, `jobs` único com `BYPASSRLS`

**Por que existe:** é o invariante 3 dos 10 que o CI verifica a cada merge. A Task 4 provou que os papéis nasceram certos; esta task prova que eles **continuam** certos depois de qualquer migration futura. É o teste que reprova o PR em que alguém, sem querer, cria uma tabela conectado como `api`, ou dá `BYPASSRLS` para um papel de conveniência.

**Detalhe que costuma passar batido:** no PostgreSQL, todo superusuário tem `rolbypassrls = true` em `pg_roles`, e o papel de migration no ambiente local **é** superusuário. A asserção correta é *"`jobs` é o único papel **não-superusuário** com `BYPASSRLS`"* — se o teste comparar a lista crua, ele falha no primeiro `pnpm test:int` e o engenheiro vai "consertar" removendo a asserção.

**Arquivos:**
- Criar: `packages/db/src/roles-invariants.int.test.ts`

- [ ] **Passo 1: Escrever o teste**

Criar `packages/db/src/roles-invariants.int.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

let admin: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
});

afterAll(async () => {
  await admin.end();
});

describe('invariante 3 do CI: papeis e posse', () => {
  it('api nao e dono de nenhuma tabela, view, matview, sequencia ou tabela particionada', async () => {
    const result = await admin.query<{ objeto: string }>(
      `SELECT n.nspname || '.' || c.relname AS objeto
         FROM pg_class c
         JOIN pg_roles r ON r.oid = c.relowner
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE r.rolname = 'api'
          AND c.relkind IN ('r', 'p', 'm', 'v', 'f', 'S')
        ORDER BY 1`,
    );
    // Dono desliga RLS com um comando. O papel exposto a internet nunca e dono.
    expect(result.rows.map((r) => r.objeto)).toEqual([]);
  });

  it('jobs e o unico papel nao-superusuario do cluster com BYPASSRLS', async () => {
    const result = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolbypassrls
          AND NOT rolsuper          -- superusuario tem todas as flags; nao e o alvo da regra
          AND rolname NOT LIKE 'pg\\_%'
        ORDER BY rolname`,
    );
    expect(result.rows.map((r) => r.rolname)).toEqual(['jobs']);
  });

  it('nenhum papel funcional da aplicacao faz login', async () => {
    const result = await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolcanlogin
          AND rolname IN ('app_owner', 'app_rw', 'clin_writer', 'audit_owner',
                          'rpt_owner', 'app_support')
        ORDER BY rolname`,
    );
    expect(result.rows.map((r) => r.rolname)).toEqual([]);
  });

  it('o pseudo-papel PUBLIC nao tem privilegio nenhum no schema public', async () => {
    const result = await admin.query<{ usage_ok: boolean; create_ok: boolean }>(
      `SELECT has_schema_privilege('public', 'public', 'USAGE')  AS usage_ok,
              has_schema_privilege('public', 'public', 'CREATE') AS create_ok`,
    );
    expect(result.rows[0]?.usage_ok).toBe(false);
    expect(result.rows[0]?.create_ok).toBe(false);
  });

  it('api nao consegue criar tabela em lugar nenhum', async () => {
    const apiPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      await expect(apiPool.query('CREATE TABLE public.tentativa (id int)')).rejects.toMatchObject({
        code: '42501', // insufficient_privilege
      });
    } finally {
      await apiPool.end();
    }
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que passa desde a primeira execução**

Rodar: `pnpm test:int packages/db/src/roles-invariants.int.test.ts`

Esperado: PASSA, 5 testes. Este é um teste de invariante, não de funcionalidade nova: ele nasce verde porque a migration 0001 já está correta. O valor dele é ficar vermelho no futuro.

- [ ] **Passo 3: Provar que o teste realmente pega a violação**

Rodar, para quebrar o invariante de propósito:

```bash
docker compose exec -T db psql -U postgres -d cadencia -c "ALTER ROLE support BYPASSRLS;"
pnpm test:int packages/db/src/roles-invariants.int.test.ts
```

Esperado: FALHA com `expected [ 'jobs', 'support' ] to deeply equal [ 'jobs' ]`.

- [ ] **Passo 4: Desfazer a violação e confirmar que volta a passar**

Rodar:

```bash
docker compose exec -T db psql -U postgres -d cadencia -c "ALTER ROLE support NOBYPASSRLS;"
pnpm test:int packages/db/src/roles-invariants.int.test.ts
```

Esperado: PASSA, 5 testes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/src/roles-invariants.int.test.ts
git commit -m "test(db): CI invariant 3 — api owns no relation, jobs is the only BYPASSRLS role"
```

---

### Task 6: Migration 0002 — schemas, extensões e contexto de transação

**Por que existe:** as funções desta migration são lidas por **toda** policy de RLS do sistema. O detalhe que decide se o produto funciona ou não é `nullif(..., '')` em toda leitura de GUC:

- O ator `user` tem `tenant_id` **e** `user_id`.
- O ator `system` (worker processando o outbox, webhook do WhatsApp chegando) tem `tenant_id` e **não tem** `user_id`.
- O ator `anon` (paciente marcando consulta pelo agendamento online) tem `tenant_id` e **não tem** `user_id`.

Como o preâmbulo grava GUC sempre como texto, "ausente" chega no banco como string vazia. `''::uuid` levanta `invalid input syntax for type uuid` (SQLSTATE 22P02) e **aborta a transação inteira**. Sem `nullif`, worker, webhook e agendamento online quebram em 100% dos casos — não em um caso de borda: em todos.

A segunda assimetria deliberada: `app.current_tenant_id()` devolve `NULL` em silêncio (leitura sem contexto retorna zero linhas, que é sempre seguro), e `app.require_tenant_id()` levanta exceção `42501` (escrita sem contexto é bug e precisa aparecer no monitoramento).

> **Escopo desta migration:** extensões, schemas e as três funções de contexto. **Nenhuma tabela.** As tabelas de tenancy, identidade e paciente entram nas migrations 0003, 0004 e 0005, junto com os testes de isolamento que as cobrem — e as funções derivadas do vínculo (`app.is_member`, `app.has_role_in`, `app.current_professional_id`, `app.clinical_scope_all`) entram na 0004, porque leem `app.membership` e `app.professional`. O schema `audit` não é criado aqui: ele nasce na 0008 com `AUTHORIZATION audit_owner`.

**Arquivos:**
- Criar: `packages/db/migrations/0002_transaction_context.sql`
- Teste: `packages/db/src/transaction-context.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/transaction-context.int.test.ts`:

```ts
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const TENANT = '01930000-0000-7000-8000-0000000000a1';

let admin: Pool;
let api: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });
  api = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  // Tabela-sonda: existe so para provar o NOINHERIT do papel `api`. O GRANT vai
  // para app_rw e NAO para api — que e exatamente a situacao de toda tabela do
  // sistema. Sem SET LOCAL ROLE app_rw, `api` nao le nada.
  await admin.query('CREATE TABLE IF NOT EXISTS public.noinherit_probe (id int PRIMARY KEY)');
  await admin.query('GRANT USAGE ON SCHEMA public TO app_rw');
  await admin.query('GRANT SELECT ON public.noinherit_probe TO app_rw');
});

afterAll(async () => {
  await admin.query('DROP TABLE IF EXISTS public.noinherit_probe');
  await admin.end();
  await api.end();
});

/** Abre transacao no papel api, aplica o contexto pedido e devolve o cliente. */
async function beginAs(
  ctx: { tenantId?: string; userId?: string; clinicId?: string; actorKind: string },
): Promise<PoolClient> {
  const client = await api.connect();
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE app_rw');
  await client.query(
    `SELECT set_config('app.tenant_id',  $1, TRUE),
            set_config('app.user_id',    $2, TRUE),
            set_config('app.clinic_id',  $3, TRUE),
            set_config('app.actor_kind', $4, TRUE)`,
    [ctx.tenantId ?? '', ctx.userId ?? '', ctx.clinicId ?? '', ctx.actorKind],
  );
  return client;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK');
  client.release();
}

describe('leitura de GUC com nullif (§3.2)', () => {
  it('ator de sistema sem usuario nao explode: current_user_id devolve NULL para string vazia', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'system' });
    try {
      const result = await client.query<{ uid: string | null }>('SELECT app.current_user_id() AS uid');
      expect(result.rows[0]?.uid).toBeNull();
    } finally {
      await rollback(client);
    }
  });

  it('sem o nullif, a mesma leitura levantaria 22P02 e abortaria a transacao do worker', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'system' });
    try {
      // Prova direta do motivo do nullif. Este e o SQL que o desenho original tinha.
      await expect(
        client.query(`SELECT current_setting('app.user_id', true)::uuid`),
      ).rejects.toMatchObject({ code: '22P02' });
    } finally {
      await rollback(client);
    }
  });

  it('current_tenant_id devolve o tenant do preambulo', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'user' });
    try {
      const result = await client.query<{ tid: string | null }>(
        'SELECT app.current_tenant_id() AS tid',
      );
      expect(result.rows[0]?.tid).toBe(TENANT);
    } finally {
      await rollback(client);
    }
  });

  it('sem preambulo nenhum, current_tenant_id devolve NULL em vez de erro (leitura falha fechada)', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      const result = await client.query<{ tid: string | null }>(
        'SELECT app.current_tenant_id() AS tid',
      );
      expect(result.rows[0]?.tid).toBeNull();
    } finally {
      await rollback(client);
    }
  });

  it('require_tenant_id falha alto com 42501 quando o contexto esta ausente (escrita)', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      await expect(client.query('SELECT app.require_tenant_id()')).rejects.toMatchObject({
        code: '42501',
        message: expect.stringContaining('contexto de tenant ausente'),
      });
    } finally {
      await rollback(client);
    }
  });
});

describe('schemas e extensoes', () => {
  it('cria os sete schemas do desenho com o dono correto, e nao cria audit (que nasce na 0008)', async () => {
    const result = await admin.query<{ nspname: string; owner: string }>(
      `SELECT n.nspname, r.rolname AS owner
         FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname IN ('app','clin','fin','tiss','ref','id','rpt','audit')
        ORDER BY n.nspname`,
    );
    const owners = Object.fromEntries(result.rows.map((r) => [r.nspname, r.owner]));
    expect(owners).toEqual({
      app: 'app_owner', clin: 'app_owner', fin: 'app_owner', id: 'app_owner',
      ref: 'app_owner', rpt: 'rpt_owner', tiss: 'app_owner',
    });
  });

  it('instala as seis extensoes da secao 2.3 tambem por migration, e nao so pelo docker-compose', async () => {
    const result = await admin.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const installed = result.rows.map((r) => r.extname);
    for (const extension of ['pgcrypto', 'btree_gist', 'btree_gin', 'pg_trgm', 'unaccent', 'citext']) {
      expect(installed, `extensao ${extension} ausente`).toContain(extension);
    }
  });
});

describe('NOINHERIT do papel api', () => {
  it('api nao le uma tabela concedida a app_rw antes de SET LOCAL ROLE app_rw', async () => {
    const client = await api.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query('SELECT 1 FROM public.noinherit_probe')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await rollback(client);
    }
  });

  it('depois do SET LOCAL ROLE app_rw, a mesma leitura funciona', async () => {
    const client = await beginAs({ tenantId: TENANT, actorKind: 'user' });
    try {
      const result = await client.query('SELECT 1 FROM public.noinherit_probe');
      expect(result.rows).toHaveLength(0); // tabela vazia, mas a leitura foi permitida
    } finally {
      await rollback(client);
    }
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/transaction-context.int.test.ts`

Esperado: FALHA com `function app.current_user_id() does not exist` (SQLSTATE `42883`).

- [ ] **Passo 3: Criar o arquivo da migration**

Rodar: `pnpm db:new transaction_context`

Esperado: imprime `.../packages/db/migrations/0002_transaction_context.sql`.

- [ ] **Passo 4: Escrever a migration**

Substituir o conteúdo de `packages/db/migrations/0002_transaction_context.sql` por:

```sql
-- 0002_transaction_context.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.

-- ---------------------------------------------------------------------------
-- 1. Extensoes (§2.3). Todas sao "trusted" no PostgreSQL 18 e ficam em public.
--    O docker-compose ja as cria no cluster local; aqui e o que vale em producao
--    e no container descartavel de `pnpm test:iso`.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- btree_gin e obrigatorio: sem ele nao existe indice GIN liderado por tenant_id,
-- e a recepcionista de uma clinica paga o preco do crescimento da base das outras.
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- 2. Schemas. `audit` NAO entra aqui: ele nasce na migration 0008 com
--    AUTHORIZATION audit_owner, que e o que torna a trilha inalcancavel por
--    app_owner e por app_rw.
-- ---------------------------------------------------------------------------
CREATE SCHEMA app   AUTHORIZATION app_owner;   -- plataforma, agenda, identidade de tenant
CREATE SCHEMA clin  AUTHORIZATION app_owner;   -- clinico
CREATE SCHEMA fin   AUTHORIZATION app_owner;   -- financeiro
CREATE SCHEMA tiss  AUTHORIZATION app_owner;   -- convenios
CREATE SCHEMA ref   AUTHORIZATION app_owner;   -- referencia global (CID, TUSS)
CREATE SCHEMA id    AUTHORIZATION app_owner;   -- identidade global, sem tenant_id
CREATE SCHEMA rpt   AUTHORIZATION rpt_owner;   -- matviews; app_rw nunca recebe GRANT aqui

-- A 0001 revogou USAGE de public do pseudo-papel PUBLIC. Devolvemos USAGE (nunca
-- CREATE) nominalmente, senao pg_trgm, citext e unaccent ficam inalcancaveis.
GRANT USAGE ON SCHEMA public TO app_rw, clin_writer, audit_owner, rpt_owner, app_support;
GRANT USAGE ON SCHEMA app, clin, fin, tiss, ref, id TO app_rw, clin_writer, app_support;
GRANT USAGE ON SCHEMA app TO audit_owner, rpt_owner;

-- ---------------------------------------------------------------------------
-- 3. Leitura do contexto (§3.2).
--    TODA leitura de GUC usa nullif(..., ''), sem excecao: o ator de sistema e o
--    anonimo nao tem user_id, e ''::uuid levanta 22P02 e aborta a transacao.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app.require_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE t uuid := app.current_tenant_id();
BEGIN IF t IS NULL THEN RAISE EXCEPTION 'contexto de tenant ausente' USING ERRCODE='42501'; END IF;
      RETURN t; END $$;

ALTER FUNCTION app.current_tenant_id() OWNER TO app_owner;
ALTER FUNCTION app.current_user_id()   OWNER TO app_owner;
ALTER FUNCTION app.require_tenant_id() OWNER TO app_owner;
```

- [ ] **Passo 5: Aplicar a migration**

Rodar: `pnpm db:migrate`

Esperado: imprime `aplicada: 0002_transaction_context.sql`.

- [ ] **Passo 6: Rodar o teste e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/transaction-context.int.test.ts`

Esperado: PASSA, 9 testes.

- [ ] **Passo 7: Provar que o `nullif` é o que segura o worker**

Editar temporariamente `packages/db/migrations/0002_transaction_context.sql`, trocando a linha do corpo de `app.current_user_id` por:

```sql
  SELECT current_setting('app.user_id', true)::uuid $$;
```

Rodar:

```bash
pnpm db:reset && pnpm db:migrate
pnpm test:int packages/db/src/transaction-context.int.test.ts
```

Esperado: FALHA no teste `ator de sistema sem usuario nao explode` com `invalid input syntax for type uuid: ""`. É exatamente o que aconteceria em 100% das execuções do worker, de todo webhook e de todo agendamento online.

- [ ] **Passo 8: Desfazer a alteração e reaplicar**

Reverter a linha para `SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;` e rodar:

```bash
pnpm db:reset && pnpm db:migrate
pnpm test:int packages/db/src/transaction-context.int.test.ts
```

Esperado: PASSA, 9 testes.

- [ ] **Passo 9: Commitar**

```bash
git add packages/db/migrations/0002_transaction_context.sql \
        packages/db/src/transaction-context.int.test.ts
git commit -m "feat(db): migration 0002 adds schemas, extensions and transaction context functions"
```

---
### Task 7: Harness da suíte `test:iso` (Testcontainers + migrations reais)

> **Por que esta tarefa vem aqui e não depois.** A spec §8 diz literalmente: *"a suíte `test:iso` é o primeiro teste do repositório, antes da primeira tela"*. Este é o primeiro ponto do plano em que ela pode existir: precisa dos papéis (0001) e das funções de contexto (0002), e de nada mais. Nenhuma tabela com `tenant_id` entra antes de existir o lugar onde o isolamento é provado.

**Arquivos:**
- Criar: `vitest.iso.config.ts`
- Criar: `packages/db/test/iso/fixtures.ts`
- Criar: `packages/db/test/iso/harness.ts`
- Criar: `packages/db/test/iso/global-setup.ts`
- Modificar: `package.json` (bloco `"scripts"`)
- Teste: `packages/db/test/iso/00-bootstrap.iso.test.ts`

- [ ] **Passo 1: Instalar as dependências da suíte**

```bash
pnpm add -D -w @testcontainers/postgresql testcontainers
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `packages/db/test/iso/00-bootstrap.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { openClient } from './harness';

describe('bootstrap da suite de isolamento', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('sobe um PostgreSQL 18 com as migrations reais do repositorio aplicadas em ordem', async () => {
    // current_setting em vez de SHOW: SHOW nao aceita alias, e a coluna viria
    // como `server_version_num`, deixando `v` undefined.
    const { rows } = await admin.query<{ v: string }>(
      `SELECT current_setting('server_version_num') AS v`,
    );
    expect(Number(rows[0]!.v)).toBeGreaterThanOrEqual(180000);

    const { rows: fn } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app'
          AND p.proname IN ('current_tenant_id','current_user_id','require_tenant_id')`,
    );
    expect(fn[0]!.n, 'migration 0002 (contexto de transacao) nao foi aplicada').toBe(3);
  });

  it('o papel de login da aplicacao nao e superusuario e nao tem BYPASSRLS', async () => {
    const { rows } = await admin.query<{ super: boolean; bypass: boolean }>(
      `SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'api'`,
    );
    expect(rows[0]).toEqual({ super: false, bypass: false });
  });

  it('sem preambulo, app.current_tenant_id() devolve NULL em vez de explodir', async () => {
    const { rows } = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(rows[0]!.t).toBeNull();
  });
});
```

- [ ] **Passo 3: Rodar e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA imediata. Como o script `test:iso` ainda não existe no `package.json`, a primeira execução falha com `ERR_PNPM_NO_SCRIPT  Missing script: test:iso`; depois de criado o script (Passo 8), a falha vira `Error: Cannot find module './harness'`. As duas mensagens contam como a falha esperada.

- [ ] **Passo 4: Criar o arquivo de constantes de fixture**

Criar `packages/db/test/iso/fixtures.ts`:

```ts
/**
 * Identificadores fixos da suite de isolamento.
 * Sao UUIDs validos com o formato de um UUIDv7 (versao 7, variante 10xx) para que
 * nenhuma coluna precise de tratamento especial. Sao literais de proposito:
 * um teste de isolamento tem que ser reproduzivel byte a byte.
 */
export const TENANT_A = '01930000-0000-7000-8000-0000000000a0';
export const TENANT_B = '01930000-0000-7000-8000-0000000000b0';

export const CLINIC_A_SP = '01930000-0000-7000-8000-0000000000a1';
export const CLINIC_A_MANAUS = '01930000-0000-7000-8000-0000000000a2';
export const CLINIC_B_RIO_BRANCO = '01930000-0000-7000-8000-0000000000b1';

export const USER_A_ANA = '01930000-0000-7000-8000-0000000000a3';
export const USER_A_BRUNO = '01930000-0000-7000-8000-0000000000a4';
export const USER_A_CARLA = '01930000-0000-7000-8000-0000000000a5';
export const USER_B_DIEGO = '01930000-0000-7000-8000-0000000000b2';

export const PROF_A_ANA = '01930000-0000-7000-8000-0000000000a6';
export const PROF_A_BRUNO = '01930000-0000-7000-8000-0000000000a7';
export const PROF_B_DIEGO = '01930000-0000-7000-8000-0000000000b3';

export const MEMBERSHIP_ANA_SP = '01930000-0000-7000-8000-0000000000c1';
export const MEMBERSHIP_ANA_MANAUS = '01930000-0000-7000-8000-0000000000c2';
export const MEMBERSHIP_BRUNO_SP = '01930000-0000-7000-8000-0000000000c3';
export const MEMBERSHIP_CARLA_SP = '01930000-0000-7000-8000-0000000000c4';
export const MEMBERSHIP_DIEGO_RB = '01930000-0000-7000-8000-0000000000c5';

export const PATIENT_A_JOANA = '01930000-0000-7000-8000-0000000000a8';
export const PATIENT_A_RECEM_NASCIDO = '01930000-0000-7000-8000-0000000000a9';
export const PATIENT_B_MARCOS = '01930000-0000-7000-8000-0000000000b4';

export const PID_A_JOANA_CPF = '01930000-0000-7000-8000-0000000000aa';
export const PID_A_RN_SEM_DOCUMENTO = '01930000-0000-7000-8000-0000000000ab';
export const PID_B_MARCOS_CPF = '01930000-0000-7000-8000-0000000000b5';

export const SHARE_A_JOANA_PARA_BRUNO = '01930000-0000-7000-8000-0000000000ac';
export const SHARE_B_MARCOS_PARA_DIEGO = '01930000-0000-7000-8000-0000000000ad';

/** CPF valido (digitos verificadores corretos) usado nos DOIS tenants de proposito. */
export const CPF_VALIDO = '52998224725';

export const REQUEST_ID = '01930000-0000-7000-8000-0000000000ff';

/** CNPJ alfanumerico da IN RFB 2.229/2024: 12 alfanumericos + 2 digitos. */
export const CNPJ_A = '12ABC345678901';
export const CNPJ_B = '98XYZ765432109';
```

- [ ] **Passo 5: Criar o harness**

Criar `packages/db/test/iso/harness.ts`:

```ts
import { Client } from 'pg';

/**
 * Espelha o tipo Actor de packages/db/src/tx.ts, que so nasce na Task 15.
 * A duplicacao e deliberada: a suite de isolamento tem que existir ANTES da
 * funcao que abre transacao, e os dois tipos sao estruturalmente identicos —
 * na Task 16 os testes passam a importar o Actor de verdade.
 */
export type IsoActor =
  | { kind: 'user'; tenantId: string; userId: string; clinicId: string; requestId: string }
  | { kind: 'system'; tenantId: string; reason: string; requestId: string }
  | { kind: 'anon'; tenantId: string; requestId: string };

export async function openClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * Replica, byte a byte, o preambulo que packages/db/src/tx.ts emite.
 * O terceiro argumento TRUE de set_config e o item mais importante do desenho:
 * torna a variavel LOCAL a transacao. Fora de uma transacao ele nao gruda,
 * por isso todo helper daqui abre BEGIN antes.
 */
export const PREAMBULO_SQL = `
  SELECT set_config('app.tenant_id',  $1, TRUE),
         set_config('app.user_id',    $2, TRUE),
         set_config('app.clinic_id',  $3, TRUE),
         set_config('app.actor_kind', $4, TRUE),
         set_config('app.request_id', $5, TRUE)`;

export async function aplicarPreambulo(client: Client, actor: IsoActor): Promise<void> {
  await client.query(PREAMBULO_SQL, [
    actor.tenantId,
    actor.kind === 'user' ? actor.userId : '',
    actor.kind === 'user' ? actor.clinicId : '',
    actor.kind,
    actor.requestId,
  ]);
}

/**
 * Abre transacao, aplica o preambulo, roda o corpo e SEMPRE faz ROLLBACK.
 * A suite de isolamento nunca deixa rastro: o canario da Task 18 depende disso.
 */
export async function comoAtor<T>(
  client: Client,
  actor: IsoActor,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await aplicarPreambulo(client, actor);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Transacao SEM preambulo nenhum: e o cenario do teste T5. */
export async function semContexto<T>(
  client: Client,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

/**
 * Contexto FORJADO: aceita tenantId e userId que nao combinam entre si.
 * Existe so para o teste T6 — nenhum codigo de producao pode montar isso.
 */
export async function comContextoForjado<T>(
  client: Client,
  ctx: { tenantId: string; userId: string; clinicId: string },
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(PREAMBULO_SQL, [
      ctx.tenantId,
      ctx.userId,
      ctx.clinicId,
      'user',
      '01930000-0000-7000-8000-0000000000ff',
    ]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

export interface ErroPg {
  code: string;
  message: string;
}

/** Executa fn esperando erro do PostgreSQL e devolve SQLSTATE + mensagem. */
export async function erroPg(fn: () => Promise<unknown>): Promise<ErroPg> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? 'sem-sqlstate', message: err.message ?? String(e) };
  }
  throw new Error('esperava erro do PostgreSQL, mas a operacao foi ACEITA');
}
```

- [ ] **Passo 6: Criar o global setup (container + migrations reais)**

Criar `packages/db/test/iso/global-setup.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    isoAdminUrl: string;
    isoApiUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

// packages/db/test/iso/ -> packages/db/migrations/
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function aplicarMigrationsReais(admin: Client): Promise<string[]> {
  const arquivos = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (arquivos.length === 0) {
    throw new Error(`nenhuma migration encontrada em ${MIGRATIONS_DIR}`);
  }
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(MIGRATIONS_DIR, arquivo), 'utf8');
    try {
      await admin.query(sql);
    } catch (e) {
      throw new Error(`migration ${arquivo} falhou: ${(e as Error).message}`);
    }
  }
  return arquivos;
}

export default async function setup({ provide }: GlobalSetupContext) {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('cadencia')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const adminUrl = container.getConnectionUri();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  const aplicadas = await aplicarMigrationsReais(admin);
  // eslint-disable-next-line no-console
  console.log(`[test:iso] migrations aplicadas: ${aplicadas.join(', ')}`);

  // O papel `api` nasce LOGIN sem senha na migration 0001; o container precisa de uma.
  await admin.query(`ALTER ROLE api LOGIN PASSWORD 'api'`);
  await admin.query(`GRANT CONNECT ON DATABASE cadencia TO api`);

  // §3.1 torna `api` NOINHERIT: sem assumir app_rw a conexao nao tem GRANT nenhum e
  // nenhuma policy `TO app_rw` se aplica — tudo daria 42501. `options=-c role=app_rw`
  // faz o proprio servidor entrar em `SET ROLE app_rw` a cada conexao nova, o que vale
  // igualmente para o Client do harness e para o Pool do withTenantTx, sem codigo extra.
  const apiUrl =
    `postgresql://api:api@${container.getHost()}:${container.getPort()}/cadencia` +
    `?options=-c%20role%3Dapp_rw`;

  await admin.end();

  provide('isoAdminUrl', adminUrl);
  provide('isoApiUrl', apiUrl);

  return async () => {
    await container?.stop();
  };
}
```

- [ ] **Passo 7: Criar a configuração dedicada do Vitest**

Criar `vitest.iso.config.ts` na raiz:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'iso',
    include: ['packages/db/test/iso/**/*.iso.test.ts'],
    globalSetup: ['packages/db/test/iso/global-setup.ts'],
    // Um unico container, um arquivo por vez: o canario da Task 18 precisa de
    // uma sequencia deterministica para afirmar que nada do tenant B foi tocado.
    fileParallelism: false,
    sequence: { shuffle: false, concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 240_000,
    teardownTimeout: 60_000,
  },
});
```

- [ ] **Passo 8: Registrar o comando do Apêndice B**

Modificar `package.json`, bloco `"scripts"`, acrescentando a linha:

```json
    "test:iso": "vitest run --config vitest.iso.config.ts"
```

- [ ] **Passo 9: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 3 testes verdes em `00-bootstrap.iso.test.ts`, com a linha `[test:iso] migrations aplicadas: 0001_roles.sql, 0002_transaction_context.sql` no log.

- [ ] **Passo 10: Commitar**

```bash
git add vitest.iso.config.ts package.json pnpm-lock.yaml packages/db/test/iso/fixtures.ts \
        packages/db/test/iso/harness.ts packages/db/test/iso/global-setup.ts \
        packages/db/test/iso/00-bootstrap.iso.test.ts
git commit -m "test(iso): bootstrap the multi-tenant isolation suite on real migrations"
```

---

### Task 8: Migration 0003 — `app.tenant` e `app.clinic`

**Arquivos:**
- Criar: `packages/db/migrations/0003_tenant_clinic.sql`
- Teste: `packages/db/test/iso/01-tenant-clinic.iso.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/test/iso/01-tenant-clinic.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient } from './harness';

// UUIDs proprios desta tarefa: toda insercao aqui roda dentro de BEGIN/ROLLBACK,
// mas ids distintos dos fixtures evitam qualquer acoplamento com o seed.
const T = {
  tenant1: '01930000-0000-7000-8000-00000000f101',
  tenant2: '01930000-0000-7000-8000-00000000f102',
  clinicaSp: '01930000-0000-7000-8000-00000000f103',
  clinicaManaus: '01930000-0000-7000-8000-00000000f104',
};

describe('app.tenant e app.clinic', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  async function emRollback<R>(fn: (c: Client) => Promise<R>): Promise<R> {
    await admin.query('BEGIN');
    try {
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('aceita CNPJ alfanumerico em caixa alta, como manda a IN RFB 2.229/2024', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'aurora-teste', 'Clinica Aurora Ltda', '12ABC345678901')`,
        [T.tenant1],
      );
      const { rows } = await c.query<{ cnpj: string }>(
        'SELECT cnpj FROM app.tenant WHERE id = $1',
        [T.tenant1],
      );
      expect(rows[0]!.cnpj).toBe('12ABC345678901');
    });
  });

  it('recusa CNPJ com pontuacao, como a recepcao digita', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'pontuado', 'Clinica X', '12.345.678/0001')`,
          [T.tenant1],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('recusa CNPJ alfanumerico em caixa baixa', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'minuscula', 'Clinica X', '12abc345678901')`,
          [T.tenant1],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('aceita retencao indefinida (NULL), porque 20 anos e o MINIMO da Lei 13.787/2018', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos)
         VALUES ($1, 'indefinida', 'Clinica Y', '12ABC345678901', NULL)`,
        [T.tenant1],
      );
      const { rows } = await c.query<{ retencao_anos: number | null }>(
        'SELECT retencao_anos FROM app.tenant WHERE id = $1',
        [T.tenant1],
      );
      expect(rows[0]!.retencao_anos).toBeNull();
    });
  });

  it('recusa retencao menor que 20 anos', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos)
           VALUES ($1, 'curta', 'Clinica Z', '12ABC345678901', 19)`,
          [T.tenant1],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('o fuso pertence a CLINICA: a mesma rede tem unidade em Sao Paulo e em Manaus', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'rede', 'Rede Aurora Ltda', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
           ($1, $2, 'Aurora Paulista', '2077485', 'America/Sao_Paulo'),
           ($1, $3, 'Aurora Manaus',   '2077493', 'America/Manaus')`,
        [T.tenant1, T.clinicaSp, T.clinicaManaus],
      );
      const { rows } = await c.query<{ id: string; timezone: string }>(
        'SELECT id, timezone FROM app.clinic WHERE tenant_id = $1 ORDER BY nome',
        [T.tenant1],
      );
      expect(rows.map((r) => r.timezone)).toEqual([
        'America/Manaus',
        'America/Sao_Paulo',
      ]);
    });
  });

  it('clinica sem fuso declarado nasce em America/Sao_Paulo', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'padrao', 'Clinica Padrao', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Unica')`,
        [T.tenant1, T.clinicaSp],
      );
      const { rows } = await c.query<{ timezone: string }>(
        'SELECT timezone FROM app.clinic WHERE id = $1',
        [T.clinicaSp],
      );
      expect(rows[0]!.timezone).toBe('America/Sao_Paulo');
    });
  });

  it('CNES fica NULO ate a clinica informar: nao existe default 9999999', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
         VALUES ($1, 'semcnes', 'Clinica Sem CNES', '12ABC345678901')`,
        [T.tenant1],
      );
      await c.query(
        `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Sem CNES')`,
        [T.tenant1, T.clinicaSp],
      );
      const { rows } = await c.query<{ cnes: string | null }>(
        'SELECT cnes FROM app.clinic WHERE id = $1',
        [T.clinicaSp],
      );
      expect(rows[0]!.cnes).toBeNull();
    });
  });

  it('recusa CNES que nao seja 7 digitos', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
           VALUES ($1, 'cnesruim', 'Clinica W', '12ABC345678901')`,
          [T.tenant1],
        );
        await c.query(
          `INSERT INTO app.clinic (tenant_id, id, nome, cnes)
           VALUES ($1, $2, 'Ruim', 'ABC1234')`,
          [T.tenant1, T.clinicaSp],
        );
      }),
    );
    expect(erro.code).toBe('23514');
  });

  it('app.clinic expoe UNIQUE (tenant_id, id), sem o qual nenhuma FK composta compila', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'app' AND t.relname = 'clinic' AND c.contype = 'u'
          AND (SELECT array_agg(a.attname ORDER BY a.attname)
                 FROM unnest(c.conkey) k(attnum)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
              = ARRAY['id','tenant_id']`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('clinica so existe dentro de um tenant que existe', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO app.clinic (tenant_id, id, nome) VALUES ($1, $2, 'Orfa')`,
          [T.tenant2, T.clinicaSp],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('app.tenant e declarada tenant-root: e a unica tabela cuja coluna de tenant e o proprio id', async () => {
    const { rows } = await admin.query<{ comentario: string | null }>(
      `SELECT obj_description('app.tenant'::regclass, 'pg_class') AS comentario`,
    );
    expect(rows[0]!.comentario).toBe('tenant-root');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA em todos os testes do arquivo com `relation "app.tenant" does not exist` (SQLSTATE `42P01`); o teste da `UNIQUE (tenant_id, id)` falha com `expected 0 to be 1`.

- [ ] **Passo 3: Criar a migration**

Rodar: `pnpm db:new tenant_clinic` — o comando cria `packages/db/migrations/0003_tenant_clinic.sql` vazia. Preencher com exatamente:

```sql
-- 0003_tenant_clinic.sql
-- Fase 0 · design §3.3 — a raiz do isolamento.
-- Schemas, extensoes e GRANT USAGE ja vieram na 0002.
-- RLS, policies e GRANTs de linha entram na 0006. Aqui e so estrutura.

CREATE TABLE app.tenant (
  id uuid PRIMARY KEY, slug citext NOT NULL UNIQUE, razao_social text NOT NULL,
  -- IN RFB 2.229/2024 (desde 01/07/2026): CNPJ e ALFANUMERICO.
  cnpj varchar(14) NOT NULL CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  -- Lei 13.787/2018 art.6 §5: 20 anos e MINIMO. NULL = indefinido. Jamais hard-code 20.
  retencao_anos smallint CHECK (retencao_anos IS NULL OR retencao_anos >= 20),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp());
ALTER TABLE app.tenant OWNER TO app_owner;

-- app.tenant e a UNICA tabela de app/clin/fin/tiss/audit sem coluna tenant_id:
-- o proprio id E o tenant. A excecao e declarada aqui, em migration revisada,
-- e nao num Set editavel dentro de arquivo de teste (§3.13 item 1).
COMMENT ON TABLE app.tenant IS 'tenant-root';

CREATE TABLE app.clinic (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL, nome text NOT NULL,
  cnpj varchar(14) CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes char(7) CHECK (cnes ~ '^[0-9]{7}$'),   -- SEM DEFAULT: dado falso vira lote glosado.
  -- Fuso e da UNIDADE, nao do tenant: rede SP+Manaus e caso real.
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  PRIMARY KEY (id), UNIQUE (tenant_id, id));
ALTER TABLE app.clinic OWNER TO app_owner;

CREATE INDEX ix_clinic_tenant ON app.clinic (tenant_id);
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 12 testes verdes em `01-tenant-clinic.iso.test.ts`, mais os 3 do bootstrap.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/migrations/0003_tenant_clinic.sql \
        packages/db/test/iso/01-tenant-clinic.iso.test.ts
git commit -m "feat(tenancy): add app.tenant and app.clinic with alphanumeric CNPJ and per-clinic timezone"
```

---

### Task 9: Migration 0004 — `id.user`, `app.membership`, `app.professional` e as funções de papel

> **A decisão irreversível nº 3 da spec:** papel é resolvido **por vínculo, por clínica, dentro do banco** — nunca `app.role` escalar vindo do cliente. Papel escalar dá acesso total ou nenhum ao médico que é admin numa unidade e assistente em outra, que é a norma no Brasil.

**Arquivos:**
- Criar: `packages/db/migrations/0004_membership_professional.sql`
- Teste: `packages/db/test/iso/02-vinculo-e-papel.iso.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/test/iso/02-vinculo-e-papel.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient, PREAMBULO_SQL } from './harness';

const T = {
  tenant: '01930000-0000-7000-8000-00000000f201',
  outroTenant: '01930000-0000-7000-8000-00000000f202',
  clinicaSp: '01930000-0000-7000-8000-00000000f203',
  clinicaManaus: '01930000-0000-7000-8000-00000000f204',
  clinicaAlheia: '01930000-0000-7000-8000-00000000f205',
  userAna: '01930000-0000-7000-8000-00000000f206',
  userCarla: '01930000-0000-7000-8000-00000000f207',
  membershipAdminSp: '01930000-0000-7000-8000-00000000f208',
  membershipProfManaus: '01930000-0000-7000-8000-00000000f209',
  membershipRecepSp: '01930000-0000-7000-8000-00000000f20a',
  profAna: '01930000-0000-7000-8000-00000000f20b',
  request: '01930000-0000-7000-8000-00000000f2ff',
};

/**
 * Monta o cenario real: Ana e admin_clinico em Sao Paulo e profissional em Manaus.
 * UMA instrucao por chamada: o driver `pg` recusa varias instrucoes numa unica query
 * com parametros — devolve 42601 "cannot insert multiple commands into a prepared
 * statement", e nenhuma assercao chegaria a rodar.
 */
async function montarCenario(c: Client): Promise<void> {
  await c.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
       ($1, 'rede-f2',  'Rede Aurora Ltda',    '12ABC345678901'),
       ($2, 'outra-f2', 'Clinica Boreal Ltda', '98XYZ765432109')`,
    [T.tenant, T.outroTenant],
  );
  await c.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES
       ($1, $3, 'Aurora Paulista',   'America/Sao_Paulo'),
       ($1, $4, 'Aurora Manaus',     'America/Manaus'),
       ($2, $5, 'Boreal Rio Branco', 'America/Rio_Branco')`,
    [T.tenant, T.outroTenant, T.clinicaSp, T.clinicaManaus, T.clinicaAlheia],
  );
  await c.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ana@aurora.test',   'Ana Ribeiro'),
       ($2, 'carla@aurora.test', 'Carla Nogueira')`,
    [T.userAna, T.userCarla],
  );
  await c.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, $2, $5, $7, 'admin_clinico'),
       ($1, $3, $5, $8, 'profissional'),
       ($1, $4, $6, $7, 'recepcao')`,
    [T.tenant, T.membershipAdminSp, T.membershipProfManaus, T.membershipRecepSp,
     T.userAna, T.userCarla, T.clinicaSp, T.clinicaManaus],
  );
  await c.query(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
     VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
    [T.tenant, T.profAna, T.userAna],
  );
}

describe('vinculo e papel resolvidos dentro do banco', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  /** BEGIN, monta o cenario, aplica preambulo do usuario, roda, ROLLBACK. */
  async function comCenario<R>(
    userId: string,
    clinicId: string,
    fn: (c: Client) => Promise<R>,
  ): Promise<R> {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [
        T.tenant, userId, clinicId, 'user', T.request,
      ]);
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('a mesma medica e admin_clinico em Sao Paulo e apenas profissional em Manaus', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ sp: boolean; manaus: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS sp,
                app.has_role_in($2, ARRAY['admin_clinico']) AS manaus`,
        [T.clinicaSp, T.clinicaManaus],
      );
      expect(rows[0]).toEqual({ sp: true, manaus: false });
    });
  });

  it('app.is_member() e verdadeiro para quem tem vinculo vigente no tenant', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(true);
    });
  });

  it('vinculo revogado deixa de valer no mesmo instante', async () => {
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      await c.query(
        `UPDATE app.membership SET revoked_at = clock_timestamp() WHERE id = $1`,
        [T.membershipRecepSp],
      );
      const { rows } = await c.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    });
  });

  it('usuario sem vinculo nenhum no tenant nao e membro', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [
        T.outroTenant, T.userAna, T.clinicaAlheia, 'user', T.request,
      ]);
      const { rows } = await admin.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('o ator de sistema e membro sem ter user_id, porque worker e outbox precisam gravar', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [T.tenant, '', '', 'system', T.request]);
      const { rows } = await admin.query<{ m: boolean; u: string | null }>(
        'SELECT app.is_member() AS m, app.current_user_id() AS u',
      );
      expect(rows[0]).toEqual({ m: true, u: null });
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('o ator anonimo do agendamento online nao e membro', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [T.tenant, '', '', 'anon', T.request]);
      const { rows } = await admin.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('app.clinical_scope_all() e verdadeiro para admin_clinico e falso para recepcao', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ s: boolean }>(
        'SELECT app.clinical_scope_all() AS s',
      );
      expect(rows[0]!.s).toBe(true);
    });
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ s: boolean }>(
        'SELECT app.clinical_scope_all() AS s',
      );
      expect(rows[0]!.s).toBe(false);
    });
  });

  it('app.current_professional_id() deriva do vinculo, nunca do cliente', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ p: string | null }>(
        'SELECT app.current_professional_id() AS p',
      );
      expect(rows[0]!.p).toBe(T.profAna);
    });
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ p: string | null }>(
        'SELECT app.current_professional_id() AS p',
      );
      expect(rows[0]!.p).toBeNull(); // recepcao nao e profissional
    });
  });

  it('recusa papel que nao esta no catalogo do banco', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'superusuario')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2aa', T.userCarla, T.clinicaManaus],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23514');
  });

  it('vinculo nao aponta para clinica de outro tenant: e erro de integridade, nao leitura vazia', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'profissional')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2ab', T.userAna, T.clinicaAlheia],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23503');
  });

  it('o mesmo papel na mesma clinica nao pode ser concedido duas vezes enquanto vigente', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'admin_clinico')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2ac', T.userAna, T.clinicaSp],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23505');
  });

  it('id.user e global e declarada como referencia global, sem tenant_id', async () => {
    const { rows } = await admin.query<{ comentario: string | null; cols: number }>(
      `SELECT obj_description('id.user'::regclass, 'pg_class') AS comentario,
              (SELECT count(*)::int FROM pg_attribute a
                WHERE a.attrelid = 'id.user'::regclass
                  AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS cols`,
    );
    expect(rows[0]!.comentario).toBe('global-reference');
    expect(rows[0]!.cols).toBe(0);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA com `relation "id.user" does not exist` (SQLSTATE `42P01`) e, nos testes de função, `function app.has_role_in(uuid, text[]) does not exist` (`42883`).

- [ ] **Passo 3: Criar a migration**

Rodar: `pnpm db:new membership_professional` — cria `packages/db/migrations/0004_membership_professional.sql`. Preencher com exatamente:

```sql
-- 0004_membership_professional.sql
-- Fase 0 · design §3.2, §3.3 e decisao irreversivel §10 itens 2 e 3.
-- Papel e profissional NAO vem do cliente: sao DERIVADOS do vinculo, no banco.

-- §10.2: identidade GLOBAL, sem tenant_id. O medico tem UM certificado ICP-Brasil,
-- logo UMA identidade. Os modulos authn/identity ESTENDEM esta tabela (credencial,
-- TOTP, dispositivo, autorizacao PSC) por migration de expansao, nunca a recriam.
CREATE TABLE id."user" (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  full_name text NOT NULL,
  disabled_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp());
ALTER TABLE id."user" OWNER TO app_owner;
COMMENT ON TABLE id."user" IS 'global-reference';

-- §10.3: papel resolvido POR VINCULO, por clinica, dentro do banco.
CREATE TABLE app.membership (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES id."user"(id),
  clinic_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN
    ('admin_clinico','diretor_tecnico','profissional','recepcao','financeiro')),
  granted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, clinic_id) REFERENCES app.clinic(tenant_id, id));
ALTER TABLE app.membership OWNER TO app_owner;

CREATE UNIQUE INDEX ux_membership_vigente
  ON app.membership (tenant_id, user_id, clinic_id, role) WHERE revoked_at IS NULL;
CREATE INDEX ix_membership_lookup
  ON app.membership (tenant_id, user_id) WHERE revoked_at IS NULL;

-- conselho_profissional / numero_conselho / uf_conselho / cbos tem exatamente os
-- mesmos tipos dos campos homonimos da guia TISS (§3.9): a guia e projecao, nao
-- pode precisar converter nada. conselho_profissional guarda o CODIGO do conselho
-- na terminologia TISS (ex.: '06' = CRM), nunca a sigla por extenso.
CREATE TABLE app.professional (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id() REFERENCES app.tenant(id),
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES id."user"(id),
  conselho_profissional varchar(2) NOT NULL,
  numero_conselho varchar(15) NOT NULL,
  uf_conselho char(2) NOT NULL CHECK (uf_conselho ~ '^[A-Z]{2}$'),
  cbos varchar(6),
  inactivated_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  -- app.current_professional_id() devolve UMA linha: a unicidade e obrigatoria.
  UNIQUE (tenant_id, user_id));
ALTER TABLE app.professional OWNER TO app_owner;

CREATE INDEX ix_professional_user ON app.professional (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- Funcoes de derivacao. Moram aqui, e nao na 0002, porque leem app.membership
-- e app.professional — que so existem a partir desta migration.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.current_professional_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p.id FROM app.professional p
   WHERE p.tenant_id = app.current_tenant_id() AND p.user_id = app.current_user_id() $$;

CREATE FUNCTION app.has_role_in(p_clinic uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.tenant_id = app.current_tenant_id()
                    AND m.user_id = app.current_user_id()
                    AND m.clinic_id = p_clinic AND m.role = ANY(p_roles)
                    AND m.revoked_at IS NULL) $$;

CREATE FUNCTION app.is_member() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id = app.current_user_id()
                    AND m.tenant_id = app.current_tenant_id() AND m.revoked_at IS NULL)
      OR app.current_user_id() IS NULL AND current_setting('app.actor_kind',true)='system' $$;

CREATE FUNCTION app.clinical_scope_all() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m
                  WHERE m.user_id=app.current_user_id() AND m.tenant_id=app.current_tenant_id()
                    AND m.role IN ('admin_clinico','diretor_tecnico') AND m.revoked_at IS NULL) $$;

ALTER FUNCTION app.current_professional_id()   OWNER TO app_owner;
ALTER FUNCTION app.has_role_in(uuid, text[])   OWNER TO app_owner;
ALTER FUNCTION app.is_member()                 OWNER TO app_owner;
ALTER FUNCTION app.clinical_scope_all()        OWNER TO app_owner;

GRANT EXECUTE ON FUNCTION
  app.current_professional_id(),
  app.has_role_in(uuid, text[]),
  app.is_member(),
  app.clinical_scope_all()
TO app_rw;
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 12 testes verdes em `02-vinculo-e-papel.iso.test.ts`.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/migrations/0004_membership_professional.sql \
        packages/db/test/iso/02-vinculo-e-papel.iso.test.ts
git commit -m "feat(identity): resolve role per membership per clinic inside the database"
```

---
### Task 10: Migration 0005 — `clin.patient` e `clin.patient_identifier`

> **Decisão irreversível nº 9:** identificador de paciente é **tabela**, com CPF **opcional**. Recém-nascido, estrangeiro e paciente inconsciente não podem forçar a recepção a inventar CPF — dado inventado contamina gráfico e guia para sempre.

**Arquivos:**
- Criar: `packages/db/migrations/0005_patient.sql`
- Teste: `packages/db/test/iso/03-paciente.iso.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/test/iso/03-paciente.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient } from './harness';

const T = {
  tenantA: '01930000-0000-7000-8000-00000000f301',
  tenantB: '01930000-0000-7000-8000-00000000f302',
  joana: '01930000-0000-7000-8000-00000000f303',
  recemNascido: '01930000-0000-7000-8000-00000000f304',
  outroSemDoc: '01930000-0000-7000-8000-00000000f305',
  marcosNoB: '01930000-0000-7000-8000-00000000f306',
  pid1: '01930000-0000-7000-8000-00000000f307',
  pid2: '01930000-0000-7000-8000-00000000f308',
  pid3: '01930000-0000-7000-8000-00000000f309',
  pid4: '01930000-0000-7000-8000-00000000f30a',
};

const CPF = '52998224725';

const CENARIO = `
  INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
    ($1, 'aurora-f3', 'Clinica Aurora Ltda', '12ABC345678901'),
    ($2, 'boreal-f3', 'Clinica Boreal Ltda', '98XYZ765432109')`;

describe('clin.patient e clin.patient_identifier', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  async function emRollback<R>(fn: (c: Client) => Promise<R>): Promise<R> {
    await admin.query('BEGIN');
    try {
      await admin.query(CENARIO, [T.tenantA, T.tenantB]);
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('recem-nascido entra sem data de nascimento e com cadastro preliminar', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, sex_at_birth)
         VALUES ($1, $2, 'RN de Joana Ferreira', 'F')`,
        [T.tenantA, T.recemNascido],
      );
      const { rows } = await c.query<{
        birth_date: string | null;
        cadastro_status: string;
      }>(
        'SELECT birth_date, cadastro_status FROM clin.patient WHERE id = $1',
        [T.recemNascido],
      );
      expect(rows[0]!.birth_date).toBeNull();
      expect(rows[0]!.cadastro_status).toBe('preliminar');
    });
  });

  it('dois pacientes SEM_DOCUMENTO convivem: o indice de unicidade os ignora', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $2, 'RN de Joana Ferreira'),
           ($1, $3, 'Homem nao identificado - triagem')`,
        [T.tenantA, T.recemNascido, T.outroSemDoc],
      );
      await c.query(
        `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
           ($1, $2, $4, 'SEM_DOCUMENTO', 'sem documento apresentado'),
           ($1, $3, $5, 'SEM_DOCUMENTO', 'sem documento apresentado')`,
        [T.tenantA, T.pid1, T.pid2, T.recemNascido, T.outroSemDoc],
      );
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient_identifier
          WHERE tenant_id = $1 AND kind = 'SEM_DOCUMENTO'`,
        [T.tenantA],
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('o mesmo CPF nao pode ser cadastrado duas vezes na mesma clinica', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
             ($1, $2, 'Joana Ferreira da Silva'),
             ($1, $3, 'Joana F. da Silva')`,
          [T.tenantA, T.joana, T.outroSemDoc],
        );
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
             ($1, $2, $4, 'CPF', $6),
             ($1, $3, $5, 'CPF', $6)`,
          [T.tenantA, T.pid1, T.pid2, T.joana, T.outroSemDoc, CPF],
        );
      }),
    );
    expect(erro.code).toBe('23505');
  });

  it('o mesmo CPF existe em clinicas diferentes sem conflito: unicidade e por tenant', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $3, 'Joana Ferreira da Silva'),
           ($2, $4, 'Joana Ferreira da Silva')`,
        [T.tenantA, T.tenantB, T.joana, T.marcosNoB],
      );
      await c.query(
        `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
           ($1, $3, $5, 'CPF', $7),
           ($2, $4, $6, 'CPF', $7)`,
        [T.tenantA, T.tenantB, T.pid3, T.pid4, T.joana, T.marcosNoB, CPF],
      );
      // Filtra pelos tenants DESTE teste: o seed global grava o mesmo CPF em dois
      // outros tenants, e uma contagem sem filtro passaria a devolver 4.
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient_identifier
          WHERE value = $1 AND tenant_id IN ($2, $3)`,
        [CPF, T.tenantA, T.tenantB],
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('o nome social lidera a busca, sem acento e em caixa baixa (Decreto 8.727/2016)', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, nome_social)
         VALUES ($1, $2, 'João Ferreira da Conceição', 'Joana Ferreira da Conceição')`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ search_name: string }>(
        'SELECT search_name FROM clin.patient WHERE id = $1',
        [T.joana],
      );
      expect(rows[0]!.search_name).toBe('joana ferreira da conceicao');
    });
  });

  it('sem nome social, a busca usa o nome civil sem acento, til nem cedilha', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name)
         VALUES ($1, $2, 'Antônio José Gonçalves de Assunção')`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ search_name: string }>(
        'SELECT search_name FROM clin.patient WHERE id = $1',
        [T.joana],
      );
      expect(rows[0]!.search_name).toBe('antonio jose goncalves de assuncao');
    });
  });

  it('recusa cadastro_status fora de preliminar/completo', async () => {
    const erro = await erroPg(() =>
      emRollback((c) =>
        c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
           VALUES ($1, $2, 'Fulano', 'rascunho')`,
          [T.tenantA, T.joana],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
  });

  it('recusa tipo de identificador fora do catalogo', async () => {
    const erro = await erroPg(() =>
      emRollback(async (c) => {
        await c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES ($1, $2, 'Fulano')`,
          [T.tenantA, T.joana],
        );
        await c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, $2, $3, 'TITULO_ELEITOR', '123')`,
          [T.tenantA, T.pid1, T.joana],
        );
      }),
    );
    expect(erro.code).toBe('23514');
  });

  it('guarda a recusa de IA no nivel do titular (CFM 2.454/2026)', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, ai_refused_at)
         VALUES ($1, $2, 'Joana Ferreira da Silva', clock_timestamp())`,
        [T.tenantA, T.joana],
      );
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM clin.patient
          WHERE id = $1 AND ai_refused_at IS NOT NULL`,
        [T.joana],
      );
      expect(rows[0]!.n).toBe(1);
    });
  });

  it('unificacao marca o duplicado e nao troca o dado de nenhuma das duas linhas', async () => {
    await emRollback(async (c) => {
      await c.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES
           ($1, $2, 'Joana Ferreira da Silva'),
           ($1, $3, 'Joana F. da Silva')`,
        [T.tenantA, T.joana, T.outroSemDoc],
      );
      await c.query(
        'UPDATE clin.patient SET merged_into_id = $1 WHERE id = $2',
        [T.joana, T.outroSemDoc],
      );
      const { rows } = await c.query<{
        id: string;
        full_name: string;
        merged_into_id: string | null;
      }>(
        `SELECT id, full_name, merged_into_id FROM clin.patient
          WHERE tenant_id = $1 ORDER BY full_name`,
        [T.tenantA],
      );
      // O duplicado aponta para o sobrevivente e MANTEM o proprio nome; o sobrevivente
      // nao ganha ponteiro nenhum. Decisao irreversivel n. 9: unificar nunca reescreve
      // o conteudo de uma linha com o conteudo da outra.
      expect(rows).toEqual([
        { id: T.outroSemDoc, full_name: 'Joana F. da Silva', merged_into_id: T.joana },
        { id: T.joana, full_name: 'Joana Ferreira da Silva', merged_into_id: null },
      ]);
    });
  });

  it('o indice de busca e GIN liderado por tenant_id, senao uma clinica paga o crescimento das outras', async () => {
    const { rows } = await admin.query<{ metodo: string; primeira: string }>(
      `SELECT am.amname AS metodo,
              (SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) AS primeira
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_am am ON am.oid = ic.relam
        WHERE ic.relname = 'ix_patient_busca'`,
    );
    expect(rows[0]).toEqual({ metodo: 'gin', primeira: 'tenant_id' });
  });

  it('o indice de digitos tambem e liderado por tenant_id', async () => {
    const { rows } = await admin.query<{ primeira: string }>(
      `SELECT (SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) AS primeira
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE ic.relname = 'ix_patient_digits'`,
    );
    expect(rows[0]!.primeira).toBe('tenant_id');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA com `relation "clin.patient" does not exist` (SQLSTATE `42P01`); os dois últimos testes falham com `expected undefined to equal ...` porque os índices ainda não existem.

- [ ] **Passo 3: Criar a migration**

Rodar: `pnpm db:new patient` — cria `packages/db/migrations/0005_patient.sql`. Preencher com exatamente:

```sql
-- 0005_patient.sql
-- Fase 0 · design §3.3 e decisao irreversivel §10 item 9.

-- unaccent(text) e apenas STABLE; coluna GENERATED exige IMMUTABLE.
-- Fixar o dicionario torna a funcao imutavel de verdade.
CREATE FUNCTION app.imm_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
ALTER FUNCTION app.imm_unaccent(text) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.imm_unaccent(text) TO app_rw;

CREATE TABLE clin.patient (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL,
  full_name text NOT NULL,
  nome_social text,                       -- Decreto 8.727/2016: usado em TODA exibicao
  identidade_genero text,                 -- separado de sexo ao nascer
  birth_date date,                        -- NULLABLE: ver cadastro preliminar
  sex_at_birth char(1) CHECK (sex_at_birth IN ('M','F','I')),
  phone_primary varchar(20), email citext,
  cadastro_status text NOT NULL DEFAULT 'preliminar'
    CHECK (cadastro_status IN ('preliminar','completo')),
  deceased_at date, inactivated_at timestamptz(3),
  ai_refused_at timestamptz(3),           -- CFM 2.454/2026, no nivel do titular
  merged_into_id uuid,                    -- unificacao: aponta para o sobrevivente
  search_name text GENERATED ALWAYS AS (app.imm_unaccent(lower(
      coalesce(nome_social, full_name)))) STORED,
  search_digits text,                     -- so digitos: CPF, telefone (normalizado na app)
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES clin.patient(tenant_id, id));
ALTER TABLE clin.patient OWNER TO app_owner;

-- CPF e UM identificador entre varios, nao O identificador.
CREATE TABLE clin.patient_identifier (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL, patient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CPF','CNS','DNV','PASSAPORTE','RG','CARTEIRINHA','SEM_DOCUMENTO')),
  value text NOT NULL, issuer text,
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id,id));
ALTER TABLE clin.patient_identifier OWNER TO app_owner;

CREATE UNIQUE INDEX ux_pid ON clin.patient_identifier (tenant_id, kind, value)
  WHERE kind <> 'SEM_DOCUMENTO';
CREATE INDEX ix_patient_busca ON clin.patient USING gin (tenant_id, search_name gin_trgm_ops);
CREATE INDEX ix_patient_digits ON clin.patient (tenant_id, search_digits varchar_pattern_ops);
CREATE INDEX ix_patient_identifier_paciente
  ON clin.patient_identifier (tenant_id, patient_id);
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 12 testes verdes em `03-paciente.iso.test.ts`.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/migrations/0005_patient.sql packages/db/test/iso/03-paciente.iso.test.ts
git commit -m "feat(patients): add clin.patient and clin.patient_identifier with optional CPF and social name"
```

---

### Task 11: Migration 0006 — RLS `PERMISSIVE tenant_isolation`, GRANTs e os testes T1 e T2

> **A assimetria é deliberada:** leitura **falha fechada em silêncio** (`app.current_tenant_id()` devolve NULL → zero linhas, e zero linha é sempre seguro); escrita **falha alto** (`app.require_tenant_id()` levanta `42501` → o bug aparece no Sentry). E `app.is_member()` fecha o buraco que a RLS sozinha não fecha: RLS protege contra `WHERE` esquecido, **não** contra contexto forjado.
>
> **Armadilha que este passo evita e que custa uma tarde se descoberta em produção:** a policy de `app.membership` **não pode** chamar `app.is_member()` — `is_member()` lê `app.membership`, e o PostgreSQL aborta com `infinite recursion detected in policy for relation "membership"`. `app.membership` é a raiz da confiança: a policy dela é auto-referente por `user_id`, e é isso que também a torna imune ao contexto forjado.

**Arquivos:**
- Criar: `packages/db/migrations/0006_rls_tenant_isolation.sql`
- Criar: `packages/db/test/iso/seed.ts`
- Modificar: `packages/db/test/iso/global-setup.ts` (chamar o seed depois das migrations)
- Teste: `packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts`

- [ ] **Passo 1: Escrever o seed dos dois tenants**

Criar `packages/db/test/iso/seed.ts`:

```ts
import type { Client } from 'pg';
import * as F from './fixtures';

/**
 * Dois tenants reais e conflitantes de proposito:
 * - Aurora (A): rede com unidade em Sao Paulo e em Manaus. Ana e admin_clinico em
 *   SP e apenas profissional em Manaus. Carla e recepcao (nao e profissional).
 * - Boreal (B): unidade em Rio Branco, com o MESMO CPF cadastrado que o tenant A.
 * Roda como superusuario, antes de qualquer teste, uma unica vez.
 */
export async function seedDoisTenants(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj, retencao_anos) VALUES
       ($1, 'aurora', 'Clinica Aurora Ltda', $3, NULL),
       ($2, 'boreal', 'Clinica Boreal Ltda', $4, 25)`,
    [F.TENANT_A, F.TENANT_B, F.CNPJ_A, F.CNPJ_B],
  );

  await admin.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone) VALUES
       ($1, $3, 'Aurora Paulista',   '2077485', 'America/Sao_Paulo'),
       ($1, $4, 'Aurora Manaus',     '2077493', 'America/Manaus'),
       ($2, $5, 'Boreal Rio Branco', '2077507', 'America/Rio_Branco')`,
    [F.TENANT_A, F.TENANT_B, F.CLINIC_A_SP, F.CLINIC_A_MANAUS, F.CLINIC_B_RIO_BRANCO],
  );

  await admin.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ana.medica@aurora.test',    'Ana Ribeiro'),
       ($2, 'bruno.medico@aurora.test',  'Bruno Tavares'),
       ($3, 'carla.recepcao@aurora.test','Carla Nogueira'),
       ($4, 'diego.medico@boreal.test',  'Diego Sales')`,
    [F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA, F.USER_B_DIEGO],
  );

  await admin.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, $6,  $3, $8,  'admin_clinico'),
       ($1, $7,  $3, $9,  'profissional'),
       ($1, $10, $4, $8,  'profissional'),
       ($1, $11, $5, $8,  'recepcao'),
       ($2, $12, $13, $14,'admin_clinico')`,
    [
      F.TENANT_A, F.TENANT_B, F.USER_A_ANA, F.USER_A_BRUNO, F.USER_A_CARLA,
      F.MEMBERSHIP_ANA_SP, F.MEMBERSHIP_ANA_MANAUS, F.CLINIC_A_SP, F.CLINIC_A_MANAUS,
      F.MEMBERSHIP_BRUNO_SP, F.MEMBERSHIP_CARLA_SP, F.MEMBERSHIP_DIEGO_RB,
      F.USER_B_DIEGO, F.CLINIC_B_RIO_BRANCO,
    ],
  );

  await admin.query(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos) VALUES
       ($1, $3, $5, '06', '123456', 'SP', '225125'),
       ($1, $4, $6, '06', '654321', 'AM', '225125'),
       ($2, $7, $8, '06', '111222', 'AC', '225125')`,
    [
      F.TENANT_A, F.TENANT_B, F.PROF_A_ANA, F.PROF_A_BRUNO, F.USER_A_ANA,
      F.USER_A_BRUNO, F.PROF_B_DIEGO, F.USER_B_DIEGO,
    ],
  );

  await admin.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name, nome_social, birth_date,
                               cadastro_status, search_digits) VALUES
       ($1, $3, 'Joao Ferreira da Silva', 'Joana Ferreira da Silva', '1988-03-14',
            'completo', $6),
       ($1, $4, 'RN de Joana Ferreira', NULL, NULL, 'preliminar', NULL),
       ($2, $5, 'Marcos Andrade Lima', NULL, '1975-11-02', 'completo', $6)`,
    [F.TENANT_A, F.TENANT_B, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );

  await admin.query(
    `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value) VALUES
       ($1, $3, $6, 'CPF', $9),
       ($1, $4, $7, 'SEM_DOCUMENTO', 'sem documento apresentado'),
       ($2, $5, $8, 'CPF', $9)`,
    [F.TENANT_A, F.TENANT_B, F.PID_A_JOANA_CPF, F.PID_A_RN_SEM_DOCUMENTO,
     F.PID_B_MARCOS_CPF, F.PATIENT_A_JOANA, F.PATIENT_A_RECEM_NASCIDO,
     F.PATIENT_B_MARCOS, F.CPF_VALIDO],
  );
}
```

- [ ] **Passo 2: Chamar o seed no global setup**

Modificar `packages/db/test/iso/global-setup.ts`. Acrescentar o import no topo, logo depois do import do `PostgreSqlContainer`:

```ts
import { seedDoisTenants } from './seed';
```

E, dentro de `setup`, acrescentar a chamada logo depois do `console.log` das migrations aplicadas:

```ts
  await seedDoisTenants(admin);
```

- [ ] **Passo 3: Escrever o teste que falha (T1 e T2)**

Criar `packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

interface Tabela {
  nsp: string;
  rel: string;
}

describe('T1 e T2 — isolamento de leitura e de escrita entre tenants', () => {
  let admin: Client;
  let api: Client;
  let tabelas: Tabela[];

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));

    // T1 nao usa lista manual: as tabelas sao DESCOBERTAS do catalogo do Postgres.
    // Uma tabela nova criada em Fase 1 sem isolamento reprova aqui sozinha.
    const { rows } = await admin.query<Tabela>(
      `SELECT n.nspname AS nsp, c.relname AS rel
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app','clin','fin','tiss','audit')
          AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
    );
    tabelas = rows;
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('descobre pelo menos as cinco tabelas multi-tenant da Fase 0', () => {
    const nomes = tabelas.map((t) => `${t.nsp}.${t.rel}`);
    expect(nomes).toEqual(
      expect.arrayContaining([
        'app.clinic',
        'app.membership',
        'app.professional',
        'clin.patient',
        'clin.patient_identifier',
      ]),
    );
  });

  it('o seed realmente criou linha do tenant B em toda tabela multi-tenant, senao T1 passaria a toa', async () => {
    for (const { nsp, rel } of tabelas) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${nsp}"."${rel}" WHERE tenant_id = $1`,
        [F.TENANT_B],
      );
      expect(rows[0]!.n, `${nsp}.${rel} nao tem linha do tenant B no seed`)
        .toBeGreaterThan(0);
    }
  });

  it('T1 — o tenant A nao le nenhuma linha do tenant B, tabela a tabela', async () => {
    await comoAtor(api, ANA, async (c) => {
      for (const { nsp, rel } of tabelas) {
        const { rows } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${nsp}"."${rel}" WHERE tenant_id = $1`,
          [F.TENANT_B],
        );
        expect(rows[0]!.n, `${nsp}.${rel} VAZOU linha do tenant B`).toBe(0);
      }
    });
  });

  it('T1 — e continua lendo normalmente as linhas do proprio tenant', async () => {
    await comoAtor(api, ANA, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient',
      );
      expect(rows[0]!.n).toBe(2);
    });
  });

  it('T1 — app.tenant tambem isola, apesar de a coluna de tenant chamar-se id', async () => {
    await comoAtor(api, ANA, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM app.tenant');
      expect(rows.map((r) => r.id)).toEqual([F.TENANT_A]);
    });
  });

  it('T2 — INSERT carimbado com o tenant_id de outra clinica e recusado', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.patient (tenant_id, id, full_name)
           VALUES ($1, $2, 'Paciente plantado no tenant alheio')`,
          [F.TENANT_B, '01930000-0000-7000-8000-00000000f401'],
        ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('row-level security policy');
  });

  it('T2 — INSERT sem informar tenant_id herda o tenant do contexto, nunca o do payload', async () => {
    await comoAtor(api, ANA, async (c) => {
      await c.query(
        `INSERT INTO clin.patient (id, full_name) VALUES ($1, 'Paciente novo da Aurora')`,
        ['01930000-0000-7000-8000-00000000f402'],
      );
      const { rows } = await c.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM clin.patient WHERE id = $1',
        ['01930000-0000-7000-8000-00000000f402'],
      );
      expect(rows[0]!.tenant_id).toBe(F.TENANT_A);
    });
  });

  it('a aplicacao nao e dona de nenhuma relacao, logo nao consegue desligar a RLS', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname IN ('app','clin','id') AND r.rolname = 'api'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('toda tabela multi-tenant tem RLS habilitada, FORCADA e pelo menos uma policy', async () => {
    for (const { nsp, rel } of tabelas) {
      const { rows } = await admin.query<{
        rls: boolean;
        force: boolean;
        policies: number;
      }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2`,
        [nsp, rel],
      );
      expect(rows[0], `${nsp}.${rel} sem RLS forcada ou sem policy`).toMatchObject({
        rls: true,
        force: true,
      });
      expect(rows[0]!.policies).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] **Passo 4: Rodar e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA — `T1` acusa `clin.patient VAZOU linha do tenant B: expected 1 to be 0` e `T2` falha com `esperava erro do PostgreSQL, mas a operacao foi ACEITA`. Antes disso, o próprio `api` pode falhar com `permission denied for table patient` (`42501`) porque ainda não há GRANT — a ausência de GRANT também é falha esperada neste passo.

- [ ] **Passo 5: Criar a migration**

Rodar: `pnpm db:new rls_tenant_isolation` — cria `packages/db/migrations/0006_rls_tenant_isolation.sql`. Preencher com exatamente:

```sql
-- 0006_rls_tenant_isolation.sql
-- Fase 0 · design §3.3 — a policy PERMISSIVE e os GRANTs, tabela a tabela.
--
-- §3.13 item 7: privilegio e AFIRMADO tabela a tabela. ALTER DEFAULT PRIVILEGES
-- nao substitui a assercao: tabela nova com policy correta e sem GRANT da 500
-- na primeira recepcionista as 8h, e o alarme global de rollback nao dispara.

GRANT SELECT                          ON app.tenant       TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.clinic       TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.membership   TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON app.professional TO app_rw;
GRANT SELECT                          ON id."user"        TO app_rw;
GRANT SELECT, INSERT, UPDATE          ON clin.patient     TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE  ON clin.patient_identifier TO app_rw;
-- clin.patient nao recebe DELETE: paciente sai de circulacao por inactivated_at.

-- ---------------------------------------------------------------------------
-- app.tenant — a coluna de tenant e o proprio id.
-- ---------------------------------------------------------------------------
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.tenant AS PERMISSIVE FOR ALL TO app_rw
  USING      (id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- app.membership — RAIZ DA CONFIANCA.
-- A policy NAO pode chamar app.is_member(): is_member() le esta tabela, e o
-- planejador aborta com "infinite recursion detected in policy for relation".
-- A protecao equivalente vem do proprio predicado: so o dono do vinculo le o
-- vinculo. Um contexto forjado (tenant B com user A) nao encontra linha nenhuma,
-- e por isso app.is_member() devolve false — que e exatamente o teste T6.
-- Listar a equipe (visao de admin) e Fase 1, por funcao SECURITY DEFINER propria.
-- WITH CHECK nao restringe user_id porque o onboarding cria vinculo de terceiros;
-- por isso o INSERT de vinculo alheio nao pode usar RETURNING.
-- ---------------------------------------------------------------------------
ALTER TABLE app.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.membership AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.require_tenant_id());

-- ---------------------------------------------------------------------------
-- Demais tabelas: o padrao literal da §3.3.
-- ---------------------------------------------------------------------------
ALTER TABLE app.clinic ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinic FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.clinic AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE app.professional ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.professional FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.professional AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE clin.patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.patient AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())   -- 0 linhas se ausente
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());  -- excecao se ausente

ALTER TABLE clin.patient_identifier ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.patient_identifier FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.patient_identifier AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
```

- [ ] **Passo 6: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 9 testes verdes em `04-t1-t2-isolamento.iso.test.ts`.

- [ ] **Passo 7: Commitar**

```bash
git add packages/db/migrations/0006_rls_tenant_isolation.sql packages/db/test/iso/seed.ts \
        packages/db/test/iso/global-setup.ts \
        packages/db/test/iso/04-t1-t2-isolamento.iso.test.ts
git commit -m "feat(db): enforce forced RLS tenant_isolation with membership check on core tables"
```

---

### Task 12: Migration 0007 — `clin.record_share` e a policy `RESTRICTIVE` de escopo clínico

> **Por que uma segunda camada.** Policies `RESTRICTIVE` fazem `AND` com as permissivas: uma policy nova **nunca** "abre" acesso. Sem ela, o controle de compartilhamento é contornável escolhendo outra tabela.
>
> **Onde ela entra na Fase 0.** O invariante de CI é: *toda tabela em `clin.*` com coluna `patient_id` ou `version_id` tem ao menos uma policy `RESTRICTIVE`*. Na Fase 0 existem duas: `clin.patient_identifier` e a `clin.record_share` criada aqui. `clin.patient` **não** entra — ela tem `id`, não `patient_id`, e isso é a decisão irreversível nº 18 escrita em SQL: **Paciente é cadastro, Prontuário é escopo restrito.** A recepção precisa achar o paciente; ninguém além do escopo precisa dos identificadores.
>
> Na Fase 1, quando `clin.encounter` existir, a mesma policy ganha o ramo `professional_id = app.current_professional_id()` na tabela de atendimento. Aqui ela já nasce com os dois ramos que existem: papel de escopo total e compartilhamento explícito.

**Arquivos:**
- Criar: `packages/db/migrations/0007_rls_clinical_scope.sql`
- Modificar: `packages/db/test/iso/seed.ts` (acrescentar os compartilhamentos)
- Teste: `packages/db/test/iso/05-escopo-clinico.iso.test.ts`

- [ ] **Passo 1: Acrescentar o compartilhamento ao seed**

Modificar `packages/db/test/iso/seed.ts`. Ao final da função `seedDoisTenants`, logo após o `INSERT INTO clin.patient_identifier`, acrescentar:

```ts
  // Bruno nao e admin: so enxerga identificador de paciente compartilhado com ele.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $5, 'segunda opiniao solicitada pela paciente')`,
    [F.TENANT_A, F.SHARE_A_JOANA_PARA_BRUNO, F.PATIENT_A_JOANA,
     F.PROF_A_BRUNO, F.PROF_A_ANA],
  );

  // O tenant B PRECISA de linha aqui tambem: o teste "o seed realmente criou linha do
  // tenant B em toda tabela multi-tenant" descobre as tabelas do catalogo, e sem esta
  // linha o T1 passaria a toa em clin.record_share — nao ha o que vazar.
  await admin.query(
    `INSERT INTO clin.record_share
       (tenant_id, id, patient_id, grantee_professional_id,
        granted_by_professional_id, reason) VALUES
       ($1, $2, $3, $4, $4, 'acompanhamento proprio na unidade de Rio Branco')`,
    [F.TENANT_B, F.SHARE_B_MARCOS_PARA_DIEGO, F.PATIENT_B_MARCOS, F.PROF_B_DIEGO],
  );
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `packages/db/test/iso/05-escopo-clinico.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA_ADMIN: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const BRUNO_PROFISSIONAL: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_BRUNO,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const CARLA_RECEPCAO: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_CARLA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

async function identificadoresVisiveis(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ patient_id: string }>(
    'SELECT patient_id FROM clin.patient_identifier ORDER BY patient_id',
  );
  return rows.map((r) => r.patient_id);
}

describe('policy RESTRICTIVE de escopo clinico', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('admin_clinico enxerga os identificadores de toda a clinica', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      const vistos = await identificadoresVisiveis(c);
      expect(vistos).toHaveLength(2);
      expect(vistos).toContain(F.PATIENT_A_JOANA);
      expect(vistos).toContain(F.PATIENT_A_RECEM_NASCIDO);
    });
  });

  it('a recepcao enxerga os identificadores, porque cobrar exige o CPF', async () => {
    await comoAtor(api, CARLA_RECEPCAO, async (c) => {
      expect(await identificadoresVisiveis(c)).toHaveLength(2);
    });
  });

  it('profissional sem escopo total so enxerga o paciente compartilhado com ele', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      expect(await identificadoresVisiveis(c)).toEqual([F.PATIENT_A_JOANA]);
    });
  });

  it('revogar o compartilhamento tira o acesso no mesmo instante', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      await c.query(
        'UPDATE clin.record_share SET revoked_at = clock_timestamp() WHERE id = $1',
        [F.SHARE_A_JOANA_PARA_BRUNO],
      );
      await c.query(`SELECT set_config('app.user_id', $1, TRUE)`, [F.USER_A_BRUNO]);
      expect(await identificadoresVisiveis(c)).toEqual([]);
    });
  });

  it('a policy RESTRICTIVE nao abre acesso: o profissional continua sem ver outro tenant', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient_identifier WHERE tenant_id = $1',
        [F.TENANT_B],
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('profissional so enxerga compartilhamento em que ele e parte', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM clin.record_share',
      );
      expect(rows.map((r) => r.id)).toEqual([F.SHARE_A_JOANA_PARA_BRUNO]);
    });
  });

  it('toda tabela clin.* com patient_id ou version_id tem policy RESTRICTIVE', async () => {
    const admin = await openClient(inject('isoAdminUrl'));
    try {
      const { rows } = await admin.query<{ rel: string; restritivas: number }>(
        `SELECT c.relname AS rel,
                (SELECT count(*)::int FROM pg_policy p
                  WHERE p.polrelid = c.oid AND NOT p.polpermissive) AS restritivas
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'clin' AND c.relkind IN ('r','p')
            AND EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND NOT a.attisdropped
                           AND a.attname IN ('patient_id','version_id'))
          ORDER BY 1`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const linha of rows) {
        expect(linha.restritivas, `clin.${linha.rel} sem policy RESTRICTIVE`)
          .toBeGreaterThanOrEqual(1);
      }
    } finally {
      await admin.end();
    }
  });
});
```

- [ ] **Passo 3: Rodar e confirmar que falha**

Rodar: `pnpm test:iso`
Esperado: FALHA já no `globalSetup`: o seed quebra com `relation "clin.record_share" does not exist` (SQLSTATE `42P01`), abortando a suíte inteira antes do primeiro teste. Essa é a falha esperada.

- [ ] **Passo 4: Criar a migration**

Rodar: `pnpm db:new rls_clinical_scope` — cria `packages/db/migrations/0007_rls_clinical_scope.sql`. Preencher com exatamente:

```sql
-- 0007_rls_clinical_scope.sql
-- Fase 0 · design §3.3, segunda camada. RESTRICTIVE faz AND com as permissivas:
-- policy nova nunca "abre" acesso.

CREATE TABLE clin.record_share (
  tenant_id uuid NOT NULL DEFAULT app.require_tenant_id(),
  id uuid NOT NULL,
  patient_id uuid NOT NULL,
  grantee_professional_id uuid NOT NULL,
  granted_by_professional_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  granted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz(3),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, grantee_professional_id)
    REFERENCES app.professional(tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by_professional_id)
    REFERENCES app.professional(tenant_id, id));
ALTER TABLE clin.record_share OWNER TO app_owner;

CREATE INDEX ix_record_share_vigente
  ON clin.record_share (tenant_id, patient_id, grantee_professional_id)
  WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON clin.record_share TO app_rw;

ALTER TABLE clin.record_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.record_share FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON clin.record_share AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

CREATE POLICY clinical_scope ON clin.record_share AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR grantee_professional_id = app.current_professional_id()
          OR granted_by_professional_id = app.current_professional_id() );

-- ---------------------------------------------------------------------------
-- clin.patient_identifier: CPF, CNS e carteirinha sao o eixo do escopo clinico.
-- Tres ramos, todos STABLE (o planejador avalia os dois primeiros uma unica vez):
--   1. papel de escopo total no tenant (admin_clinico / diretor_tecnico);
--   2. quem NAO e profissional — recepcao e financeiro precisam do CPF para
--      cobrar, e o ator 'system' do worker cai aqui tambem;
--   3. profissional com compartilhamento vigente para aquele paciente.
-- clin.patient NAO recebe policy RESTRICTIVE: e cadastro, nao prontuario (§10.18).
-- ---------------------------------------------------------------------------
CREATE POLICY clinical_scope ON clin.patient_identifier
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.record_share s
                      WHERE (s.tenant_id, s.patient_id)
                            = (clin.patient_identifier.tenant_id,
                               clin.patient_identifier.patient_id)
                        AND s.grantee_professional_id = app.current_professional_id()
                        AND s.revoked_at IS NULL) );
```

- [ ] **Passo 5: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 7 testes verdes em `05-escopo-clinico.iso.test.ts`, e todos os anteriores continuam verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0007_rls_clinical_scope.sql packages/db/test/iso/seed.ts \
        packages/db/test/iso/05-escopo-clinico.iso.test.ts
git commit -m "feat(db): add restrictive clinical scope policy and clin.record_share"
```

---

### Task 13: T3 e T4 — escrita cruzada não afeta linha alguma, e FK cruzada levanta `23503`

> **A diferença que este teste protege.** Referência cruzada entre tenants **não é "invisível na leitura"**: é violação de integridade referencial na escrita, erro `23503`. O par `(tenant_id, patient_id)` só existe se o paciente for **deste** tenant. É por isso que toda FK de tabela multi-tenant é composta — o imposto permanente que a spec assume e do qual a primeira exceção destrói a garantia.

**Arquivos:**
- Teste: `packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts`

- [ ] **Passo 1: Escrever o teste**

Criar `packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

describe('T3 e T4 — escrita cruzada e FK composta', () => {
  let admin: Client;
  let api: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await admin.end();
    await api.end();
  });

  it('T3 — UPDATE mirando paciente de outro tenant afeta ZERO linhas', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query(
        `UPDATE clin.patient SET full_name = 'NOME SEQUESTRADO' WHERE id = $1`,
        [F.PATIENT_B_MARCOS],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('T3 — UPDATE em massa sem WHERE nao encosta em linha de outro tenant', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query(
        `UPDATE clin.patient SET cadastro_status = 'completo'`,
      );
      expect(r.rowCount).toBe(2); // exatamente os dois pacientes do tenant A
    });
  });

  it('T3 — DELETE mirando identificador de outro tenant afeta ZERO linhas', async () => {
    await comoAtor(api, ANA, async (c) => {
      const r = await c.query('DELETE FROM clin.patient_identifier WHERE id = $1', [
        F.PID_B_MARCOS_CPF,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('T3 — e a linha do outro tenant continua intacta depois das tentativas', async () => {
    const { rows } = await admin.query<{ full_name: string; ids: number }>(
      `SELECT p.full_name,
              (SELECT count(*)::int FROM clin.patient_identifier i
                WHERE i.id = $2) AS ids
         FROM clin.patient p WHERE p.id = $1`,
      [F.PATIENT_B_MARCOS, F.PID_B_MARCOS_CPF],
    );
    expect(rows[0]).toEqual({ full_name: 'Marcos Andrade Lima', ids: 1 });
  });

  it('T4 — identificador apontando para paciente de outro tenant levanta 23503, nao some da leitura', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
           VALUES ($1, $2, $3, 'CPF', '11144477735')`,
          [F.TENANT_A, '01930000-0000-7000-8000-00000000f601', F.PATIENT_B_MARCOS],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
    expect(erro.message).toContain('patient_identifier');
  });

  it('T4 — compartilhamento concedido a profissional de outro tenant levanta 23503', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO clin.record_share
             (tenant_id, id, patient_id, grantee_professional_id,
              granted_by_professional_id, reason)
           VALUES ($1, $2, $3, $4, $5, 'tentativa de vazamento entre clinicas')`,
          [
            F.TENANT_A,
            '01930000-0000-7000-8000-00000000f602',
            F.PATIENT_A_JOANA,
            F.PROF_B_DIEGO,
            F.PROF_A_ANA,
          ],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('T4 — vinculo apontando para clinica de outro tenant levanta 23503', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA, (c) =>
        c.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'profissional')`,
          [
            F.TENANT_A,
            '01930000-0000-7000-8000-00000000f603',
            F.USER_A_ANA,
            F.CLINIC_B_RIO_BRANCO,
          ],
        ),
      ),
    );
    expect(erro.code).toBe('23503');
  });

  it('nenhuma FK de tabela multi-tenant e de coluna unica quando o alvo tambem e multi-tenant', async () => {
    const { rows } = await admin.query<{
      tabela: string;
      constraint: string;
      cols: string[];
    }>(
      `SELECT n.nspname || '.' || t.relname AS tabela,
              c.conname AS constraint,
              (SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a
                   ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname IN ('app','clin','fin','tiss')
          -- so tabelas multi-tenant
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = t.oid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
          -- so FKs cujo ALVO tambem e multi-tenant; FK para id.user ou app.tenant
          -- e legitimamente de coluna unica porque o alvo e global.
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id'
                         AND a.attnum > 0 AND NOT a.attisdropped)
        ORDER BY 1, 2`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const fk of rows) {
      expect(
        fk.cols,
        `${fk.tabela}.${fk.constraint} nao inclui tenant_id: e por essa fresta que o bug de aplicacao vira vazamento`,
      ).toContain('tenant_id');
      expect(fk.cols.length, `${fk.tabela}.${fk.constraint} e de coluna unica`)
        .toBeGreaterThanOrEqual(2);
    }
  });
});
```

- [ ] **Passo 2: Rodar e observar que PASSA — e por que isso não basta**

Rodar: `pnpm test:iso`
Esperado: PASSA. Isso é intencional: T3 e T4 não pedem código novo, pedem a **prova** de que a `tenant_isolation` da Task 11 e as FKs compostas das Tasks 8 a 12 já entregam o comportamento. Um teste que nunca foi visto falhar não vale nada, então o passo seguinte quebra a garantia de propósito.

- [ ] **Passo 3: Provar que o teste realmente falha quando a garantia some**

Editar temporariamente `packages/db/migrations/0005_patient.sql`, trocando a última linha do `CREATE TABLE clin.patient_identifier` por:

```sql
  FOREIGN KEY (patient_id) REFERENCES clin.patient(id));
```

Rodar: `pnpm test:iso`
Esperado: FALHA em dois pontos — `T4 — identificador apontando para paciente de outro tenant levanta 23503` falha com `esperava erro do PostgreSQL, mas a operacao foi ACEITA`, e a varredura de catálogo falha na PRIMEIRA asserção do laço, com `clin.patient_identifier.patient_identifier_patient_id_fkey nao inclui tenant_id: e por essa fresta que o bug de aplicacao vira vazamento` (a asserção seguinte, `e de coluna unica`, nem chega a ser avaliada).

Desfazer a edição:

```bash
git checkout -- packages/db/migrations/0005_patient.sql
```

Rodar: `pnpm test:iso`
Esperado: PASSA — 8 testes verdes em `06-t3-t4-fk-composta.iso.test.ts`.

- [ ] **Passo 4: Commitar**

```bash
git add packages/db/test/iso/06-t3-t4-fk-composta.iso.test.ts
git commit -m "test(iso): prove cross-tenant writes affect zero rows and cross-tenant FKs raise 23503"
```

---
### Task 14: `packages/db/src/pool.ts` — pool de negócio e pool de auditoria separados

**Por que existe:** a trilha de auditoria tem **dois canais de gravação, por razões diferentes** (§3.7). O canal A (domínio: finalização, retificação, exportação) grava **dentro** da transação de negócio, porque o evento só é verdade se a escrita commitou. O canal B (segurança e acesso: login, acesso negado, leitura de prontuário, break-glass, tentativa sem contexto) grava por um **pool dedicado, fora da transação** — porque evento de negação é justamente o que o auditor procura, e ele nasce dentro de uma transação que vai dar `ROLLBACK`. Se o canal B compartilhasse a transação, o registro da negação desapareceria junto com ela.

São **2 conexões** (§2.1). O número é pequeno de propósito: o canal B nunca pode competir por conexão com o tráfego de atendimento.

**Arquivos:**
- Criar: `packages/db/src/pool.ts`
- Modificar: `packages/db/src/index.ts`
- Teste: `packages/db/src/pool.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/pool.int.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { auditPool, businessPool, closePools } from './pool';

afterEach(async () => {
  await closePools();
});

describe('pools do banco', () => {
  it('o pool de negocio e o de auditoria sao objetos distintos', () => {
    expect(auditPool()).not.toBe(businessPool());
  });

  it('cada chamada devolve o mesmo pool, sem abrir conexao nova por requisicao', () => {
    expect(businessPool()).toBe(businessPool());
    expect(auditPool()).toBe(auditPool());
  });

  it('o pool de auditoria para em duas conexoes: a terceira espera', async () => {
    const pool = auditPool();
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    let terceiraChegou = false;
    const terceira = pool.connect().then((c) => {
      terceiraChegou = true;
      return c;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terceiraChegou, 'a terceira conexao nao pode ser concedida com max = 2').toBe(false);

    c1.release();
    const c3 = await terceira;
    expect(terceiraChegou).toBe(true);

    c3.release();
    c2.release();
  });

  it('os dois pools se identificam separadamente no pg_stat_activity', async () => {
    const negocio = await businessPool().connect();
    const auditoria = await auditPool().connect();
    try {
      const r = await negocio.query<{ application_name: string }>(
        `SELECT DISTINCT application_name FROM pg_stat_activity
          WHERE application_name IN ('cadencia-business', 'cadencia-audit')
          ORDER BY application_name`,
      );
      expect(r.rows.map((x) => x.application_name)).toEqual([
        'cadencia-audit',
        'cadencia-business',
      ]);
    } finally {
      negocio.release();
      auditoria.release();
    }
  });

  it('recusa subir sem DATABASE_URL, em vez de conectar em localhost por acidente', async () => {
    await closePools();
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => businessPool()).toThrowError(/variavel de ambiente ausente: DATABASE_URL/);
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/pool.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./pool"`.

- [ ] **Passo 3: Implementar os pools**

Criar `packages/db/src/pool.ts`:

```ts
import { Pool } from 'pg';

let business: Pool | undefined;
let audit: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`variavel de ambiente ausente: ${name}`);
  }
  return value;
}

/**
 * Pool de negocio. Toda transacao de dominio passa por withTenantTx, que e a
 * unica funcao do sistema autorizada a abrir transacao neste pool.
 */
export function businessPool(): Pool {
  business ??= new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-business',
  });
  return business;
}

/**
 * §2.1 e §3.7 canal B — auditoria de seguranca e acesso.
 * Duas conexoes, FORA da transacao de negocio: evento de negacao e o que o
 * auditor procura, e ele nasce dentro de uma transacao que vai dar ROLLBACK.
 * Se este pool fosse o mesmo do dominio, o registro sumiria junto com a falha.
 */
export function auditPool(): Pool {
  audit ??= new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-audit',
  });
  return audit;
}

/** Fecha os dois pools. Usado no shutdown do processo e entre arquivos de teste. */
export async function closePools(): Promise<void> {
  const pools = [business, audit].filter((p): p is Pool => p !== undefined);
  business = undefined;
  audit = undefined;
  await Promise.all(pools.map((p) => p.end()));
}
```

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, closePools } from './pool';
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/pool.int.test.ts`

Esperado: PASSA, 5 testes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/src/pool.ts packages/db/src/pool.int.test.ts packages/db/src/index.ts
git commit -m "feat(db): separate business pool from dedicated 2-connection audit pool"
```

---

### Task 15: `packages/db/src/tx.ts` — `withTenantTx`, o único lugar que abre transação

**Por que existe — leia antes de escrever a primeira linha.** O `TRUE` do terceiro argumento de `set_config` é o item mais importante de todo o desenho do sistema.

`set_config('app.tenant_id', $1, TRUE)` grava a variável com escopo **de transação**: ela desaparece no `COMMIT` ou no `ROLLBACK`. `set_config(..., FALSE)` — equivalente a `SET app.tenant_id = ...` — grava com escopo **de sessão**.

Por que isso decide o produto: com PgBouncer em *transaction mode*, a conexão física é devolvida ao pool ao fim de **cada transação** e entregue à requisição seguinte, que é de **outro tenant**. Um valor de sessão sobrevive à devolução. A requisição da Clínica B pega uma conexão que ainda carrega `app.tenant_id` da Clínica A, a RLS filtra corretamente — pelo tenant errado — e a Clínica B lê o prontuário da Clínica A. Nenhum teste de unidade pega isso. Nenhum log acusa. É incidente P0 com notificação à ANPD em 3 dias úteis.

A mitigação tem quatro camadas, e três delas estão nesta task e nas duas seguintes:
1. **um só lugar abre transação** — esta função;
2. **lint proíbe a string `SET app.` fora dela** — Task 17;
3. **teste do escopo transacional** — passos 1 e 5 abaixo;
4. **teste por tipo de `Actor`** — Task 16: o ator de sistema e o anônimo não têm `user_id`, e é por isso que o preâmbulo grava string vazia e o banco lê com `nullif` (Task 6).

O `SET LOCAL ROLE app_rw` também é obrigatório e não é enfeite: `api` foi criado `NOINHERIT` na migration 0001, então sem essa linha toda query retorna `permission denied`. É uma trava a mais — código que não passa pelo preâmbulo não lê nada.

**Um aviso:** o papel `jobs` (o único com `BYPASSRLS`) **não** usa `withTenantTx`. `SET LOCAL ROLE app_rw` faria o job perder o `BYPASSRLS` e voltar a enxergar zero linhas.

**Outro aviso, que vem da §2.2:** esta função relança o erro **cru** do PostgreSQL. Ela não traduz SQLSTATE para `DomainError` porque `packages/db` e `packages/kernel` são irmãos em L0, e irmão não importa irmão. A tradução por `domainErrorFromSqlState` (Task 19) acontece na borda HTTP, em L3.

**Arquivos:**
- Criar: `packages/db/src/tx.ts`
- Modificar: `packages/db/src/index.ts`
- Teste: `packages/db/src/tx.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/tx.int.test.ts`:

```ts
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { auditPool, closePools } from './pool';
import { withTenantTx, type Actor } from './tx';

const TENANT_A = '01930000-0000-7000-8000-00000000aa01';
const TENANT_B = '01930000-0000-7000-8000-00000000bb01';
const USER_A = '01930000-0000-7000-8000-00000000aa02';
const CLINIC_A = '01930000-0000-7000-8000-00000000aa03';
const REQUEST = '01930000-0000-7000-8000-00000000aa04';

const atorA: Actor = {
  kind: 'user',
  tenantId: TENANT_A,
  userId: USER_A,
  clinicId: CLINIC_A,
  requestId: REQUEST,
};
const atorB: Actor = {
  kind: 'user',
  tenantId: TENANT_B,
  userId: USER_A,
  clinicId: CLINIC_A,
  requestId: REQUEST,
};
const atorSistema: Actor = {
  kind: 'system',
  tenantId: TENANT_A,
  reason: 'outbox-dispatch',
  requestId: REQUEST,
};
const atorAnonimo: Actor = { kind: 'anon', tenantId: TENANT_A, requestId: REQUEST };

let admin: Pool;
/** max = 1 forca todas as transacoes do teste a reusar a MESMA conexao fisica. */
let umaConexao: Pool;

beforeAll(async () => {
  await runMigrations();
  admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN, max: 1 });

  // Tabela-sonda do teste: existe so para observar commit e rollback sem depender
  // de nenhuma tabela de dominio.
  await admin.query(`
    CREATE TABLE IF NOT EXISTS public.tx_probe (
      id uuid PRIMARY KEY, canal text NOT NULL, nota text NOT NULL)`);
  await admin.query('GRANT USAGE ON SCHEMA public TO app_rw');
  await admin.query('GRANT SELECT, INSERT, DELETE ON public.tx_probe TO app_rw');
  // O canal B grava por um pool proprio e NAO executa SET LOCAL ROLE app_rw (ele roda
  // fora da transacao de negocio). Como `api` e NOINHERIT, sem estes dois GRANTs o
  // INSERT do canal B falharia com 42501 e o teste mediria permissao, nao a
  // sobrevivencia ao ROLLBACK. Em producao o canal B grava por funcao SECURITY DEFINER
  // do schema audit; aqui a sonda faz o papel dela.
  await admin.query('GRANT USAGE ON SCHEMA public TO api');
  await admin.query('GRANT SELECT, INSERT, DELETE ON public.tx_probe TO api');
  await admin.query('TRUNCATE public.tx_probe');

  umaConexao = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: 'cadencia-tx-test',
  });
});

afterAll(async () => {
  await admin.query('DROP TABLE IF EXISTS public.tx_probe');
  await admin.query('REVOKE USAGE ON SCHEMA public FROM api');
  await admin.end();
  await umaConexao.end();
  await closePools();
});

describe('escopo transacional do preambulo', () => {
  it('o tenant nao sobrevive ao COMMIT: a conexao devolvida ao pool vem limpa', async () => {
    const dentro = await withTenantTx(
      atorA,
      async (tx) => {
        const r = await tx.query<{ tid: string | null }>('SELECT app.current_tenant_id() AS tid');
        return r.rows[0]?.tid ?? null;
      },
      umaConexao,
    );
    expect(dentro).toBe(TENANT_A);

    // Mesma conexao fisica (max = 1), agora fora de transacao.
    // Apos o COMMIT o valor de transacao some, mas o *placeholder* de GUC continua
    // existindo na sessao: o Postgres devolve '' (string vazia), nao NULL. As duas
    // formas significam "sem tenant"; qualquer uuid aqui e vazamento entre clinicas.
    const depois = await umaConexao.query<{ vazou: string | null }>(
      `SELECT current_setting('app.tenant_id', true) AS vazou`,
    );
    expect(depois.rows[0]?.vazou ?? '').toBe('');
  });

  it('duas transacoes seguidas na mesma conexao enxergam tenants diferentes', async () => {
    const a = await withTenantTx(
      atorA,
      async (tx) => (await tx.query<{ t: string }>('SELECT app.current_tenant_id() AS t')).rows[0]?.t,
      umaConexao,
    );
    const b = await withTenantTx(
      atorB,
      async (tx) => (await tx.query<{ t: string }>('SELECT app.current_tenant_id() AS t')).rows[0]?.t,
      umaConexao,
    );
    expect(a).toBe(TENANT_A);
    expect(b).toBe(TENANT_B);
  });

  it('prova do contrario: com is_local = FALSE o tenant vaza para a transacao seguinte', async () => {
    const client = await umaConexao.connect();
    try {
      await client.query('BEGIN');
      // Exatamente o que `SET app.tenant_id = ...` faz. Nunca escreva isto fora deste teste.
      await client.query(`SELECT set_config('app.tenant_id', $1, FALSE)`, [TENANT_A]);
      await client.query('COMMIT');

      const vazado = await client.query<{ t: string | null }>(
        `SELECT current_setting('app.tenant_id', true) AS t`,
      );
      expect(vazado.rows[0]?.t).toBe(TENANT_A); // o proximo tenant leria isto
    } finally {
      await client.query(`SELECT set_config('app.tenant_id', '', FALSE)`);
      client.release();
    }
  });
});

describe('os tres tipos de Actor', () => {
  it('ator de usuario grava tenant, usuario, clinica, tipo e request_id', async () => {
    const ctx = await withTenantTx(
      atorA,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; c: string; k: string; r: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.clinic_id', true)  AS c,
                    current_setting('app.actor_kind', true) AS k,
                    current_setting('app.request_id', true) AS r`,
          )
        ).rows[0],
      umaConexao,
    );
    // request_id e o unico fio que liga o evento de auditoria a requisicao HTTP.
    // Sem esta assercao, errar o nome do GUC so aparece no bloco de audit.
    expect(ctx).toEqual({ t: TENANT_A, u: USER_A, c: CLINIC_A, k: 'user', r: REQUEST });
  });

  it('ator de sistema entra sem usuario e sem clinica, e nada explode', async () => {
    const ctx = await withTenantTx(
      atorSistema,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; bruto: string; k: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.user_id', true) AS bruto,
                    current_setting('app.actor_kind', true) AS k`,
          )
        ).rows[0],
      umaConexao,
    );
    expect(ctx?.t).toBe(TENANT_A);
    expect(ctx?.u).toBeNull(); // nullif transformou '' em NULL
    expect(ctx?.bruto).toBe(''); // o GUC e sempre texto, nunca NULL
    expect(ctx?.k).toBe('system');
  });

  it('ator anonimo do agendamento online entra so com tenant', async () => {
    const ctx = await withTenantTx(
      atorAnonimo,
      async (tx) =>
        (
          await tx.query<{ t: string | null; u: string | null; k: string }>(
            `SELECT app.current_tenant_id() AS t, app.current_user_id() AS u,
                    current_setting('app.actor_kind', true) AS k`,
          )
        ).rows[0],
      umaConexao,
    );
    expect(ctx?.t).toBe(TENANT_A);
    expect(ctx?.u).toBeNull();
    expect(ctx?.k).toBe('anon');
  });
});

describe('erro, rollback e devolucao da conexao', () => {
  it('faz ROLLBACK quando o callback lanca, e a excecao original chega ao chamador', async () => {
    const id = '01930000-0000-7000-8000-00000000cc01';

    await expect(
      withTenantTx(
        atorA,
        async (tx) => {
          await tx.query('INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)', [
            id,
            'negocio',
            'nao pode sobreviver',
          ]);
          throw new Error('falha de dominio');
        },
        umaConexao,
      ),
    ).rejects.toThrowError('falha de dominio');

    const r = await admin.query('SELECT id FROM public.tx_probe WHERE id = $1', [id]);
    expect(r.rows).toHaveLength(0);
  });

  it('devolve a conexao ao pool mesmo depois do erro: a transacao seguinte funciona', async () => {
    await expect(
      withTenantTx(atorA, async () => {
        throw new Error('boom');
      }, umaConexao),
    ).rejects.toThrowError('boom');

    // Com max = 1, se a conexao nao tivesse sido devolvida esta chamada travaria.
    const vivo = await withTenantTx(
      atorA,
      async (tx) => (await tx.query<{ n: number }>('SELECT 1 AS n')).rows[0]?.n,
      umaConexao,
    );
    expect(vivo).toBe(1);
    expect(umaConexao.idleCount).toBe(1);
  });

  it('recusa ator com tenantId vazio antes de tocar no banco', async () => {
    await expect(
      withTenantTx(
        { kind: 'anon', tenantId: '', requestId: REQUEST },
        async () => 'nunca',
        umaConexao,
      ),
    ).rejects.toThrowError(/tenantId vazio/);
  });
});

describe('canal B da auditoria fora da transacao de negocio', () => {
  it('o evento gravado pelo pool de auditoria sobrevive ao ROLLBACK do negocio', async () => {
    const idNegocio = '01930000-0000-7000-8000-00000000dd01';
    const idAuditoria = '01930000-0000-7000-8000-00000000dd02';

    await expect(
      withTenantTx(
        atorA,
        async (tx) => {
          await tx.query('INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)', [
            idNegocio,
            'negocio',
            'acesso negado',
          ]);
          // Canal B: pool proprio, conexao propria, transacao propria.
          await auditPool().query(
            'INSERT INTO public.tx_probe (id, canal, nota) VALUES ($1, $2, $3)',
            [idAuditoria, 'auditoria', 'ACCESS_DENIED'],
          );
          throw new Error('acesso negado');
        },
        umaConexao,
      ),
    ).rejects.toThrowError('acesso negado');

    const r = await admin.query<{ id: string; canal: string }>(
      'SELECT id, canal FROM public.tx_probe WHERE id = ANY($1::uuid[]) ORDER BY canal',
      [[idNegocio, idAuditoria]],
    );
    // O que o auditor procura e justamente o evento da transacao que falhou.
    expect(r.rows).toEqual([{ id: idAuditoria, canal: 'auditoria' }]);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/tx.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./tx"`.

- [ ] **Passo 3: Implementar `tx.ts`**

Criar `packages/db/src/tx.ts`:

```ts
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { businessPool } from './pool';

/**
 * §3.2 — Ator da transacao.
 *
 * Papel e profissional NAO estao aqui de proposito: sao DERIVADOS do vinculo
 * dentro do banco (app.membership / app.professional). Papel escalar vindo do
 * cliente da acesso total ou nenhum ao medico que e admin em uma unidade e
 * assistente em outra — que e a norma no Brasil.
 */
export type Actor =
  | { kind: 'user'; tenantId: string; userId: string; clinicId: string; requestId: string }
  | { kind: 'system'; tenantId: string; reason: string; requestId: string } // worker/outbox
  | { kind: 'anon'; tenantId: string; requestId: string }; // agendamento online

/** Superficie de consulta entregue ao callback. Nao expoe BEGIN/COMMIT/ROLLBACK. */
export interface TxClient {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * O terceiro argumento TRUE e o item mais importante do sistema inteiro.
 *
 * TRUE  = escopo de TRANSACAO: some no COMMIT/ROLLBACK.
 * FALSE = escopo de SESSAO: sobrevive. Com PgBouncer em transaction mode a
 *         conexao e reciclada entre tenants, e o tenant anterior vaza para a
 *         requisicao seguinte. A RLS filtra certo, pelo tenant errado.
 *
 * Todo GUC e gravado como texto e nunca como NULL: ausencia vira string vazia,
 * e o banco le com nullif(..., ''). O ator de sistema e o anonimo nao tem
 * user_id, e ''::uuid levantaria 22P02 abortando a transacao inteira.
 */
const PREAMBLE = `SELECT
  set_config('app.tenant_id',  $1, TRUE),
  set_config('app.user_id',    $2, TRUE),
  set_config('app.clinic_id',  $3, TRUE),
  set_config('app.actor_kind', $4, TRUE),
  set_config('app.request_id', $5, TRUE)`;

type PreambleParams = readonly [string, string, string, string, string];

export function preambleParams(actor: Actor): PreambleParams {
  switch (actor.kind) {
    case 'user':
      return [actor.tenantId, actor.userId, actor.clinicId, 'user', actor.requestId];
    case 'system':
      return [actor.tenantId, '', '', 'system', actor.requestId];
    case 'anon':
      return [actor.tenantId, '', '', 'anon', actor.requestId];
  }
}

function wrap(client: PoolClient): TxClient {
  return {
    query: <R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<R>> =>
      client.query<R>(sql, params === undefined ? undefined : [...params]),
  };
}

/**
 * O UNICO lugar do sistema que abre transacao de negocio.
 *
 * O papel `jobs` (unico com BYPASSRLS) NAO usa esta funcao: o SET LOCAL ROLE
 * abaixo o faria perder o BYPASSRLS e voltar a enxergar zero linhas.
 *
 * O erro do PostgreSQL sobe CRU, com o SQLSTATE intacto. Traduzir aqui exigiria
 * importar packages/kernel, e irmao nao importa irmao (§2.2): a traducao por
 * domainErrorFromSqlState acontece na borda HTTP, em L3.
 */
export async function withTenantTx<T>(
  actor: Actor,
  fn: (tx: TxClient) => Promise<T>,
  pool: Pool = businessPool(),
): Promise<T> {
  if (actor.tenantId === '') {
    throw new Error('withTenantTx: tenantId vazio — o preambulo nunca roda sem tenant');
  }

  const client = await pool.connect();
  let conexaoQuebrada = false;

  try {
    await client.query('BEGIN');
    // `api` foi criado NOINHERIT: sem esta linha toda query retorna 42501.
    // E uma trava a mais — codigo que nao passa por aqui nao le nada.
    await client.query('SET LOCAL ROLE app_rw');
    await client.query(PREAMBLE, [...preambleParams(actor)]);

    const resultado = await fn(wrap(client));

    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK falhou: a conexao esta em estado desconhecido e sera descartada
      // no finally. O erro original e o que interessa ao chamador.
      conexaoQuebrada = true;
    }
    throw err;
  } finally {
    // release(Error) descarta a conexao em vez de devolve-la ao pool. Conexao com
    // estado indefinido nunca volta para a fila: ela carregaria GUC de outro tenant.
    client.release(
      conexaoQuebrada ? new Error('conexao descartada: ROLLBACK falhou') : undefined,
    );
  }
}
```

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, closePools } from './pool';
export { withTenantTx, preambleParams, type Actor, type TxClient } from './tx';
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/tx.int.test.ts`

Esperado: PASSA, 10 testes.

- [ ] **Passo 5: Provar que o `TRUE` é o que segura o isolamento**

Editar temporariamente `packages/db/src/tx.ts`, trocando os cinco `TRUE` do `PREAMBLE` por `FALSE`, e rodar:

Rodar: `pnpm test:int packages/db/src/tx.int.test.ts`

Esperado: FALHA no teste `o tenant nao sobrevive ao COMMIT` com `expected '01930000-0000-7000-8000-00000000aa01' to be ''`. Este é, literalmente, o vazamento entre clínicas.

- [ ] **Passo 6: Desfazer e confirmar que volta a passar**

Reverter os cinco `FALSE` para `TRUE` e rodar:

Rodar: `pnpm test:int packages/db/src/tx.int.test.ts`

Esperado: PASSA, 10 testes.

- [ ] **Passo 7: Conferir a tipagem do repositório inteiro**

Rodar: `pnpm typecheck`

Esperado: sem saída (zero erros de tipo).

- [ ] **Passo 8: Commitar**

```bash
git add packages/db/src/tx.ts packages/db/src/tx.int.test.ts packages/db/src/index.ts
git commit -m "feat(db): withTenantTx is the single place that opens a business transaction"
```

---

### Task 16: T5 e T5b — sem preâmbulo é zero linhas, e um caso por tipo de `Actor`

> **O item mais importante do documento inteiro** é o `TRUE` de `set_config(..., TRUE)`: com PgBouncer em *transaction mode* a conexão é reciclada entre tenants, e um `SET` de sessão vaza o tenant anterior para a requisição seguinte.
>
> **E o bug que quebrava 100% dos caminhos de worker, webhook e agendamento online:** o ator de sistema e o anônimo **não têm `user_id`**, e `''::uuid` explode com `22P02`. Por isso toda leitura de GUC usa `nullif(...,'')`, sem exceção. T5b existe para que essa regra nunca mais possa ser esquecida — e o último teste do arquivo a torna mecânica, lendo o corpo das funções direto do catálogo.

**Arquivos:**
- Teste: `packages/db/test/iso/07-t5-preambulo-e-atores.iso.test.ts`

- [ ] **Passo 1: Escrever o teste**

Criar `packages/db/test/iso/07-t5-preambulo-e-atores.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, Pool } from 'pg';
import { erroPg, openClient, semContexto } from './harness';
import { withTenantTx, type Actor } from '../../src/tx';
import * as F from './fixtures';

describe('T5 e T5b — preambulo ausente e os tres tipos de Actor', () => {
  let api: Client;
  /** withTenantTx recebe o pool do container desta execucao pelo terceiro argumento. */
  let isoPool: Pool;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    isoPool = new Pool({ connectionString: inject('isoApiUrl'), max: 2 });
  });

  afterAll(async () => {
    await api.end();
    await isoPool.end();
  });

  it('T5 — sem preambulo, a leitura devolve zero linhas em vez de erro', async () => {
    await semContexto(api, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM clin.patient',
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it('T5 — sem preambulo, nenhuma das tabelas multi-tenant devolve linha', async () => {
    await semContexto(api, async (c) => {
      for (const rel of [
        'app.tenant',
        'app.clinic',
        'app.membership',
        'app.professional',
        'clin.patient',
        'clin.patient_identifier',
        'clin.record_share',
      ]) {
        const { rows } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${rel}`,
        );
        expect(rows[0]!.n, `${rel} entregou linha sem contexto de tenant`).toBe(0);
      }
    });
  });

  it('T5 — sem preambulo, a ESCRITA falha alto, com 42501 e mensagem explicita', async () => {
    const erro = await erroPg(() =>
      semContexto(api, (c) =>
        c.query(
          `INSERT INTO clin.patient (id, full_name) VALUES ($1, 'Paciente orfao')`,
          ['01930000-0000-7000-8000-00000000f701'],
        ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('contexto de tenant ausente');
  });

  it('T5 — a variavel de contexto e LOCAL: nao sobrevive ao fim da transacao', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, TRUE)`, [F.TENANT_A]);
    const dentro = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(dentro.rows[0]!.t).toBe(F.TENANT_A);
    await api.query('COMMIT');

    const depois = await api.query<{ t: string | null }>(
      'SELECT app.current_tenant_id() AS t',
    );
    expect(
      depois.rows[0]!.t,
      'o contexto vazou para fora da transacao: com PgBouncer isso entrega o tenant anterior a requisicao seguinte',
    ).toBeNull();
  });

  it('T5b — ator user le o proprio tenant pelo caminho real do withTenantTx', async () => {
    const ator: Actor = {
      kind: 'user',
      tenantId: F.TENANT_A,
      userId: F.USER_A_ANA,
      clinicId: F.CLINIC_A_SP,
      requestId: F.REQUEST_ID,
    };
    const n = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM clin.patient',
        );
        return rows[0]!.n;
      },
      isoPool,
    );
    expect(n).toBe(2);
  });

  it('T5b — ator system nao tem user_id e mesmo assim NAO explode com 22P02', async () => {
    const ator: Actor = {
      kind: 'system',
      tenantId: F.TENANT_A,
      reason: 'selo diario da auditoria',
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{
          u: string | null;
          membro: boolean;
          pacientes: number;
        }>(
          `SELECT app.current_user_id() AS u,
                  app.is_member() AS membro,
                  (SELECT count(*)::int FROM clin.patient) AS pacientes`,
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado.u).toBeNull();
    expect(resultado.membro).toBe(true);
    expect(resultado.pacientes).toBe(2);
  });

  it('T5b — ator anon do agendamento online nao explode e nao le prontuario', async () => {
    const ator: Actor = {
      kind: 'anon',
      tenantId: F.TENANT_A,
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{
          u: string | null;
          membro: boolean;
          pacientes: number;
        }>(
          `SELECT app.current_user_id() AS u,
                  app.is_member() AS membro,
                  (SELECT count(*)::int FROM clin.patient) AS pacientes`,
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado.u).toBeNull();
    expect(resultado.membro).toBe(false);
    expect(resultado.pacientes).toBe(0);
  });

  it('T5b — nenhum tipo de Actor produz o erro 22P02 de uuid vazio', async () => {
    const atores: Actor[] = [
      {
        kind: 'user',
        tenantId: F.TENANT_A,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_A_SP,
        requestId: F.REQUEST_ID,
      },
      {
        kind: 'system',
        tenantId: F.TENANT_A,
        reason: 'despachante de outbox',
        requestId: F.REQUEST_ID,
      },
      { kind: 'anon', tenantId: F.TENANT_A, requestId: F.REQUEST_ID },
    ];

    for (const ator of atores) {
      let codigo: string | undefined;
      try {
        await withTenantTx(
          ator,
          async (tx) => {
            await tx.query(
              `SELECT app.current_tenant_id(), app.current_user_id(),
                      app.current_professional_id(), app.is_member(),
                      app.clinical_scope_all()`,
            );
          },
          isoPool,
        );
      } catch (e) {
        codigo = (e as { code?: string }).code;
      }
      expect(
        codigo,
        `ator '${ator.kind}' quebrou: uuid vazio nao esta protegido por nullif`,
      ).toBeUndefined();
    }
  });

  it('T5b — a regra do nullif e mecanica: os dois leitores de GUC do banco a contem', async () => {
    const admin = await openClient(inject('isoAdminUrl'));
    try {
      const { rows } = await admin.query<{ proname: string; prosrc: string }>(
        `SELECT p.proname, p.prosrc
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app'
            AND p.proname IN ('current_tenant_id','current_user_id')
          ORDER BY p.proname`,
      );
      expect(rows.map((r) => r.proname)).toEqual(['current_tenant_id', 'current_user_id']);
      for (const fn of rows) {
        // Sem nullif, ''::uuid levanta 22P02 e quebra worker, webhook e agendamento
        // online em 100% das execucoes. A assercao existe para que remover o nullif
        // numa migration futura reprove aqui, e nao em producao.
        expect(fn.prosrc, `app.${fn.proname} perdeu o nullif`).toContain('nullif');
      }
    } finally {
      await admin.end();
    }
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — 9 testes verdes em `07-t5-preambulo-e-atores.iso.test.ts`. Os testes `T5` são prova das policies da Task 11; os `T5b` são a primeira vez que `withTenantTx` roda contra o banco do `test:iso`.

- [ ] **Passo 3: Provar que o `nullif` é o que segura o ator de sistema**

Editar temporariamente `packages/db/migrations/0002_transaction_context.sql`, trocando o corpo de `app.current_user_id` por `SELECT current_setting('app.user_id', true)::uuid $$;` e rodar:

Rodar: `pnpm test:iso`
Esperado: FALHA em `T5b — ator system nao tem user_id e mesmo assim NAO explode com 22P02` com `invalid input syntax for type uuid: ""`, e em `T5b — a regra do nullif e mecanica` com `app.current_user_id perdeu o nullif`.

Desfazer:

```bash
git checkout -- packages/db/migrations/0002_transaction_context.sql
```

Rodar: `pnpm test:iso`
Esperado: PASSA — 9 testes verdes.

- [ ] **Passo 4: Commitar**

```bash
git add packages/db/test/iso/07-t5-preambulo-e-atores.iso.test.ts
git commit -m "test(iso): cover missing preamble and all three Actor kinds without empty-uuid crash"
```

---

### Task 17: Lint que proíbe a string `SET app.` fora de `tx.ts`

**Por que existe:** a Task 15 construiu o preâmbulo correto. Esta task impede que alguém, dali a seis meses, escreva `SET app.tenant_id = '...'` dentro de um handler de rota "só para testar uma coisa" e nunca mais tire. É a camada 2 da mitigação de quatro camadas.

O lint pega três formas, e as três parecem inofensivas para quem não conhece PgBouncer:
- `SET app.tenant_id = ...` — escopo de sessão, vaza.
- `SET SESSION app.tenant_id = ...` — idem, explícito.
- `SET LOCAL app.tenant_id = ...` — este de fato é transacional e **não** vazaria; ainda assim é proibido, porque a regra não é "escopo certo", é **"um só lugar abre transação"**. Duas implementações do preâmbulo divergem no primeiro campo novo.

Não é proibido `set_config(..., TRUE)`: essa é a forma parametrizada e é o que `tx.ts` usa. `SET LOCAL ROLE app_rw` também é permitido — não é uma GUC do namespace `app.`.

**Arquivos:**
- Criar: `tools/session-guc.ts`
- Criar: `tools/check-session-guc.ts`
- Modificar: `package.json` (raiz) — bloco `scripts`
- Teste: `tools/session-guc.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

`tools/` não é pacote do workspace: ele usa o `node_modules` da raiz, e `tools/**/*.test.ts` já está no `include` do `vitest.config.ts` da Task 1. Criar `tools/session-guc.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSessionGucViolations } from './session-guc';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cadencia-lint-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function escrever(relativo: string, conteudo: string): void {
  const caminho = join(root, relativo);
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo, 'utf8');
}

describe('lint: SET app. so pode existir em packages/db/src/tx.ts', () => {
  it('acusa SET app.tenant_id numa rota da api, com arquivo e linha', () => {
    escrever(
      'apps/api/src/routes/agenda.ts',
      [
        'export async function listar(client, tenantId) {',
        "  await client.query(`SET app.tenant_id = '${tenantId}'`);",
        '}',
      ].join('\n'),
    );

    const violacoes = findSessionGucViolations(root);

    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.file).toBe('apps/api/src/routes/agenda.ts');
    expect(violacoes[0]?.line).toBe(2);
  });

  it('acusa SET LOCAL app.tenant_id, que parece seguro e ainda assim e um segundo preambulo', () => {
    escrever('apps/worker/src/outbox.ts', "await c.query(\"SET LOCAL app.tenant_id = $1\");");

    const violacoes = findSessionGucViolations(root);

    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.file).toBe('apps/worker/src/outbox.ts');
  });

  it('acusa ALTER DATABASE ... SET app.tenant_id dentro de migration', () => {
    escrever('packages/db/migrations/0099_atalho.sql', "ALTER DATABASE cadencia SET app.tenant_id = '';");

    expect(findSessionGucViolations(root)).toHaveLength(1);
  });

  it('nao acusa o unico arquivo autorizado', () => {
    escrever(
      'packages/db/src/tx.ts',
      ["// SET app.tenant_id — documentado aqui de proposito", "await c.query('SET app.tenant_id = x');"].join('\n'),
    );

    expect(findSessionGucViolations(root)).toEqual([]);
  });

  it('nao acusa set_config parametrizado, que e a forma correta', () => {
    escrever(
      'packages/audit/src/log.ts',
      "await c.query(`SELECT set_config('app.tenant_id', $1, TRUE)`, [tenantId]);",
    );

    expect(findSessionGucViolations(root)).toEqual([]);
  });

  it('nao acusa SET LOCAL ROLE app_rw, que nao e GUC do namespace app.', () => {
    escrever('packages/db/src/outro.ts', "await c.query('SET LOCAL ROLE app_rw');");

    expect(findSessionGucViolations(root)).toEqual([]);
  });

  it('ignora node_modules, dist e .git', () => {
    escrever('node_modules/lib/index.js', "query('SET app.tenant_id = 1')");
    escrever('apps/web/dist/bundle.js', "query('SET app.tenant_id = 1')");

    expect(findSessionGucViolations(root)).toEqual([]);
  });

  it('lista todas as violacoes, nao apenas a primeira', () => {
    escrever('apps/api/src/a.ts', "query('SET app.tenant_id = 1')");
    escrever('apps/api/src/b.ts', "query('SET app.user_id = 1')");

    expect(findSessionGucViolations(root)).toHaveLength(2);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test tools/session-guc.test.ts`

Esperado: FALHA com `Failed to resolve import "./session-guc"`.

- [ ] **Passo 3: Implementar o verificador**

Criar `tools/session-guc.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface GucViolation {
  readonly file: string; // caminho relativo a raiz, com '/'
  readonly line: number; // 1-based
  readonly text: string; // a linha ofensora, sem espaco a esquerda
}

/**
 * Pega `SET app.x`, `SET LOCAL app.x` e `SET SESSION app.x`.
 * NAO pega `set_config('app.x', ..., TRUE)` (a forma correta) nem
 * `SET LOCAL ROLE app_rw` (nao ha ponto depois de `app`).
 */
const FORBIDDEN = /\bset\s+(?:local\s+|session\s+)?app\./i;

/**
 * Arquivos autorizados a conter a string proibida.
 * `packages/db/src/tx.ts` e o unico lugar do sistema que monta o preambulo (§3.2).
 * Os outros quatro sao os que documentam ou testam a propria regra: se ficarem de
 * fora, o lint reprova a si mesmo e o engenheiro desliga a regra em vez de arrumar.
 */
const ALLOWED_FILES = new Set([
  'packages/db/src/tx.ts',
  'packages/db/src/tx.int.test.ts',
  'tools/session-guc.ts',
  'tools/session-guc.test.ts',
  'tools/check-session-guc.ts',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql'];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
}

export function findSessionGucViolations(root: string): GucViolation[] {
  const files: string[] = [];
  walk(root, files);

  const violations: GucViolation[] = [];
  for (const absolute of files.sort()) {
    const file = relative(root, absolute).split(sep).join('/');
    if (ALLOWED_FILES.has(file)) continue;

    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      if (FORBIDDEN.test(text)) {
        violations.push({ file, line: index + 1, text: text.trim() });
      }
    });
  }
  return violations;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test tools/session-guc.test.ts`

Esperado: PASSA, 8 testes.

- [ ] **Passo 5: Escrever o comando de CI**

Criar `tools/check-session-guc.ts`:

```ts
import { resolve } from 'node:path';
import { findSessionGucViolations } from './session-guc';

const root = resolve(import.meta.dirname, '..');
const violations = findSessionGucViolations(root);

if (violations.length === 0) {
  console.log('lint:session-guc — nenhuma ocorrencia de `SET app.` fora de packages/db/src/tx.ts');
  process.exit(0);
}

console.error(
  'lint:session-guc — `SET app.` so pode existir em packages/db/src/tx.ts.\n' +
    'Escopo de sessao sobrevive a devolucao da conexao ao PgBouncer e vaza o tenant\n' +
    'anterior para a requisicao seguinte. Use withTenantTx.\n',
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
process.exit(1);
```

Acrescentar ao bloco `scripts` do `package.json` da raiz:

```json
    "lint:session-guc": "tsx tools/check-session-guc.ts"
```

- [ ] **Passo 6: Rodar o comando no repositório real e confirmar que passa**

Rodar: `pnpm lint:session-guc`

Esperado: imprime `lint:session-guc — nenhuma ocorrencia de \`SET app.\` fora de packages/db/src/tx.ts` e sai com código 0.

- [ ] **Passo 7: Provar que o comando pega uma violação de verdade**

Rodar:

```bash
mkdir -p apps/api/src
printf "await client.query(\"SET app.tenant_id = '1'\");\n" > apps/api/src/violacao-temporaria.ts
pnpm lint:session-guc
```

Esperado: FALHA (exit 1) listando `apps/api/src/violacao-temporaria.ts:1`.

- [ ] **Passo 8: Remover a violação e confirmar que volta a passar**

Rodar:

```bash
rm -rf apps/api/src/violacao-temporaria.ts
pnpm lint:session-guc
```

Esperado: sai com código 0.

- [ ] **Passo 9: Rodar tudo que existe até aqui**

Rodar:

```bash
pnpm db:migrate
pnpm test
pnpm test:int
pnpm test:iso
pnpm lint:session-guc
pnpm typecheck
```

Esperado: `pnpm db:migrate` imprime `nenhuma migration pendente`; `pnpm test` passa (workspace + migration-files + session-guc); `pnpm test:int` passa (compose, migrate, roles, roles-invariants, transaction-context, pool, tx); `pnpm test:iso` passa (8 arquivos, do `00-bootstrap` ao `07-t5`); o lint sai com código 0; `pnpm typecheck` não imprime nada.

- [ ] **Passo 10: Commitar**

```bash
git add tools package.json pnpm-lock.yaml
git commit -m "feat(ci): forbid the string SET app. outside packages/db/src/tx.ts"
```

---

### Task 18: T6 e T7 — contexto forjado e o canário da suíte

> **O buraco que a RLS sozinha não fecha.** RLS protege contra `WHERE` esquecido, **não** contra contexto forjado: uma rota que aceite `?tenantId=` e reaproveite o resolvedor entregaria o tenant alheio **com todos os testes verdes**. `app.is_member()` dentro da policy é o que fecha isso — T6 é a prova.
>
> **O canário.** Roda a suíte inteira como tenant A e afirma, no fim, que nada do tenant B foi tocado. Ele vive no *teardown* do `globalSetup` de propósito: teardown roda depois de todos os arquivos, no processo principal, sem depender de ordem de teste. Se qualquer coisa do tenant B mudou, `pnpm test:iso` termina vermelho.

**Arquivos:**
- Criar: `packages/db/test/iso/impressao-digital.ts`
- Modificar: `packages/db/test/iso/global-setup.ts` (capturar a impressão digital e conferi-la no teardown)
- Modificar: `package.json` (script `prepush`)
- Criar: `.husky/pre-push`
- Teste: `packages/db/test/iso/08-t6-contexto-forjado.iso.test.ts`

- [ ] **Passo 1: Escrever o teste T6**

Criar `packages/db/test/iso/08-t6-contexto-forjado.iso.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client, Pool } from 'pg';
import { comContextoForjado, erroPg, openClient } from './harness';
import { withTenantTx, type Actor } from '../../src/tx';
import * as F from './fixtures';

describe('T6 — contexto forjado', () => {
  let api: Client;
  let isoPool: Pool;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    isoPool = new Pool({ connectionString: inject('isoApiUrl'), max: 2 });
  });

  afterAll(async () => {
    await api.end();
    await isoPool.end();
  });

  it('a rota que aceitasse tenantId do cliente nao entregaria uma linha sequer', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B, // veio do cliente
        userId: F.USER_A_ANA, // veio da sessao, e de outro tenant
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM clin.patient',
        );
        expect(rows[0]!.n).toBe(0);
      },
    );
  });

  it('e o motivo e app.is_member(), nao a coincidencia de nao haver linha', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ membro: boolean; tenant: string }>(
          'SELECT app.is_member() AS membro, app.current_tenant_id()::text AS tenant',
        );
        expect(rows[0]).toEqual({ membro: false, tenant: F.TENANT_B });
      },
    );
  });

  it('o contexto forjado tambem nao consegue ESCREVER no tenant alheio', async () => {
    const erro = await erroPg(() =>
      comContextoForjado(
        api,
        {
          tenantId: F.TENANT_B,
          userId: F.USER_A_ANA,
          clinicId: F.CLINIC_B_RIO_BRANCO,
        },
        (c) =>
          c.query(
            `INSERT INTO clin.patient (id, full_name)
             VALUES ($1, 'Paciente plantado por contexto forjado')`,
            ['01930000-0000-7000-8000-00000000f801'],
          ),
      ),
    );
    expect(erro.code).toBe('42501');
    expect(erro.message).toContain('row-level security policy');
  });

  it('o contexto forjado nao enxerga nem o vinculo do usuario legitimo do outro tenant', async () => {
    await comContextoForjado(
      api,
      {
        tenantId: F.TENANT_B,
        userId: F.USER_A_ANA,
        clinicId: F.CLINIC_B_RIO_BRANCO,
      },
      async (c) => {
        const { rows } = await c.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM app.membership',
        );
        expect(rows[0]!.n).toBe(0);
      },
    );
  });

  it('trocar apenas o clinicId dentro do proprio tenant tambem nao amplia o que se le', async () => {
    const ator: Actor = {
      kind: 'user',
      tenantId: F.TENANT_A,
      userId: F.USER_A_BRUNO,
      // Bruno so tem vinculo em Sao Paulo; o cliente mandou Manaus.
      clinicId: F.CLINIC_A_MANAUS,
      requestId: F.REQUEST_ID,
    };
    const resultado = await withTenantTx(
      ator,
      async (tx) => {
        const { rows } = await tx.query<{ manaus: boolean; sp: boolean }>(
          `SELECT app.has_role_in($1, ARRAY['profissional']) AS manaus,
                  app.has_role_in($2, ARRAY['profissional']) AS sp`,
          [F.CLINIC_A_MANAUS, F.CLINIC_A_SP],
        );
        return rows[0]!;
      },
      isoPool,
    );
    expect(resultado).toEqual({ manaus: false, sp: true });
  });
});
```

- [ ] **Passo 2: Rodar e observar que PASSA**

Rodar: `pnpm test:iso`
Esperado: PASSA nos cinco — de novo intencional: T6 é prova, não implementação. O passo seguinte remove a verificação de vínculo de propósito para ver o teste falhar.

- [ ] **Passo 3: Provar que T6 falha quando `app.is_member()` sai da policy**

Editar temporariamente `packages/db/migrations/0006_rls_tenant_isolation.sql`, na policy de `clin.patient`, trocando as duas linhas por:

```sql
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.require_tenant_id());
```

Rodar: `pnpm test:iso`
Esperado: FALHA — `a rota que aceitasse tenantId do cliente nao entregaria uma linha sequer` falha com `expected 1 to be 0`, e `o contexto forjado tambem nao consegue ESCREVER no tenant alheio` falha com `esperava erro do PostgreSQL, mas a operacao foi ACEITA`. É literalmente o vazamento entre clínicas, reproduzido em dez segundos.

Desfazer a edição:

```bash
git checkout -- packages/db/migrations/0006_rls_tenant_isolation.sql
```

Rodar: `pnpm test:iso`
Esperado: PASSA — 5 testes verdes em `08-t6-contexto-forjado.iso.test.ts`.

- [ ] **Passo 4: Escrever a impressão digital do tenant B**

Criar `packages/db/test/iso/impressao-digital.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { TENANT_B } from './fixtures';

/**
 * Le, como superusuario (sem RLS), TODA linha de TODA tabela multi-tenant que
 * pertence ao tenant B, e resume em um hash estavel. Roda antes da suite e
 * depois dela: qualquer diferenca significa que a suite, rodando como tenant A,
 * encostou em dado do tenant B.
 */
export async function impressaoDigitalDoTenantB(admin: Client): Promise<string> {
  const { rows: tabelas } = await admin.query<{ nsp: string; rel: string }>(
    `SELECT n.nspname AS nsp, c.relname AS rel
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('app','clin','fin','tiss','audit')
        AND c.relkind IN ('r','p')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                       AND a.attnum > 0 AND NOT a.attisdropped)
      ORDER BY 1, 2`,
  );

  const hash = createHash('sha256');

  // app.tenant nao tem coluna tenant_id: a linha do tenant B entra a parte.
  const raiz = await admin.query<{ linha: string }>(
    `SELECT to_jsonb(t.*)::text AS linha FROM app.tenant t WHERE t.id = $1`,
    [TENANT_B],
  );
  hash.update(`app.tenant\n${raiz.rows.map((r) => r.linha).join('\n')}\n`);

  for (const { nsp, rel } of tabelas) {
    const { rows } = await admin.query<{ linha: string }>(
      `SELECT to_jsonb(x.*)::text AS linha
         FROM "${nsp}"."${rel}" x
        WHERE x.tenant_id = $1
        ORDER BY 1`,
      [TENANT_B],
    );
    hash.update(`${nsp}.${rel}\n${rows.map((r) => r.linha).join('\n')}\n`);
  }

  return hash.digest('hex');
}
```

- [ ] **Passo 5: Ligar o canário ao teardown do global setup**

Modificar `packages/db/test/iso/global-setup.ts` em quatro lugares.

(a) Acrescentar o import junto dos outros:

```ts
import { impressaoDigitalDoTenantB } from './impressao-digital';
```

(b) Substituir a linha `let container: StartedPostgreSqlContainer | undefined;` por:

```ts
let container: StartedPostgreSqlContainer | undefined;
let impressaoAntes = '';
```

(c) Acrescentar, logo abaixo de `await seedDoisTenants(admin);`:

```ts
  impressaoAntes = await impressaoDigitalDoTenantB(admin);
```

(d) Substituir o bloco final da função `setup` — de `provide('isoAdminUrl', adminUrl);` até o fim — por:

```ts
  provide('isoAdminUrl', adminUrl);
  provide('isoApiUrl', apiUrl);

  return async () => {
    // T7 — canario. A suite inteira rodou como tenant A. Nada do tenant B pode
    // ter mudado: nem linha nova, nem coluna alterada, nem linha removida.
    const conferencia = new Client({ connectionString: adminUrl });
    await conferencia.connect();
    let depois: string;
    try {
      depois = await impressaoDigitalDoTenantB(conferencia);
    } finally {
      await conferencia.end();
    }
    await container?.stop();

    if (depois !== impressaoAntes) {
      throw new Error(
        'T7 CANARIO REPROVADO: a suite rodou inteira como tenant A e o estado do ' +
          `tenant B mudou (antes=${impressaoAntes.slice(0, 16)} ` +
          `depois=${depois.slice(0, 16)}). Isto e um vazamento entre clinicas.`,
      );
    }
  };
```

- [ ] **Passo 6: Rodar e confirmar que o canário passa**

Rodar: `pnpm test:iso`
Esperado: PASSA — a suíte inteira verde e nenhuma mensagem `T7 CANARIO REPROVADO` ao final.

- [ ] **Passo 7: Provar que o canário morre quando deve**

Criar temporariamente `packages/db/test/iso/99-veneno.iso.test.ts`:

```ts
import { describe, expect, inject, it } from 'vitest';
import { openClient } from './harness';
import * as F from './fixtures';

describe('veneno temporario para validar o canario', () => {
  it('altera uma linha do tenant B por fora da RLS', async () => {
    const admin = await openClient(inject('isoAdminUrl'));
    try {
      const r = await admin.query(
        `UPDATE clin.patient SET full_name = 'ALTERADO PELO VENENO' WHERE id = $1`,
        [F.PATIENT_B_MARCOS],
      );
      expect(r.rowCount).toBe(1);
    } finally {
      await admin.end();
    }
  });
});
```

Rodar: `pnpm test:iso`
Esperado: os testes ficam verdes, mas o processo termina com código de saída diferente de zero e a mensagem `T7 CANARIO REPROVADO: a suite rodou inteira como tenant A e o estado do tenant B mudou (antes=... depois=...)`.

Apagar o veneno:

```bash
rm packages/db/test/iso/99-veneno.iso.test.ts
```

Rodar: `pnpm test:iso`
Esperado: PASSA, sem a mensagem do canário.

- [ ] **Passo 8: Tornar a suíte obrigatória no pre-push**

Instalar e inicializar o husky (o repositório ainda não tem):

```bash
pnpm add -D -w husky
pnpm exec husky init
```

`husky init` acrescenta `"prepare": "husky"` ao `package.json` e aponta o `core.hooksPath` para `.husky/`. Ele também gera um `.husky/pre-commit` de exemplo que não queremos.

Modificar `package.json`, bloco `"scripts"`, acrescentando:

```json
    "prepush": "pnpm lint:session-guc && pnpm test:iso"
```

> `pnpm arch:check` (dependency-cruiser) entra na frente deste comando junto com o bloco de pipeline de CI, que também acrescenta `pnpm test:perf` e `pnpm restore:drill`. Enquanto ele não existe, o `prepush` roda o que existe — nunca um comando indefinido.

Trocar o hook de exemplo pelo pre-push:

```bash
rm -f .husky/pre-commit
printf 'pnpm prepush\n' > .husky/pre-push
chmod +x .husky/pre-push
```

Conferir que o hook está ativo:

```bash
git config core.hooksPath
```
Esperado: `.husky/_`

- [ ] **Passo 9: Rodar a suíte completa uma última vez e commitar**

Rodar: `pnpm prepush`
Esperado: PASSA — o lint sai com código 0 e todos os arquivos `00` a `08` do `test:iso` ficam verdes, sem mensagem de canário.

```bash
git add packages/db/test/iso/08-t6-contexto-forjado.iso.test.ts \
        packages/db/test/iso/impressao-digital.ts \
        packages/db/test/iso/global-setup.ts package.json pnpm-lock.yaml .husky/pre-push
git commit -m "test(iso): add forged-context test and tenant-B canary, wire test:iso into pre-push"
```

---
## Parte III — O pacote `kernel`

> **Por que o kernel vem depois do banco.** `packages/kernel` e `packages/db` são irmãos em L0 e, pela regra 2 da §2.2, nenhum dos dois importa o outro. O kernel não bloqueia nada do isolamento, e o isolamento é o que não se conserta depois. Nada nas Tasks 3 a 18 depende de uma linha sequer deste pacote.

---

### Task 19: Hierarquia de erros do domínio e `Result<T,E>`

**Arquivos:**
- Criar: `packages/kernel/src/errors.ts`
- Criar: `packages/kernel/src/result.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/errors.test.ts`
- Teste: `packages/kernel/src/result.test.ts`

Os erros vêm antes do `Result` porque o teste do `Result` usa `ValidationError` para provar que a exceção original atravessa `unwrapOrThrow` sem ser embrulhada.

- [ ] **Passo 1: Escrever o teste dos erros de domínio que falha**

Criar `packages/kernel/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ConflictError, CrossTenantReferenceError, DomainError, ForbiddenError, ImmutableRecordError,
  NotFoundError, TenantContextMissingError, UnavailableError, ValidationError, domainErrorFromSqlState,
} from './errors';

describe('erros de dominio', () => {
  it('ValidationError e um Error de verdade, mantem o nome da classe e responde 422', () => {
    const error = new ValidationError('patient.cpf.invalido', 'CPF invalido', { field: 'cpf' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('ValidationError');
    expect(error.kind).toBe('validation');
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe('patient.cpf.invalido');
    expect(error.details['field']).toBe('cpf');
  });

  it('details e congelado: o erro viaja para log, Sentry e trilha e nao pode ser editado no caminho', () => {
    const error = new ValidationError('x', 'y', { field: 'cpf' });
    expect(() => { (error.details as Record<string, unknown>)['field'] = 'outro'; }).toThrow(TypeError);
    expect(error.details['field']).toBe('cpf');
  });

  it('cada classe tem um status HTTP proprio', () => {
    expect(new NotFoundError('a', 'b').httpStatus).toBe(404);
    expect(new ConflictError('a', 'b').httpStatus).toBe(409);
    expect(new ForbiddenError('a', 'b').httpStatus).toBe(403);
    expect(new ImmutableRecordError('a', 'b').httpStatus).toBe(409);
    expect(new UnavailableError('a', 'b').httpStatus).toBe(503);
  });

  it('42501 vira TenantContextMissingError com status 500: preambulo de transacao esquecido e bug nosso, nao erro do usuario', () => {
    const error = domainErrorFromSqlState('42501', { table: 'clin.patient' });
    expect(error).toBeInstanceOf(TenantContextMissingError);
    expect(error?.httpStatus).toBe(500);
    expect(error?.details['table']).toBe('clin.patient');
  });

  it('23503 vira CrossTenantReferenceError: a FK composta transforma referencia a outro tenant em erro de escrita, nao em vazamento silencioso', () => {
    const error = domainErrorFromSqlState('23503', { constraint: 'clin_encounter_tenant_patient_fkey' });
    expect(error).toBeInstanceOf(CrossTenantReferenceError);
    expect(error?.kind).toBe('cross_tenant_reference');
  });

  it('23505 vira ConflictError e 23514 vira ValidationError', () => {
    expect(domainErrorFromSqlState('23505')).toBeInstanceOf(ConflictError);
    expect(domainErrorFromSqlState('23514')).toBeInstanceOf(ValidationError);
    expect(domainErrorFromSqlState('23502')).toBeInstanceOf(ValidationError);
    expect(domainErrorFromSqlState('40001')).toBeInstanceOf(ConflictError);
  });

  it('SQLSTATE desconhecido devolve null para o chamador relancar o erro original em vez de mascarar falha de infraestrutura', () => {
    expect(domainErrorFromSqlState('08006')).toBeNull();
  });

  it('toJSON expoe o contrato do erro e nao expoe a stack', () => {
    const error = new ForbiddenError('authz.acao_negada', 'acao nao permitida', { action: 'encounter.read' });
    expect(error.toJSON()).toEqual({
      code: 'authz.acao_negada',
      kind: 'forbidden',
      httpStatus: 403,
      message: 'acao nao permitida',
      details: { action: 'encounter.read' },
    });
    expect(JSON.stringify(error.toJSON())).not.toContain('stack');
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/errors.test.ts`
Esperado: FALHA com `Failed to resolve import "./errors" from "packages/kernel/src/errors.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar os erros de domínio**

Criar `packages/kernel/src/errors.ts`:

```ts
export type DomainErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'tenant_context_missing'
  | 'cross_tenant_reference'
  | 'immutable'
  | 'unavailable';

/**
 * Detalhe de erro NUNCA carrega conteudo clinico nem o valor de um documento:
 * o erro viaja para log, Sentry e trilha de auditoria, e a NGS1.07.06 proibe
 * conteudo la. So primitivo, e so o NOME do campo — nunca o que foi digitado.
 */
export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

export interface SerializedDomainError {
  readonly code: string;
  readonly kind: DomainErrorKind;
  readonly httpStatus: number;
  readonly message: string;
  readonly details: ErrorDetails;
}

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  abstract readonly httpStatus: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  toJSON(): SerializedDomainError {
    return {
      code: this.code,
      kind: this.kind,
      httpStatus: this.httpStatus,
      message: this.message,
      details: this.details,
    };
  }
}

/** 422 — entrada malformada. Culpa do dado que chegou. */
export class ValidationError extends DomainError {
  readonly kind = 'validation' as const;
  readonly httpStatus = 422;
}

/** 404 — nao existe, ou a RLS devolveu zero linha (leitura falha fechada em silencio). */
export class NotFoundError extends DomainError {
  readonly kind = 'not_found' as const;
  readonly httpStatus = 404;
}

/** 409 — inclui a revisao otimista do rascunho (clin.encounter_draft.rev). */
export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const;
  readonly httpStatus = 409;
}

/** 403 — negado pelo catalogo de acoes ou por policy. */
export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden' as const;
  readonly httpStatus = 403;
}

/** 500 — preambulo de transacao esquecido. Escrita falha ALTO, de proposito. */
export class TenantContextMissingError extends DomainError {
  readonly kind = 'tenant_context_missing' as const;
  readonly httpStatus = 500;
}

/** 500 — 23503: tentou apontar para linha de outro tenant. */
export class CrossTenantReferenceError extends DomainError {
  readonly kind = 'cross_tenant_reference' as const;
  readonly httpStatus = 500;
}

/** 409 — tentativa de UPDATE ou DELETE em registro append-only. */
export class ImmutableRecordError extends DomainError {
  readonly kind = 'immutable' as const;
  readonly httpStatus = 409;
}

/** 503 — dependencia fora do ar. */
export class UnavailableError extends DomainError {
  readonly kind = 'unavailable' as const;
  readonly httpStatus = 503;
}

/**
 * SQLSTATE -> erro de dominio. Devolve null quando o codigo nao e conhecido:
 * traduzir SQLSTATE desconhecido para um erro generico esconde falha de infra.
 *
 * ONDE ESTA FUNCAO E USADA: na borda HTTP (L3), que captura o erro cru relancado
 * por withTenantTx. `packages/db` NAO a importa — db e kernel sao irmaos em L0 e
 * a §2.2 proibe import entre irmaos, sem excecao.
 */
export function domainErrorFromSqlState(sqlstate: string, details: ErrorDetails = {}): DomainError | null {
  switch (sqlstate) {
    case '42501':
      return new TenantContextMissingError('db.tenant_context_missing', 'contexto de tenant ausente na transacao', details);
    case '23503':
      return new CrossTenantReferenceError('db.cross_tenant_reference', 'referencia a linha de outro tenant', details);
    case '23505':
      return new ConflictError('db.unique_violation', 'registro ja existe', details);
    case '23514':
      return new ValidationError('db.check_violation', 'valor viola regra declarada no banco', details);
    case '23502':
      return new ValidationError('db.not_null_violation', 'campo obrigatorio ausente', details);
    case '40001':
      return new ConflictError('db.serialization_failure', 'conflito de serializacao: repetir a transacao', details);
    default:
      return null;
  }
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/errors.test.ts`
Esperado: PASSA — 8 testes

- [ ] **Passo 5: Escrever o teste do `Result` que falha**

Criar `packages/kernel/src/result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { andThen, collect, err, isErr, isOk, map, mapErr, ok, unwrapOr, unwrapOrThrow } from './result';

describe('Result', () => {
  it('carrega o valor no sucesso e o erro na falha, sem lancar excecao', () => {
    const sucesso = ok(42);
    const falha = err('sem contexto de tenant');
    expect(isOk(sucesso)).toBe(true);
    expect(sucesso.value).toBe(42);
    expect(isErr(falha)).toBe(true);
    expect(falha.error).toBe('sem contexto de tenant');
  });

  it('map transforma so o sucesso; a falha atravessa intacta', () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    expect(map(err('x'), (n: number) => n * 10)).toEqual(err('x'));
  });

  it('mapErr traduz so o erro', () => {
    expect(mapErr(err('cru'), (e) => `traduzido: ${e}`)).toEqual(err('traduzido: cru'));
    expect(mapErr(ok(1), (e: string) => e)).toEqual(ok(1));
  });

  it('andThen encadeia validacoes e para na primeira falha', () => {
    const dobrarSePositivo = (n: number) => (n > 0 ? ok(n * 2) : err('negativo'));
    expect(andThen(ok(3), dobrarSePositivo)).toEqual(ok(6));
    expect(andThen(ok(-1), dobrarSePositivo)).toEqual(err('negativo'));
    expect(andThen(err<string>('antes'), dobrarSePositivo)).toEqual(err('antes'));
  });

  it('collect junta TODOS os erros: o cadastro de paciente mostra os campos errados de uma vez, nao um por vez', () => {
    const resultado = collect([ok('nome'), err('cpf invalido'), err('data de nascimento no futuro')]);
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error).toEqual(['cpf invalido', 'data de nascimento no futuro']);
    expect(collect([ok(1), ok(2)])).toEqual(ok([1, 2]));
  });

  it('unwrapOr devolve o alternativo na falha', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err('x'), 99)).toBe(99);
  });

  it('unwrapOrThrow relanca a MESMA instancia quando o erro ja e uma excecao: um ValidationError precisa chegar no handler com o httpStatus 422 intacto', () => {
    const original = new ValidationError('patient.cpf.invalido', 'CPF invalido', { field: 'cpf' });
    let capturado: unknown = null;
    try {
      unwrapOrThrow(err(original));
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBe(original);                                  // identidade, nao a mensagem
    expect((capturado as ValidationError).httpStatus).toBe(422);
    expect(unwrapOrThrow(ok('ok'))).toBe('ok');
  });

  it('unwrapOrThrow embrulha em Error o erro que NAO e excecao, preservando o texto', () => {
    let capturado: unknown = null;
    try {
      unwrapOrThrow(err('cpf invalido'));
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(Error);
    expect((capturado as Error).message).toBe('cpf invalido');
  });
});
```

- [ ] **Passo 6: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/result.test.ts`
Esperado: FALHA com `Failed to resolve import "./result" from "packages/kernel/src/result.test.ts". Does the file exist?`

- [ ] **Passo 7: Implementar o `Result`**

Criar `packages/kernel/src/result.ts`:

```ts
/**
 * Result<T, E> — erro ESPERADO e valor de retorno, nao excecao.
 * O formato { ok: true, value } / { ok: false, error } e o mesmo de
 * ProviderResult (secao 7 da spec): um unico vocabulario de resultado no sistema.
 * Excecao fica reservada para bug nosso — o que precisa aparecer no Sentry.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function map<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function andThen<T, E, U>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Usar SO quando a falha for impossivel por construcao. A excecao sobe para o Sentry.
 * Erro que JA e excecao sobe pela mesma instancia: embrulhar um ValidationError
 * jogaria fora o httpStatus 422 e o handler devolveria 500.
 */
export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

/** Todos os erros de uma vez: formulario nao mostra um campo errado por vez. */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}
```

- [ ] **Passo 8: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src`
Esperado: PASSA — 16 testes (8 de `result`, 8 de `errors`)

- [ ] **Passo 9: Publicar no index e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
```

```bash
git add packages/kernel/src
git commit -m "feat(kernel): add domain error hierarchy and Result type"
```

---

### Task 20: UUIDv7 gerado na aplicação

**Arquivos:**
- Criar: `packages/kernel/src/uuid.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/uuid.test.ts`

Toda chave do sistema é UUIDv7 gerado na aplicação (§10 item 14). Os 48 bits iniciais são o epoch em milissegundos, o que faz a chave ordenar por tempo — e um índice B-tree que só recebe inserção no fim não fragmenta. Dois registros no mesmo milissegundo precisam sair em ordem de criação: sem isso, "último atendimento" fica indefinido.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/kernel/src/uuid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { createUuidV7, isUuidV7, timestampMsFromUuidV7, uuidv7 } from './uuid';

const INSTANTE = 1767225600000; // 2026-01-01T00:00:00.000Z

describe('UUIDv7', () => {
  it('gera identificador no formato da RFC 9562, com versao 7 e variante RFC', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuidV7(id)).toBe(true);
  });

  it('carrega o instante da geracao nos 48 bits iniciais', () => {
    const next = createUuidV7();
    expect(timestampMsFromUuidV7(next(INSTANTE))).toBe(INSTANTE);
  });

  it('e monotonico dentro do mesmo milissegundo: 10 mil chaves geradas no mesmo instante saem em ordem crescente', () => {
    const next = createUuidV7();
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i += 1) ids.push(next(INSTANTE));
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ordena lexicograficamente na mesma ordem do tempo: ordenar por id e ordenar por criacao', () => {
    const next = createUuidV7();
    const antes = next(INSTANTE);
    const depois = next(INSTANTE + 1000);
    expect(depois > antes).toBe(true);
    expect(timestampMsFromUuidV7(depois) - timestampMsFromUuidV7(antes)).toBe(1000);
  });

  it('continua crescente quando o relogio da maquina anda para tras (ajuste de NTP)', () => {
    const next = createUuidV7();
    const antes = next(INSTANTE);
    const depois = next(INSTANTE - 5000);
    expect(depois > antes).toBe(true);
    expect(timestampMsFromUuidV7(depois)).toBe(INSTANTE);
  });

  it('recusa string que nao e UUIDv7 — um UUIDv4, por exemplo — sem ecoar o valor recebido', () => {
    const uuidV4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(isUuidV7(uuidV4)).toBe(false);
    expect(() => timestampMsFromUuidV7(uuidV4)).toThrow(ValidationError);
    try {
      timestampMsFromUuidV7(uuidV4);
    } catch (error) {
      expect(JSON.stringify((error as ValidationError).toJSON())).not.toContain('9b1deb4d');
    }
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/uuid.test.ts`
Esperado: FALHA com `Failed to resolve import "./uuid" from "packages/kernel/src/uuid.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar**

Criar `packages/kernel/src/uuid.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { ValidationError } from './errors';

/** UUIDv7 (RFC 9562): 48 bits de epoch em ms, 12 bits de contador, 62 bits aleatorios. */
export type UuidV7 = string & { readonly __brand: 'UuidV7' };

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_COUNTER = 0xfff;

/**
 * Cada gerador tem contador proprio. O contador ocupa os 12 bits de rand_a e
 * garante ordem dentro do mesmo milissegundo; quando estoura, o gerador avanca
 * 1 ms artificial. Relogio que anda para tras nunca regride o identificador.
 */
export function createUuidV7(): (nowMs?: number) => UuidV7 {
  let lastMs = -1;
  let counter = 0;

  return function next(nowMs: number = Date.now()): UuidV7 {
    let ms = Math.floor(nowMs);
    if (ms > lastMs) {
      lastMs = ms;
      counter = 0;
    } else {
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastMs += 1;
        counter = 0;
      }
      ms = lastMs;
    }

    const bytes = randomBytes(16);
    bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);   // versao 7 + contador alto
    bytes[7] = counter & 0xff;                     // contador baixo
    bytes[8] = 0x80 | (bytes[8]! & 0x3f);          // variante RFC 4122/9562

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UuidV7;
  };
}

/** Gerador padrao do processo. */
export const uuidv7 = createUuidV7();

export function isUuidV7(value: string): value is UuidV7 {
  return UUID_V7_PATTERN.test(value);
}

export function timestampMsFromUuidV7(value: string): number {
  if (!isUuidV7(value)) {
    throw new ValidationError('uuid.v7.invalido', 'identificador nao e um UUIDv7', { length: value.length });
  }
  return Number.parseInt(value.replace(/-/g, '').slice(0, 12), 16);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/uuid.test.ts`
Esperado: PASSA — 6 testes

- [ ] **Passo 5: Publicar no index e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
export * from './uuid';
```

```bash
git add packages/kernel/src
git commit -m "feat(kernel): add monotonic UUIDv7 generator"
```

---

### Task 21: `Clock` — medição e componente temporal do UUIDv7, nada mais

**Arquivos:**
- Criar: `packages/kernel/src/clock.ts`
- Criar: `tools/repo/time-source.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/clock.test.ts`
- Teste: `tools/repo/time-source.test.ts`

Convenção universal da §3: **a fonte de tempo persistido é sempre o Postgres** (`clock_timestamp()`, cluster em UTC). O relógio do Node serve para medir duração e para o componente temporal do UUIDv7. Uma única linha `updated_at: clock.nowMs()` já basta para dois processos discordarem sobre a ordem dos fatos no prontuário.

- [ ] **Passo 1: Escrever o teste do `Clock` que falha**

Criar `packages/kernel/src/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fixedClock, measure, measureAsync, systemClock } from './clock';
import { createUuidV7, timestampMsFromUuidV7 } from './uuid';

const INSTANTE = 1767225600000; // 2026-01-01T00:00:00.000Z

describe('Clock', () => {
  it('mede duracao pelo relogio monotonico: ajuste de NTP para tras no meio da medicao nao produz latencia negativa', () => {
    const clock = fixedClock(INSTANTE);
    const medido = measure(clock, () => {
      clock.stepWallClock(-5000); // servidor sincroniza e volta 5 segundos
      clock.advance(12);
      return 'atendimento finalizado';
    });
    expect(medido.durationMs).toBe(12);
    expect(medido.value).toBe('atendimento finalizado');
  });

  it('mede tambem operacao assincrona', async () => {
    const clock = fixedClock(INSTANTE);
    const medido = await measureAsync(clock, async () => {
      clock.advance(250);
      return 42;
    });
    expect(medido.durationMs).toBe(250);
    expect(medido.value).toBe(42);
  });

  it('o UNICO uso do Clock que chega ao banco e o componente temporal do UUIDv7: o carimbo de tempo persistido vem do Postgres', () => {
    const clock = fixedClock(INSTANTE);
    const next = createUuidV7();
    expect(timestampMsFromUuidV7(next(clock.nowMs()))).toBe(INSTANTE);
  });

  it('fixedClock e deterministico e avanca os dois relogios junto', () => {
    const clock = fixedClock(INSTANTE);
    expect(clock.nowMs()).toBe(INSTANTE);
    expect(clock.monotonicMs()).toBe(0);
    clock.advance(1500);
    expect(clock.nowMs()).toBe(INSTANTE + 1500);
    expect(clock.monotonicMs()).toBe(1500);
  });

  it('systemClock.monotonicMs avanca de verdade e NAO e o relogio de parede: e ele que mede latencia', () => {
    const monoAntes = systemClock.monotonicMs();
    const wallAntes = systemClock.nowMs();

    let voltas = 0;
    while (systemClock.monotonicMs() - monoAntes < 2) voltas += 1;
    const monoDepois = systemClock.monotonicMs();

    expect(voltas).toBeGreaterThan(0);
    expect(monoDepois - monoAntes).toBeGreaterThanOrEqual(2);   // avanca de verdade
    // performance.now() conta a partir do inicio do processo; Date.now() conta a partir
    // de 1970. Se alguem trocar monotonicMs por Date.now(), esta linha quebra na hora.
    expect(monoDepois).toBeLessThan(wallAntes);
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/clock.test.ts`
Esperado: FALHA com `Failed to resolve import "./clock" from "packages/kernel/src/clock.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar o `Clock`**

Criar `packages/kernel/src/clock.ts`:

```ts
/**
 * O Clock existe para DUAS coisas, e nada mais:
 *   1. medir duracao (latencia, timeout, backoff);
 *   2. alimentar o componente temporal do UUIDv7.
 *
 * A fonte de tempo PERSISTIDO e sempre o Postgres — `clock_timestamp()`, com o
 * cluster em UTC e NTP (convencoes universais da secao 3 da spec). Nenhum valor
 * gravado em coluna timestamptz sai daqui. Relogio de aplicacao deriva entre
 * processos; o do banco e unico, e a ordem dos fatos do prontuario depende disso.
 */
export interface Clock {
  /** Epoch em milissegundos. Para o UUIDv7 e para carimbo de log. */
  nowMs(): number;
  /** Relogio monotonico, imune a ajuste de NTP. NUNCA persistir. */
  monotonicMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
};

export interface TestClock extends Clock {
  /** Passagem normal do tempo: move os dois relogios. */
  advance(ms: number): void;
  /** Ajuste de NTP: move SO o relogio de parede, e pode ir para tras. */
  stepWallClock(ms: number): void;
}

export function fixedClock(startMs: number): TestClock {
  let wall = startMs;
  let monotonic = 0;
  return {
    nowMs: () => wall,
    monotonicMs: () => monotonic,
    advance: (ms: number) => { wall += ms; monotonic += ms; },
    stepWallClock: (ms: number) => { wall += ms; },
  };
}

export interface Measured<T> {
  readonly value: T;
  readonly durationMs: number;
}

export function measure<T>(clock: Clock, fn: () => T): Measured<T> {
  const start = clock.monotonicMs();
  const value = fn();
  return { value, durationMs: clock.monotonicMs() - start };
}

export async function measureAsync<T>(clock: Clock, fn: () => Promise<T>): Promise<Measured<T>> {
  const start = clock.monotonicMs();
  const value = await fn();
  return { value, durationMs: clock.monotonicMs() - start };
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/clock.test.ts`
Esperado: PASSA — 5 testes

- [ ] **Passo 5: Escrever o teste do guarda de fonte de tempo, que falha**

A regra "o tempo persistido vem do Postgres" só vale se for mecânica. Criar `tools/repo/time-source.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIME_SOURCE_ALLOWLIST, listSourceFiles, scanTimeSource } from './time-source';

describe('fonte de tempo', () => {
  it('acusa Date.now() e new Date() com o numero da linha', () => {
    const fonte = ['const a = 1;', 'const t = Date.now();', 'const d = new Date();'].join('\n');
    const violacoes = scanTimeSource('packages/db/src/tx.ts', fonte);
    expect(violacoes).toHaveLength(2);
    expect(violacoes[0]?.line).toBe(2);
    expect(violacoes[1]?.line).toBe(3);
    expect(violacoes[0]?.file).toBe('packages/db/src/tx.ts');
  });

  it('nao acusa uso legitimo de tipo Date em assinatura', () => {
    expect(scanTimeSource('x.ts', 'function f(d: Date): number { return 0; }')).toEqual([]);
  });

  it('nenhum arquivo fora de kernel/clock.ts e kernel/uuid.ts le o relogio do sistema: o carimbo persistido vem do Postgres', () => {
    const arquivos = listSourceFiles(['packages', 'apps']).filter((f) => !TIME_SOURCE_ALLOWLIST.includes(f));
    const violacoes = arquivos.flatMap((arquivo) => scanTimeSource(arquivo, readFileSync(arquivo, 'utf8')));
    expect(violacoes.map((v) => `${v.file}:${v.line}`)).toEqual([]);
  });
});
```

- [ ] **Passo 6: Rodar e confirmar que falha**

Rodar: `pnpm test tools/repo/time-source.test.ts`
Esperado: FALHA com `Failed to resolve import "./time-source" from "tools/repo/time-source.test.ts". Does the file exist?`

- [ ] **Passo 7: Implementar o guarda**

Criar `tools/repo/time-source.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

export interface TimeSourceViolation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

/** Os dois unicos arquivos do repositorio autorizados a ler o relogio do sistema. */
export const TIME_SOURCE_ALLOWLIST: readonly string[] = [
  'packages/kernel/src/clock.ts',
  'packages/kernel/src/uuid.ts',
];

const FORBIDDEN = /\bDate\.now\s*\(|\bnew\s+Date\s*\(/;

export function scanTimeSource(file: string, source: string): TimeSourceViolation[] {
  const violations: TimeSourceViolation[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (FORBIDDEN.test(line)) {
      violations.push({ file, line: index + 1, snippet: line.trim() });
    }
  }
  return violations;
}

export function listSourceFiles(roots: readonly string[]): string[] {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        files.push(full.split(sep).join(posix.sep));
      }
    }
  };

  for (const root of roots) {
    if (existsSync(root)) walk(root);
  }
  return files;
}
```

> `packages/db/src/migrate.ts` já mede a duração da migration com `performance.now()` exatamente por causa desta regra (Task 3). Se algum arquivo novo aparecer aqui, a correção é usar `performance.now()` para medição e `clock_timestamp()` no SQL para carimbo — nunca acrescentar o arquivo à allowlist.

- [ ] **Passo 8: Rodar e confirmar que passa**

Rodar: `pnpm test`
Esperado: PASSA — inclui os 3 testes de `tools/repo/time-source.test.ts`

- [ ] **Passo 9: Publicar no index e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
export * from './uuid';
export * from './clock';
```

```bash
git add packages/kernel/src tools/repo
git commit -m "feat(kernel): add Clock for measurement only and guard the persisted time source"
```

---

### Task 22: `Money` em centavos inteiros

**Arquivos:**
- Criar: `packages/kernel/src/money.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/money.test.ts`

Dinheiro é inteiro de centavos, nunca float (§2.3). Não existe `multiply`: 70% de um valor é `allocate(m, [70, 30])[0]`, que fecha exatamente com o total. Repasse médico, parcelamento e split de recebimento passam todos por `allocate`.

**Desvio registrado da §2.3.** A célula 'Dinheiro / tempo' da §2.3 diz 'centavos inteiros + `dinero.js` v2'. Este plano cumpre 'centavos inteiros' e **não** usa `dinero.js`, por três razões: (1) `Money` mora no `kernel`, que é a raiz de L0 do grafo da §2.2 — uma dependência externa ali é uma aresta que o `pnpm arch:check` não consegue governar e que todo o sistema herda; (2) a única operação que o produto realmente precisa é o rateio que fecha com o total, e ele fica congelado por teste aqui, com os casos brasileiros reais (repasse 70/30 sobre R$ 333,33, estorno negativo, 1 centavo entre 3); (3) a moeda é única e fixa em `'BRL'` (§1: produto só-Brasil, §9: 'Multi-idioma e multi-país' está fora), então o modelo multi-moeda do `dinero.js` é custo sem uso.

**Consequência vinculante, válida para todas as fases:** `dinero.js` não entra no repositório. Se a decisão for revertida, é emenda escrita à §2.3, e `Money` vira uma fachada fina sobre a biblioteca — com os testes deste arquivo valendo sem alteração de uma única linha, inclusive os valores de `allocate`. Nenhum outro módulo escreve aritmética de dinheiro por conta própria: `fin`, `billing`, `payments` e `tiss` importam `Money` do `kernel`.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/kernel/src/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { ZERO_BRL, add, allocate, brl, compare, formatBRL, parseBRL, subtract, sum } from './money';
import { isErr, isOk } from './result';

describe('Money', () => {
  it('soma em centavos e exata onde o float erra: 0,10 + 0,20 = 0,30', () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(add(brl(10), brl(20))).toEqual(brl(30));
    expect(subtract(brl(30), brl(20))).toEqual(brl(10));
  });

  it('recusa centavo fracionado: nao existe meio centavo em recibo', () => {
    expect(() => brl(10.5)).toThrow(ValidationError);
    expect(() => brl(Number.NaN)).toThrow(ValidationError);
  });

  it('rateia R$ 100,00 em 3 partes iguais sem perder nem inventar centavo', () => {
    const partes = allocate(brl(10000), [1, 1, 1]);
    expect(partes.map((p) => p.cents)).toEqual([3334, 3333, 3333]);
    expect(sum(partes)).toEqual(brl(10000));
  });

  it('repasse de 70/30 sobre R$ 333,33 fecha exatamente com o valor recebido', () => {
    const [profissional, clinica] = allocate(brl(33333), [70, 30]);
    expect(profissional?.cents).toBe(23333);
    expect(clinica?.cents).toBe(10000);
    expect((profissional?.cents ?? 0) + (clinica?.cents ?? 0)).toBe(33333);
  });

  it('rateia estorno (valor negativo) preservando o sinal e o total', () => {
    const partes = allocate(brl(-10000), [1, 1, 1]);
    expect(partes.map((p) => p.cents)).toEqual([-3334, -3333, -3333]);
    expect(sum(partes)).toEqual(brl(-10000));
  });

  it('rateia 1 centavo entre 3: alguem recebe e ninguem recebe centavo fantasma', () => {
    expect(allocate(brl(1), [1, 1, 1]).map((p) => p.cents)).toEqual([1, 0, 0]);
  });

  it('recusa rateio sem partes ou com soma zero', () => {
    expect(() => allocate(brl(100), [])).toThrow(ValidationError);
    expect(() => allocate(brl(100), [0, 0])).toThrow(ValidationError);
    expect(() => allocate(brl(100), [-1, 2])).toThrow(ValidationError);
  });

  it('formata no padrao brasileiro, com ponto de milhar e virgula decimal', () => {
    expect(formatBRL(brl(123456))).toBe('R$ 1.234,56');
    expect(formatBRL(brl(100000000))).toBe('R$ 1.000.000,00');
    expect(formatBRL(brl(-5))).toBe('-R$ 0,05');
    expect(formatBRL(ZERO_BRL)).toBe('R$ 0,00');
  });

  it('le "R$ 1.234,56" entendendo o ponto como separador de milhar, nunca como decimal', () => {
    const comCentavos = parseBRL('R$ 1.234,56');
    expect(isOk(comCentavos) && comCentavos.value.cents).toBe(123456);
    const semCentavos = parseBRL('1.234');
    expect(isOk(semCentavos) && semCentavos.value.cents).toBe(123400);
  });

  it('recusa "1234.56": ponto decimal e formato de outro pais e viraria R$ 12,34 em silencio', () => {
    const resultado = parseBRL('1234.56');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('money.formato_invalido');
  });

  it('compara valores', () => {
    expect(compare(brl(100), brl(200))).toBe(-1);
    expect(compare(brl(200), brl(100))).toBe(1);
    expect(compare(brl(100), brl(100))).toBe(0);
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/money.test.ts`
Esperado: FALHA com `Failed to resolve import "./money" from "packages/kernel/src/money.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar**

Criar `packages/kernel/src/money.ts`:

```ts
import { ValidationError } from './errors';
import { err, ok, type Result } from './result';

/** Dinheiro em CENTAVOS inteiros. Float nunca: 0.1 + 0.2 !== 0.3. */
export interface Money {
  readonly cents: number;
  readonly currency: 'BRL';
}

export const ZERO_BRL: Money = Object.freeze({ cents: 0, currency: 'BRL' as const });

export function brl(cents: number): Money {
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(
      'money.centavos_nao_inteiros',
      'valor monetario precisa ser um inteiro de centavos',
      { received: String(cents) },
    );
  }
  return Object.freeze({ cents, currency: 'BRL' as const });
}

export function add(a: Money, b: Money): Money {
  return brl(a.cents + b.cents);
}

export function subtract(a: Money, b: Money): Money {
  return brl(a.cents - b.cents);
}

export function negate(a: Money): Money {
  return brl(-a.cents);
}

export function isZero(a: Money): boolean {
  return a.cents === 0;
}

export function compare(a: Money, b: Money): number {
  if (a.cents === b.cents) return 0;
  return a.cents < b.cents ? -1 : 1;
}

export function sum(values: readonly Money[]): Money {
  return brl(values.reduce((total, money) => total + money.cents, 0));
}

/**
 * Rateio que NAO cria nem perde centavo: a soma das partes e sempre o valor
 * original. Repasse medico, parcelamento e split de recebimento passam por aqui.
 * A sobra vai para o maior resto; empate resolve pelo indice.
 * Nao existe multiply() de proposito: 70% e allocate(m, [70, 30])[0].
 */
export function allocate(money: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) {
    throw new ValidationError('money.rateio.sem_partes', 'rateio precisa de ao menos uma parte');
  }
  if (ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0)) {
    throw new ValidationError('money.rateio.parte_invalida', 'parte de rateio precisa ser finita e nao negativa');
  }
  const totalRatio = ratios.reduce((total, ratio) => total + ratio, 0);
  if (totalRatio <= 0) {
    throw new ValidationError('money.rateio.soma_zero', 'a soma das partes precisa ser maior que zero');
  }

  const sign = money.cents < 0 ? -1 : 1;
  const absolute = Math.abs(money.cents);
  const shares = ratios.map((ratio, index) => {
    const exact = (absolute * ratio) / totalRatio;
    const floorValue = Math.floor(exact);
    return { index, cents: floorValue, remainder: exact - floorValue };
  });

  let rest = absolute - shares.reduce((total, share) => total + share.cents, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const share of byRemainder) {
    if (rest <= 0) break;
    share.cents += 1;
    rest -= 1;
  }

  return shares.map((share) => brl(sign * share.cents));
}

export function formatBRL(money: Money): string {
  const negative = money.cents < 0;
  const absolute = Math.abs(money.cents);
  const reais = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${String(cents).padStart(2, '0')}`;
}

const BRL_PATTERN = /^(-?)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?$/;

export function parseBRL(input: string): Result<Money, ValidationError> {
  const match = BRL_PATTERN.exec(input.trim());
  if (match === null) {
    return err(new ValidationError(
      'money.formato_invalido',
      'valor monetario fora do formato brasileiro',
      { length: input.length },
    ));
  }
  const sign = match[1] === '-' ? -1 : 1;
  const reais = Number((match[2] ?? '0').replace(/\./g, ''));
  const cents = Number(match[3] ?? '0');
  return ok(brl(sign * (reais * 100 + cents)));
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/money.test.ts`
Esperado: PASSA — 11 testes

- [ ] **Passo 5: Publicar no index e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
export * from './uuid';
export * from './clock';
export * from './money';
```

```bash
git add packages/kernel/src
git commit -m "feat(kernel): add integer-cent Money with exact allocation"
```

---

### Task 23: Canonicalização JCS (RFC 8785) com `canonicalVersion`

**Arquivos:**
- Criar: `packages/kernel/src/canonical.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/canonical.test.ts`

§10 item 6 chama isto de **o contrato mais permanente do sistema**. O `content_hash` de `clin.encounter_version` e a assinatura ICP-Brasil cobrem exatamente estes bytes, e o acervo tem guarda de 20 anos. Regra: **`jcs-1` nunca muda**. Se um dia for preciso outro comportamento, cria-se `jcs-2` e o verificador de `jcs-1` fica no repositório para sempre.

`jcs-1` = RFC 8785 (ordem de chave por unidade de código UTF-16, número no formato ECMAScript, escape mínimo, UTF-8 sem espaço) **mais** pré-normalização Unicode NFC de toda string e de toda chave. A RFC deixa normalização fora de escopo; sem ela, "José" digitado no consultório (é precomposto) e "José" importado de planilha (e + acento combinante) produzem hashes diferentes para o mesmo prontuário.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/kernel/src/canonical.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_VERSION, canonicalBytes, canonicalHashHex, canonicalize, type JsonValue,
} from './canonical';
import { ValidationError } from './errors';

// Vetores CONGELADOS. Alterar qualquer linha daqui invalida a verificacao de
// todo o historico assinado. Se o comportamento precisar mudar: 'jcs-2'.
const VETORES: readonly { readonly nome: string; readonly entrada: JsonValue; readonly canonico: string }[] = [
  {
    nome: 'ordem de chaves por unidade de codigo UTF-16',
    entrada: { b: 1, a: 2, 'ä': 3, A: 4, '10': 5, '2': 6 },
    canonico: '{"10":5,"2":6,"A":4,"a":2,"b":1,"ä":3}',
  },
  {
    nome: 'array preserva a ordem de insercao (array nunca e ordenado)',
    entrada: { lista: [3, 1, 2], vazio: {}, nulo: null, ok: true },
    canonico: '{"lista":[3,1,2],"nulo":null,"ok":true,"vazio":{}}',
  },
  {
    nome: 'numeros no formato ECMAScript exigido pela RFC 8785',
    entrada: [0, -0, 1, 1.5, 1e30, 1e-7, 0.000001, 5e-324, 9007199254740991],
    canonico: '[0,0,1,1.5,1e+30,1e-7,0.000001,5e-324,9007199254740991]',
  },
  {
    nome: 'escape minimo: so aspas, contrabarra e caracteres de controle',
    entrada: { t: 'a"b\\c\nd\tef' },
    canonico: '{"t":"a\\"b\\\\c\\nd\\tef"}',
  },
  {
    nome: 'acentuacao sai como UTF-8 literal, sem sequencia \\u',
    entrada: { nome: 'Jos\u00E9 da Silva' },
    canonico: '{"nome":"Jos\u00E9 da Silva"}',
  },
];

// 'e' precomposto = U+00E9. 'e' + U+0301 (acento combinante) e a forma que chega
// de planilha e de importacao de outro sistema. Escritos com escape \u de proposito:
// a diferenca e INVISIVEL no editor, e um arquivo normalizado por engano apagaria
// este teste sem ninguem perceber.
const NOME_PRECOMPOSTO = 'Jos\u00E9 da Silva';
const NOME_DECOMPOSTO = 'Jose\u0301 da Silva';

// Atendimento canonico congelado — os campos que entram no content_hash (§3.4).
const ATENDIMENTO: JsonValue = {
  canonicalVersion: 'jcs-1',
  clinicId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c',
  fields: [
    { code: 'PA_SIS', ordinal: 0, value: 120 },
    { code: 'PA_DIA', ordinal: 1, value: 80 },
    { code: 'QUEIXA', ordinal: 2, value: 'Cefaleia há 3 dias' },
  ],
  occurredAt: '2026-08-03T13:45:00.000Z',
  patientId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d',
  professionalId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e',
};

const ATENDIMENTO_CANONICO =
  '{"canonicalVersion":"jcs-1","clinicId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c",' +
  '"fields":[{"code":"PA_SIS","ordinal":0,"value":120},{"code":"PA_DIA","ordinal":1,"value":80},' +
  '{"code":"QUEIXA","ordinal":2,"value":"Cefaleia há 3 dias"}],' +
  '"occurredAt":"2026-08-03T13:45:00.000Z",' +
  '"patientId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d",' +
  '"professionalId":"0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e"}';

const ATENDIMENTO_SHA256 = '0e8fb87ba8007a7d6f6f72e3ce331da212609d6bf764c9ed36565fe3083131a3';

describe('canonicalizacao JCS', () => {
  it('a versao do canonicalizador e jcs-1 e nunca muda: e ela que fica gravada em cada assinatura', () => {
    expect(CANONICAL_VERSION).toBe('jcs-1');
  });

  for (const vetor of VETORES) {
    it(`vetor congelado: ${vetor.nome}`, () => {
      expect(canonicalize(vetor.entrada)).toBe(vetor.canonico);
    });
  }

  it('normaliza Unicode para NFC: o mesmo nome digitado no consultorio e importado de planilha produz o MESMO hash', () => {
    expect(NOME_PRECOMPOSTO === NOME_DECOMPOSTO).toBe(false);   // sao strings diferentes...
    expect(canonicalize({ nome: NOME_DECOMPOSTO })).toBe('{"nome":"Jos\u00E9 da Silva"}');
    expect(canonicalHashHex({ nome: NOME_DECOMPOSTO }))
      .toBe(canonicalHashHex({ nome: NOME_PRECOMPOSTO }));      // ...e o mesmo prontuario
    expect(canonicalHashHex({ nome: NOME_PRECOMPOSTO }))
      .toBe('27e45a5ae17c164636b9536ff616696b6683e2d40178fdee80498352051ed65c');
  });

  it('normaliza tambem a CHAVE antes de ordenar', () => {
    const decomposta: JsonValue = { ['pressa\u0303o']: 1 };     // 'a' + U+0303
    expect(canonicalize(decomposta)).toBe('{"press\u00E3o":1}');
  });

  it('recusa duas chaves que viram a mesma apos NFC: ambiguidade no hash e inaceitavel', () => {
    const ambiguo = { ['press\u00E3o']: 1, ['pressa\u0303o']: 2 } as JsonValue;
    expect(Object.keys(ambiguo)).toHaveLength(2);               // o objeto REALMENTE tem duas chaves
    expect(() => canonicalize(ambiguo)).toThrow(ValidationError);
  });

  it('congela o hash do atendimento canonico: mudou este valor, mudou o contrato de assinatura de todo o acervo', () => {
    expect(canonicalize(ATENDIMENTO)).toBe(ATENDIMENTO_CANONICO);
    expect(canonicalBytes(ATENDIMENTO)).toHaveLength(379);
    expect(canonicalHashHex(ATENDIMENTO)).toBe(ATENDIMENTO_SHA256);
  });

  it('a ordem em que os campos chegam do formulario nao muda o hash', () => {
    const embaralhado: JsonValue = {
      professionalId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4e',
      patientId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4d',
      occurredAt: '2026-08-03T13:45:00.000Z',
      fields: [
        { ordinal: 0, value: 120, code: 'PA_SIS' },
        { value: 80, code: 'PA_DIA', ordinal: 1 },
        { code: 'QUEIXA', value: 'Cefaleia há 3 dias', ordinal: 2 },
      ],
      clinicId: '0195c8a0-1f4e-7c3a-9b21-6f0a1d2e3b4c',
      canonicalVersion: 'jcs-1',
    };
    expect(canonicalHashHex(embaralhado)).toBe(ATENDIMENTO_SHA256);
  });

  it('recusa o que nao e JSON: undefined, NaN, Infinity e Date sumiriam ou mudariam em silencio', () => {
    expect(() => canonicalize({ a: undefined } as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(Number.NaN as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalize(new Date() as unknown as JsonValue)).toThrow(ValidationError);
  });
});
```

> Este arquivo de teste é o único de `packages/kernel` que contém `new Date(` — e ele termina em `.test.ts`, que a guarda de fonte de tempo da Task 21 ignora de propósito.

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/canonical.test.ts`
Esperado: FALHA com `Failed to resolve import "./canonical" from "packages/kernel/src/canonical.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar**

Criar `packages/kernel/src/canonical.ts`:

```ts
import { createHash } from 'node:crypto';
import { ValidationError } from './errors';

/**
 * Serializacao canonica JCS (RFC 8785) + pre-normalizacao Unicode NFC.
 *
 * ESTA VERSAO NUNCA MUDA. O content_hash de clin.encounter_version e a
 * assinatura ICP-Brasil cobrem exatamente estes bytes, e o acervo tem guarda
 * de 20 anos. Se um dia for preciso outro comportamento, cria-se 'jcs-2' e o
 * verificador de 'jcs-1' permanece no repositorio para sempre.
 */
export const CANONICAL_VERSION = 'jcs-1';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ValidationError('canonical.numero_nao_finito', 'NaN e Infinity nao existem em JSON');
  }
  // RFC 8785: formato Number::toString do ECMAScript. -0 serializa como 0.
  if (Object.is(value, -0)) return '0';
  return String(value);
}

function serializeString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      default:
        // Escape minimo: fora dos controles, o caractere sai literal em UTF-8.
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : value[index];
    }
  }
  return `${out}"`;
}

function serialize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'string') return serializeString(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;

  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError('canonical.tipo_nao_serializavel', 'so objeto simples entra na serializacao canonica');
    }
    const entries: [string, JsonValue][] = [];
    const seen = new Set<string>();
    for (const [rawKey, rawValue] of Object.entries(value)) {
      if (rawValue === undefined) {
        throw new ValidationError('canonical.valor_indefinido', 'campo undefined sumiria do hash em silencio', { key: rawKey });
      }
      const key = rawKey.normalize('NFC');
      if (seen.has(key)) {
        throw new ValidationError('canonical.chave_duplicada', 'duas chaves viram a mesma apos normalizacao NFC', { key });
      }
      seen.add(key);
      entries.push([key, rawValue]);
    }
    // RFC 8785: ordem por unidade de codigo UTF-16 da chave ja normalizada.
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([key, item]) => `${serializeString(key)}:${serialize(item)}`).join(',')}}`;
  }

  throw new ValidationError('canonical.tipo_nao_serializavel', 'valor nao e representavel em JSON');
}

export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

export function canonicalBytes(value: JsonValue): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}

/** SHA-256 dos bytes canonicos: 32 bytes, o mesmo que vai em content_hash bytea. */
export function canonicalHash(value: JsonValue): Buffer {
  return createHash('sha256').update(canonicalBytes(value)).digest();
}

export function canonicalHashHex(value: JsonValue): string {
  return canonicalHash(value).toString('hex');
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/canonical.test.ts`
Esperado: PASSA — 12 testes

- [ ] **Passo 5: Publicar no index e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
export * from './uuid';
export * from './clock';
export * from './money';
export * from './canonical';
```

```bash
git add packages/kernel/src
git commit -m "feat(kernel): add JCS RFC 8785 canonicalization with frozen jcs-1 version"
```

---

### Task 24: Validadores brasileiros — CPF, CNPJ alfanumérico, CNS e CRM

**Arquivos:**
- Criar: `packages/kernel/src/br/cpf.ts`
- Criar: `packages/kernel/src/br/cnpj.ts`
- Criar: `packages/kernel/src/br/cns.ts`
- Criar: `packages/kernel/src/br/crm.ts`
- Modificar: `packages/kernel/src/index.ts`
- Teste: `packages/kernel/src/br/cpf.test.ts`
- Teste: `packages/kernel/src/br/cnpj.test.ts`
- Teste: `packages/kernel/src/br/cns.test.ts`
- Teste: `packages/kernel/src/br/crm.test.ts`

Regra transversal: **a mensagem de erro nunca ecoa o documento**. CPF é dado pessoal e o erro vai para log, Sentry e trilha.

- [ ] **Passo 1: Escrever o teste do CPF que falha**

Criar `packages/kernel/src/br/cpf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCpf, isCpf, parseCpf, type Cpf } from './cpf';
import { isErr, isOk } from '../result';

describe('CPF', () => {
  it('aceita CPF valido com ou sem pontuacao e devolve so os digitos', () => {
    const comPontuacao = parseCpf('529.982.247-25');
    expect(isOk(comPontuacao) && comPontuacao.value).toBe('52998224725');
    const semPontuacao = parseCpf('11144477735');
    expect(isOk(semPontuacao) && semPontuacao.value).toBe('11144477735');
    expect(isCpf('123.456.789-09')).toBe(true);
  });

  it('recusa 000.000.000-00, que a recepcao digita quando o paciente nao tem o documento em maos', () => {
    // Atencao: 000.000.000-00 PASSA no calculo do digito verificador.
    // So a regra de digitos repetidos o elimina — e sem ela esse CPF entra na
    // base, some da busca por duplicidade e contamina guia e relatorio.
    const resultado = parseCpf('000.000.000-00');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.digitos_repetidos');
    expect(isCpf('111.111.111-11')).toBe(false);
    expect(isCpf('99999999999')).toBe(false);
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCpf('529.982.247-26');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.digito_verificador_invalido');
  });

  it('recusa tamanho diferente de 11 digitos', () => {
    const resultado = parseCpf('529.982.247');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cpf.tamanho_invalido');
  });

  it('o erro nao carrega o CPF digitado: ele viaja para log, Sentry e trilha', () => {
    const resultado = parseCpf('529.982.247-26');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('529');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('982');
  });

  it('formata para exibicao', () => {
    expect(formatCpf('52998224725' as Cpf)).toBe('529.982.247-25');
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/br/cpf.test.ts`
Esperado: FALHA com `Failed to resolve import "./cpf" from "packages/kernel/src/br/cpf.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar o CPF**

Criar `packages/kernel/src/br/cpf.ts`:

```ts
import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/** CPF normalizado: 11 digitos, sem pontuacao. */
export type Cpf = string & { readonly __brand: 'Cpf' };

const ALL_EQUAL = /^(\d)\1{10}$/;

/**
 * Digitos verificadores do CPF (modulo 11).
 * 1o DV: digitos 1..9 com pesos 10..2; resto = (soma * 10) % 11; 10 vira 0.
 * 2o DV: digitos 1..9 + 1o DV com pesos 11..2; mesma regra.
 */
function checkDigits(digits: readonly number[]): [number, number] {
  let sum1 = 0;
  for (let i = 0; i < 9; i += 1) sum1 += (digits[i] ?? 0) * (10 - i);
  let first = (sum1 * 10) % 11;
  if (first === 10) first = 0;

  const withFirst = [...digits.slice(0, 9), first];
  let sum2 = 0;
  for (let i = 0; i < 10; i += 1) sum2 += (withFirst[i] ?? 0) * (11 - i);
  let second = (sum2 * 10) % 11;
  if (second === 10) second = 0;

  return [first, second];
}

export function parseCpf(input: string): Result<Cpf, ValidationError> {
  const digits = input.replace(/\D/g, '');

  if (digits.length !== 11) {
    return err(new ValidationError('cpf.tamanho_invalido', 'CPF precisa ter 11 digitos', { length: digits.length }));
  }
  if (ALL_EQUAL.test(digits)) {
    // 000.000.000-00 e 111.111.111-11 passam no modulo 11. So esta regra os pega.
    return err(new ValidationError('cpf.digitos_repetidos', 'CPF com todos os digitos iguais nao existe'));
  }

  const numbers = [...digits].map(Number);
  const [first, second] = checkDigits(numbers);
  if (numbers[9] !== first || numbers[10] !== second) {
    return err(new ValidationError('cpf.digito_verificador_invalido', 'digito verificador do CPF nao confere'));
  }

  return ok(digits as Cpf);
}

export function isCpf(input: string): boolean {
  return parseCpf(input).ok;
}

export function formatCpf(cpf: Cpf): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/br/cpf.test.ts`
Esperado: PASSA — 6 testes

- [ ] **Passo 5: Escrever o teste do CNPJ alfanumérico que falha**

Criar `packages/kernel/src/br/cnpj.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCnpj, isCnpj, parseCnpj, type Cnpj } from './cnpj';
import { isErr, isOk } from '../result';

describe('CNPJ alfanumerico (IN RFB 2.229/2024)', () => {
  it('aceita o CNPJ alfanumerico do exemplo da Receita: 12.ABC.345/01DE-35', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-35');
    expect(isOk(resultado) && resultado.value).toBe('12ABC34501DE35');
  });

  it('continua aceitando CNPJ inteiramente numerico, que nao deixou de existir', () => {
    expect(isCnpj('11.222.333/0001-81')).toBe(true);
    expect(isCnpj('00.000.000/0001-91')).toBe(true);
  });

  it('normaliza para maiuscula: a recepcao digita minusculo', () => {
    const resultado = parseCnpj('12.abc.345/01de-35');
    expect(isOk(resultado) && resultado.value).toBe('12ABC34501DE35');
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-34');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.digito_verificador_invalido');
  });

  it('recusa 00000000000000, que passa no calculo do digito verificador', () => {
    const resultado = parseCnpj('00000000000000');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.caracteres_repetidos');
  });

  it('recusa formato fora de 12 alfanumericos + 2 digitos', () => {
    expect(isErr(parseCnpj('12ABC34501DE3'))).toBe(true);         // curto
    expect(isErr(parseCnpj('12ABC34501DEAB'))).toBe(true);        // DV nao numerico
    expect(isErr(parseCnpj('12.ÇBC.345/01DE-35'))).toBe(true);    // caractere fora de [A-Z0-9]
    const resultado = parseCnpj('12ABC34501DE3');
    expect(isErr(resultado) && resultado.error.code).toBe('cnpj.formato_invalido');
  });

  it('o erro nao carrega o CNPJ digitado', () => {
    const resultado = parseCnpj('12.ABC.345/01DE-34');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('ABC');
  });

  it('formata para exibicao', () => {
    expect(formatCnpj('12ABC34501DE35' as Cnpj)).toBe('12.ABC.345/01DE-35');
    expect(formatCnpj('11222333000181' as Cnpj)).toBe('11.222.333/0001-81');
  });
});
```

- [ ] **Passo 6: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/br/cnpj.test.ts`
Esperado: FALHA com `Failed to resolve import "./cnpj" from "packages/kernel/src/br/cnpj.test.ts". Does the file exist?`

- [ ] **Passo 7: Implementar o CNPJ alfanumérico**

Criar `packages/kernel/src/br/cnpj.ts`:

```ts
import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/**
 * CNPJ ALFANUMERICO — IN RFB 2.229/2024, em vigor desde 01/07/2026.
 * 12 posicoes de base em [A-Z0-9] + 2 digitos verificadores NUMERICOS.
 *
 * O valor de cada caractere no calculo do DV e `codigo ASCII - 48`:
 *   '0' (48) -> 0, '9' (57) -> 9, 'A' (65) -> 17, ..., 'Z' (90) -> 42.
 *
 * E por isso que CNPJ e varchar(14) e nunca coluna numerica — invariante de CI
 * (§3.13 item 8) e decisao irreversivel n. 12.
 */
export type Cnpj = string & { readonly __brand: 'Cnpj' };

const CNPJ_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;
const ALL_EQUAL = /^(.)\1{13}$/;
const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function charValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/** Modulo 11: resto < 2 => DV 0; senao DV = 11 - resto. */
function checkDigits(base: string): string {
  let sum1 = 0;
  for (let i = 0; i < 12; i += 1) sum1 += charValue(base[i] ?? '0') * (WEIGHTS_FIRST[i] ?? 0);
  const rest1 = sum1 % 11;
  const first = rest1 < 2 ? 0 : 11 - rest1;

  const base13 = `${base}${first}`;
  let sum2 = 0;
  for (let i = 0; i < 13; i += 1) sum2 += charValue(base13[i] ?? '0') * (WEIGHTS_SECOND[i] ?? 0);
  const rest2 = sum2 % 11;
  const second = rest2 < 2 ? 0 : 11 - rest2;

  return `${first}${second}`;
}

export function parseCnpj(input: string): Result<Cnpj, ValidationError> {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!CNPJ_PATTERN.test(normalized)) {
    return err(new ValidationError(
      'cnpj.formato_invalido',
      'CNPJ precisa ter 12 posicoes alfanumericas seguidas de 2 digitos',
      { length: normalized.length },
    ));
  }
  if (ALL_EQUAL.test(normalized)) {
    // 00000000000000 passa no modulo 11: so esta regra o elimina.
    return err(new ValidationError('cnpj.caracteres_repetidos', 'CNPJ com todos os caracteres iguais nao existe'));
  }
  if (checkDigits(normalized.slice(0, 12)) !== normalized.slice(12)) {
    return err(new ValidationError('cnpj.digito_verificador_invalido', 'digito verificador do CNPJ nao confere'));
  }

  return ok(normalized as Cnpj);
}

export function isCnpj(input: string): boolean {
  return parseCnpj(input).ok;
}

export function formatCnpj(cnpj: Cnpj): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
```

- [ ] **Passo 8: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/br/cnpj.test.ts`
Esperado: PASSA — 8 testes

- [ ] **Passo 9: Escrever o teste do CNS que falha**

Criar `packages/kernel/src/br/cns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCns, isCns, parseCns, type Cns } from './cns';
import { isErr, isOk } from '../result';

describe('CNS — Cartao Nacional de Saude', () => {
  it('aceita CNS definitivo, que comeca com 1 ou 2', () => {
    expect(isCns('123456789010000')).toBe(true);
    expect(isCns('201234567890018')).toBe(true);
  });

  it('aceita CNS provisorio, que comeca com 7, 8 ou 9', () => {
    expect(isCns('898000000000002')).toBe(true);
  });

  it('aceita com espacos, como vem impresso no cartao', () => {
    const resultado = parseCns('123 4567 8901 0000');
    expect(isOk(resultado) && resultado.value).toBe('123456789010000');
  });

  it('recusa CNS que nao comeca com 1, 2, 7, 8 ou 9', () => {
    const resultado = parseCns('323456789010000');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.faixa_invalida');
  });

  it('recusa digito verificador errado', () => {
    const resultado = parseCns('123456789010001');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.digito_verificador_invalido');
  });

  it('recusa tamanho diferente de 15 digitos', () => {
    const resultado = parseCns('12345');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('cns.tamanho_invalido');
  });

  it('o erro nao carrega o numero digitado', () => {
    const resultado = parseCns('123456789010001');
    expect(isErr(resultado) && JSON.stringify(resultado.error.toJSON())).not.toContain('12345');
  });

  it('formata para exibicao', () => {
    expect(formatCns('123456789010000' as Cns)).toBe('123 4567 8901 0000');
  });
});
```

- [ ] **Passo 10: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/br/cns.test.ts`
Esperado: FALHA com `Failed to resolve import "./cns" from "packages/kernel/src/br/cns.test.ts". Does the file exist?`

- [ ] **Passo 11: Implementar o CNS**

Criar `packages/kernel/src/br/cns.ts`:

```ts
import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

/**
 * CNS — Cartao Nacional de Saude, 15 digitos.
 * Definitivo comeca com 1 ou 2 (derivado do PIS/PASEP); provisorio com 7, 8 ou 9.
 * Em ambos os casos a soma dos digitos ponderada por (15 - posicao) e
 * divisivel por 11 — o DV foi construido para isso.
 */
export type Cns = string & { readonly __brand: 'Cns' };

const VALID_PREFIXES = ['1', '2', '7', '8', '9'];

export function parseCns(input: string): Result<Cns, ValidationError> {
  const digits = input.replace(/\D/g, '');

  if (digits.length !== 15) {
    return err(new ValidationError('cns.tamanho_invalido', 'CNS precisa ter 15 digitos', { length: digits.length }));
  }
  if (!VALID_PREFIXES.includes(digits[0] ?? '')) {
    return err(new ValidationError(
      'cns.faixa_invalida',
      'CNS comeca com 1 ou 2 (definitivo) ou com 7, 8 e 9 (provisorio)',
    ));
  }

  let sum = 0;
  for (let i = 0; i < 15; i += 1) sum += Number(digits[i] ?? '0') * (15 - i);
  if (sum % 11 !== 0) {
    return err(new ValidationError('cns.digito_verificador_invalido', 'digito verificador do CNS nao confere'));
  }

  return ok(digits as Cns);
}

export function isCns(input: string): boolean {
  return parseCns(input).ok;
}

export function formatCns(cns: Cns): string {
  return `${cns.slice(0, 3)} ${cns.slice(3, 7)} ${cns.slice(7, 11)} ${cns.slice(11)}`;
}
```

- [ ] **Passo 12: Rodar e confirmar que passa**

Rodar: `pnpm test packages/kernel/src/br/cns.test.ts`
Esperado: PASSA — 8 testes

- [ ] **Passo 13: Escrever o teste do CRM que falha**

Criar `packages/kernel/src/br/crm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCrm, parseCrm } from './crm';
import { isErr, isOk } from '../result';

describe('CRM', () => {
  it('aceita as formas que o cadastro recebe e devolve numero e UF separados', () => {
    for (const entrada of ['CRM/SP 123456', 'CRM-SP 123456', 'crm/sp 123456', '123456/SP']) {
      const resultado = parseCrm(entrada);
      expect(isOk(resultado), entrada).toBe(true);
      expect(isOk(resultado) && resultado.value).toEqual({ numero: '123456', uf: 'SP' });
    }
  });

  it('remove zeros a esquerda: 0012345 e 12345 sao o mesmo registro e nao podem virar dois profissionais', () => {
    const resultado = parseCrm('CRM/RJ 0012345');
    expect(isOk(resultado) && resultado.value.numero).toBe('12345');
  });

  it('recusa UF que nao existe', () => {
    const resultado = parseCrm('CRM/XX 123456');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('crm.uf_invalida');
  });

  it('recusa numero com letra e numero longo demais', () => {
    expect(isErr(parseCrm('CRM/SP ABC123'))).toBe(true);
    expect(isErr(parseCrm('CRM/SP 12345678'))).toBe(true);
    const resultado = parseCrm('CRM/SP ABC123');
    expect(isErr(resultado) && resultado.error.code).toBe('crm.formato_invalido');
  });

  it('nao inventa digito verificador: registro de conselho nao tem DV nacional, e rejeitar medico legitimo seria pior', () => {
    expect(isOk(parseCrm('CRM/AC 1'))).toBe(true);
    expect(isOk(parseCrm('CRM/SP 9999999'))).toBe(true);
  });

  it('formata no padrao usado em documento assinado', () => {
    expect(formatCrm({ numero: '123456', uf: 'SP' })).toBe('CRM/SP 123456');
  });
});
```

- [ ] **Passo 14: Rodar e confirmar que falha**

Rodar: `pnpm test packages/kernel/src/br/crm.test.ts`
Esperado: FALHA com `Failed to resolve import "./crm" from "packages/kernel/src/br/crm.test.ts". Does the file exist?`

- [ ] **Passo 15: Implementar o CRM**

Criar `packages/kernel/src/br/crm.ts`:

```ts
import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

export type Uf =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO'
  | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI'
  | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

export const UFS: readonly Uf[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/**
 * CRM. NAO existe digito verificador nacional para registro de conselho: a
 * identidade e o par (numero, UF), e a validacao real e a consulta ao CFM.
 * Aqui garantimos so forma e UF existente — inventar DV rejeitaria medico
 * legitimo, e o numero do conselho vai na guia TISS e no documento assinado.
 */
export interface Crm {
  readonly numero: string;
  readonly uf: Uf;
}

const CRM_PATTERN = /^(?:CRM\s*[-/]?\s*([A-Z]{2})\s*[-/]?\s*(\d{1,7})|(\d{1,7})\s*[-/]\s*([A-Z]{2}))$/;

export function parseCrm(input: string): Result<Crm, ValidationError> {
  const normalized = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = CRM_PATTERN.exec(normalized);

  if (match === null) {
    return err(new ValidationError('crm.formato_invalido', 'CRM fora do formato CRM/UF numero'));
  }

  const uf = (match[1] ?? match[4] ?? '') as Uf;
  const numero = (match[2] ?? match[3] ?? '').replace(/^0+(?=\d)/, '');

  if (!UFS.includes(uf)) {
    return err(new ValidationError('crm.uf_invalida', 'UF do conselho nao existe', { uf }));
  }

  return ok({ numero, uf });
}

export function formatCrm(crm: Crm): string {
  return `CRM/${crm.uf} ${crm.numero}`;
}
```

- [ ] **Passo 16: Rodar a suíte inteira e confirmar que passa**

Rodar: `pnpm test`
Esperado: PASSA — toda a suíte de unidade do `kernel` e do `tools`

- [ ] **Passo 17: Publicar no index, checar tipos e commitar**

Substituir o conteúdo de `packages/kernel/src/index.ts` por:

```ts
export * from './result';
export * from './errors';
export * from './uuid';
export * from './clock';
export * from './money';
export * from './canonical';
export * from './br/cpf';
export * from './br/cnpj';
export * from './br/cns';
export * from './br/crm';
```

Rodar: `pnpm typecheck`
Esperado: sem erro

```bash
git add packages/kernel/src
git commit -m "feat(kernel): add CPF, alphanumeric CNPJ, CNS and CRM validators"
```

---
## Parte IV — Trilha de auditoria

> **Contexto que o engenheiro precisa antes de começar.**
>
> A trilha de auditoria é uma obrigação regulatória brasileira (norma NGS1.07 da Sociedade Brasileira de Informática em Saúde) e, ao mesmo tempo, um argumento de venda do produto. Ela registra **que** algo aconteceu — quem, quando, em qual entidade, com qual desfecho — e **nunca** registra **o que** foi escrito. Um pacote de auditoria genérico (os de Laravel/Django, por exemplo) grava o *diff* do modelo; isso é exatamente o que a NGS1.07.06 proíbe, porque o diff carrega queixa, CID e resultado de exame para dentro de uma tabela que é lida por perfis administrativos.
>
> Três consequências estruturais que aparecem em todas as tarefas abaixo:
>
> 1. O schema `audit` pertence a um papel de banco próprio, `audit_owner`. Nem `app_owner` (que roda as migrations) nem `app_rw` (o papel funcional da aplicação) conseguem escrever nele. A aplicação só tem `SELECT`.
> 2. A tabela tem `ENABLE ROW LEVEL SECURITY` **e** `FORCE ROW LEVEL SECURITY`. O `FORCE` faz a RLS valer inclusive para o dono da tabela. Isso é o que torna a policy de INSERT da Task 26 obrigatória e não opcional.
> 3. `entity_id` é `uuid` e guarda uma **referência** (o id interno da linha). Nunca conteúdo. UUID interno é referência; CPF, CNS, nome e texto clínico jamais entram na trilha.
>
> **Regra de módulo:** `packages/audit` e `packages/db` são irmãos em L0 e não se importam (§2.2). Por isso os testes desta parte **não** chamam `runMigrations()`: eles assumem que `pnpm db:migrate` já rodou, exatamente como um passo de cada tarefa manda.

---

### Task 25: Schema `audit`, whitelist de chaves e a tabela `audit.event`

Esta tarefa cria o esqueleto: o schema, a função que implementa a whitelist de chaves do campo `meta`, a tabela particionada e as primeiras partições. Ainda **sem** GRANTs, RLS ou trigger — isso vem nas Tasks 26 e 27.

Por que `meta` tem whitelist e não blacklist: uma blacklist só barra o que alguém lembrou de listar. Com whitelist, qualquer chave nova exige uma migration revisada, e um `meta: { queixa_principal: '...' }` escrito por descuido numa sexta-feira falha no primeiro teste, não seis meses depois num pedido de exportação da trilha.

Por que a tabela é particionada por `RANGE (occurred_at)`: a trilha cresce mais rápido que o domínio (toda leitura de prontuário gera evento) e a exportação NGS1.07.08 é sempre recortada por período. Sem particionamento desde o dia 1, a coluna de partição não existe e a chave primária teria que ser recriada numa tabela onde `UPDATE` está revogado — ou seja, seria irrecuperável.

**Arquivos:**
- Criar: `packages/db/migrations/0008_audit_schema_event.sql`
- Modificar: `packages/audit/package.json` (acrescentar a dependência `pg`)
- Criar: `packages/audit/test/helpers/pg.ts`
- Teste: `packages/audit/test/schema.int.test.ts`

- [ ] **Passo 1: Instalar a dependência do pacote**

```bash
pnpm add pg --filter @cadencia/audit
pnpm add -D @types/pg --filter @cadencia/audit
```

- [ ] **Passo 2: Escrever o helper de conexão dos testes**

Criar `packages/audit/test/helpers/pg.ts`:

```ts
import { Client } from 'pg';

const ROLE_RE = /^[a-z_][a-z0-9_]*$/;

function adminUrl(): string {
  const connectionString = process.env.DATABASE_URL_ADMIN;
  if (!connectionString) {
    throw new Error('DATABASE_URL_ADMIN ausente: rode `cp .env.example .env`, `pnpm db:up` e `pnpm db:migrate`');
  }
  return connectionString;
}

/**
 * Abre uma conexao no banco local e assume o papel pedido.
 * A URL administrativa e a do superusuario do container; o SET ROLE e o que faz
 * a RLS valer, porque um superusuario que assume papel comum passa a ser filtrado.
 */
export async function connectAs(role: string): Promise<Client> {
  if (!ROLE_RE.test(role)) {
    throw new Error(`invalid role name: ${role}`);
  }
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  await client.query(`SET ROLE ${role}`);
  return client;
}

/**
 * Abre uma conexao SEM SET ROLE: continua superusuario. Usado para ler a trilha
 * nos testes (a RLS forcada da Task 26 nao deixa nem o dono da tabela ler) e,
 * na Task 27, para provar que o trigger detem inclusive o superusuario.
 */
export async function connectSuperuser(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  return client;
}

/**
 * Preambulo de contexto. O terceiro argumento de set_config e sempre TRUE:
 * o escopo e a TRANSACAO, nunca a sessao. Com PgBouncer em transaction mode a
 * conexao e reciclada entre tenants e um SET de sessao vazaria o tenant anterior.
 * Chame sempre depois de um BEGIN.
 */
export async function setContext(
  client: Client,
  ctx: {
    tenantId?: string;
    userId?: string;
    actorKind: 'user' | 'system' | 'anon';
    requestId?: string;
    sessionId?: string;
  },
): Promise<void> {
  await client.query(
    `SELECT set_config('app.tenant_id',  $1, TRUE),
            set_config('app.user_id',    $2, TRUE),
            set_config('app.actor_kind', $3, TRUE),
            set_config('app.request_id', $4, TRUE),
            set_config('app.session_id', $5, TRUE)`,
    [
      ctx.tenantId ?? '',
      ctx.userId ?? '',
      ctx.actorKind,
      ctx.requestId ?? '',
      ctx.sessionId ?? '',
    ],
  );
}
```

- [ ] **Passo 3: Escrever o teste que falha**

Criar `packages/audit/test/schema.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

const TENANT_A = '0192f8a0-0000-7000-8000-00000000000a';
const ENCOUNTER = '0192f8a0-0000-7000-8000-0000000000e1';

async function insertEvent(
  owner: Client,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const row = {
    tenant_id: TENANT_A,
    actor_kind: 'user',
    event_type: 'ENCOUNTER_FINALIZE',
    entity_schema: 'clin',
    entity_table: 'encounter_version',
    entity_id: ENCOUNTER,
    outcome: 'sucesso',
    meta: JSON.stringify({ version_no: 1, kind: 'original' }),
    ...overrides,
  };
  await owner.query(
    `INSERT INTO audit.event
       (tenant_id, actor_kind, event_type, entity_schema, entity_table,
        entity_id, outcome, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      row.tenant_id,
      row.actor_kind,
      row.event_type,
      row.entity_schema,
      row.entity_table,
      row.entity_id,
      row.outcome,
      row.meta,
    ],
  );
}

describe('audit.event: a trilha registra que algo aconteceu, nunca o que foi escrito', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('a migration da auditoria depende de app_owner ser membro de audit_owner', async () => {
    const res = await root.query<{ ok: boolean }>(
      `SELECT pg_has_role('app_owner', 'audit_owner', 'MEMBER') AS ok`,
    );
    expect(res.rows[0]?.ok).toBe(true);
  });

  it('aceita evento cujo meta so tem chaves da whitelist', async () => {
    await insertEvent(owner, {
      meta: JSON.stringify({ version_no: 3, kind: 'retificacao', use_case: 'emr.amend' }),
    });

    const res = await root.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE tenant_id = $1 AND meta ? 'use_case'`,
      [TENANT_A],
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('recusa evento cujo meta traz o nome do paciente (chave fora da whitelist)', async () => {
    await expect(
      insertEvent(owner, {
        meta: JSON.stringify({ patient_name: 'Maria das Dores da Silva' }),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('recusa evento cujo meta traz conteudo clinico', async () => {
    await expect(
      insertEvent(owner, {
        meta: JSON.stringify({ queixa_principal: 'cefaleia ha 3 dias', cid: 'J45' }),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('recusa meta que nao seja objeto json', async () => {
    await expect(
      insertEvent(owner, { meta: JSON.stringify(['J45', 'I10']) }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
  });

  it('entity_id e uuid: nao aceita texto clinico como identificador de entidade', async () => {
    await expect(
      insertEvent(owner, { entity_id: 'Hipertensao arterial essencial' }),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('tentativa sem contexto tambem e evento: tenant_id aceita NULL', async () => {
    await insertEvent(owner, {
      tenant_id: null,
      actor_kind: 'anon',
      event_type: 'SESSION_LOGIN',
      entity_schema: 'id',
      entity_table: 'user',
      entity_id: null,
      outcome: 'negado',
      meta: JSON.stringify({ reason: 'tenant_ausente' }),
    });

    const res = await root.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE tenant_id IS NULL AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('a tabela e particionada por occurred_at e tem particao para hoje', async () => {
    const res = await root.query<{ strategy: string; parts: string }>(
      `SELECT p.partstrat AS strategy,
              (SELECT count(*) FROM pg_inherits i WHERE i.inhparent = c.oid)::text AS parts
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_partitioned_table p ON p.partrelid = c.oid
        WHERE n.nspname = 'audit' AND c.relname = 'event'`,
    );
    expect(res.rows[0]?.strategy).toBe('r');
    expect(Number(res.rows[0]?.parts)).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Passo 4: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/schema.int.test.ts`
Esperado: FALHA com `error: schema "audit" does not exist` (SQLSTATE `3F000`) já no primeiro `it`, e todos os demais casos vermelhos.

- [ ] **Passo 5: Escrever a migration**

Rodar: `pnpm db:new audit_schema_event` — cria `packages/db/migrations/0008_audit_schema_event.sql`. Preencher com exatamente:

```sql
-- 0008_audit_schema_event.sql
-- Trilha de auditoria (NGS1.07). O schema pertence a audit_owner: nem app_owner
-- (dono das migrations) nem app_rw (papel funcional da aplicacao) escrevem nele.
-- Em producao a migration roda como app_owner, que e membro de audit_owner (0001).

CREATE SCHEMA audit AUTHORIZATION audit_owner;

SET ROLE audit_owner;

-- NGS1.07.06: a trilha registra QUE algo aconteceu, nunca O QUE foi escrito.
-- 'meta' aceita apenas chaves desta whitelist. Chave nova exige migration
-- revisada; e isso que impede um `meta: { queixa: ... }` de virar vazamento.
CREATE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',      -- motivo de negacao, de quebra-vidro, de expurgo
              'route',       -- rota HTTP, sem query string
              'method',      -- verbo HTTP
              'status_code',
              'duration_ms',
              'use_case',    -- caso de uso de leitura (deduplicacao, §3.7)
              'record_count',
              'version_no',
              'kind',        -- original | retificacao | adendo | ...
              'role',
              'grant_id',    -- concessao de break-glass
              'ticket',      -- chamado do suporte
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id'
            )
         );
$$;

CREATE TABLE audit.event (
  id bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  tenant_id uuid,                      -- NULLABLE: tentativa sem contexto tambem e evento
  clinic_id uuid,                      -- carimbado NO EVENTO, nao na hora de exportar
  actor_user_id uuid, actor_kind text NOT NULL,
  event_type text NOT NULL,
  entity_schema text NOT NULL, entity_table text NOT NULL,
  entity_id uuid,                      -- REFERENCIA, nunca conteudo (NGS1.07.06)
  outcome text NOT NULL CHECK (outcome IN ('sucesso','negado','erro')),
  ip inet, session_id uuid, request_id uuid, user_agent_hash bytea,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT meta_sem_pii CHECK (audit.meta_keys_ok(meta))   -- whitelist de chaves
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ix_audit_tenant ON audit.event (tenant_id, occurred_at DESC, id);

-- Particoes mensais. Sem particao o INSERT falha com
-- "no partition of relation \"event\" found for row".
DO $$
DECLARE
  v_from date;
  v_to   date;
  v_name text;
BEGIN
  FOR i IN 0..5 LOOP
    v_from := (date_trunc('month', now()) + (i || ' month')::interval)::date;
    v_to   := (v_from + interval '1 month')::date;
    v_name := 'event_' || to_char(v_from, 'YYYYMM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS audit.%I PARTITION OF audit.event
         FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
  END LOOP;
END $$;

RESET ROLE;
```

- [ ] **Passo 6: Aplicar a migration e confirmar que o teste passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/schema.int.test.ts
```

Esperado: `aplicada: 0008_audit_schema_event.sql` e PASSA, 8 testes verdes.

- [ ] **Passo 7: Confirmar que a suíte de isolamento continua verde**

Rodar: `pnpm test:iso`
Esperado: PASSA. A varredura de catálogo do T1 agora encontra também `audit.event` e suas partições — que **ainda não têm RLS**. Se algum teste de RLS reprovar aqui, é a Task 26 que resolve: siga em frente e volte a rodar `pnpm test:iso` ao final dela.

- [ ] **Passo 8: Commitar**

```bash
git add packages/db/migrations/0008_audit_schema_event.sql \
        packages/audit/package.json pnpm-lock.yaml \
        packages/audit/test/helpers/pg.ts \
        packages/audit/test/schema.int.test.ts
git commit -m "feat(audit): partitioned audit.event with meta key whitelist"
```

---

### Task 26: GRANTs, RLS forçada e a policy de INSERT sem a qual a trilha nasce morta

> **Leia este parágrafo antes de escrever qualquer linha. É a correção mais barata e mais crítica do desenho inteiro.**
>
> `audit.event` tem `FORCE ROW LEVEL SECURITY`. Sem o `FORCE`, o dono da tabela escapa da RLS — e o dono é justamente quem escreve na trilha, através de funções `SECURITY DEFINER`. Com o `FORCE`, **o próprio dono passa a ser filtrado**. Se existir só a policy de leitura (`tenant_read`, para `app_rw`) e faltar a policy de INSERT (`writer`, para `audit_owner`), acontece isto, em cadeia, no primeiro deploy:
>
> 1. A recepcionista finaliza o primeiro atendimento do dia.
> 2. `clin.finalize_encounter()` chama `audit.log(...)` dentro da mesma transação.
> 3. O INSERT em `audit.event` não casa com nenhuma policy permissiva de INSERT → `new row violates row-level security policy for table "event"`, SQLSTATE `42501`.
> 4. A exceção aborta a transação de negócio inteira.
> 5. **Nenhum atendimento pode ser finalizado.** O produto sobe verde no CI, o deploy passa, e o sistema é inutilizável às 8h da manhã.
>
> O teste `a trilha nasce morta se a policy writer sumir` do Passo 1 existe para que essa falha apareça no repositório e não na clínica. Ele derruba a policy dentro de uma transação, prova que o INSERT quebra exatamente com `42501`, e faz `ROLLBACK`.

Esta tarefa também aplica RLS às partições. A regra de CI do projeto é "toda tabela **ou partição** em `app clin fin tiss audit` tem `tenant_id`, RLS habilitada, forçada e ≥1 policy". Partições só são alcançáveis pelo pai (elas não recebem nenhum GRANT), mas a regra é varrida do catálogo e não abre exceção — por isso a função `audit.ensure_partitions` cria a partição **já com** RLS e policies.

**Arquivos:**
- Criar: `packages/db/migrations/0009_audit_grants_rls.sql`
- Teste: `packages/audit/test/grants-rls.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/grants-rls.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';

const TENANT_A = '0192f8a0-0000-7000-8000-00000000010a';
const TENANT_B = '0192f8a0-0000-7000-8000-00000000010b';

const INSERT_SQL = `
  INSERT INTO audit.event
    (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
  VALUES ($1, 'system', 'ENCOUNTER_FINALIZE', 'clin', 'encounter_version', 'sucesso', '{}'::jsonb)`;

describe('audit.event: privilegios e RLS', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
    await owner.query(INSERT_SQL, [TENANT_A]);
    await owner.query(INSERT_SQL, [TENANT_B]);
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('o dono da trilha consegue inserir: a policy writer existe', async () => {
    await expect(owner.query(INSERT_SQL, [TENANT_A])).resolves.toBeTruthy();
  });

  it('a trilha nasce morta se a policy writer sumir: o INSERT do dono viola a RLS', async () => {
    await owner.query('BEGIN');
    await owner.query('DROP POLICY writer ON audit.event');

    // Este e exatamente o erro que quebraria clin.finalize_encounter no
    // primeiro deploy: a transacao de negocio aborta e nenhum atendimento
    // pode ser finalizado.
    await expect(owner.query(INSERT_SQL, [TENANT_A])).rejects.toMatchObject({
      code: '42501',
    });

    await owner.query('ROLLBACK');

    // E depois do rollback a trilha volta a funcionar.
    await expect(owner.query(INSERT_SQL, [TENANT_A])).resolves.toBeTruthy();
  });

  it('a aplicacao nao tem INSERT, UPDATE nem DELETE na trilha', async () => {
    const res = await root.query<{ ins: boolean; upd: boolean; del: boolean; sel: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins,
              has_table_privilege('app_rw', 'audit.event', 'UPDATE') AS upd,
              has_table_privilege('app_rw', 'audit.event', 'DELETE') AS del,
              has_table_privilege('app_rw', 'audit.event', 'SELECT') AS sel`,
    );
    expect(res.rows[0]).toEqual({ ins: false, upd: false, del: false, sel: true });
  });

  it('o INSERT direto de app_rw e barrado por privilegio, antes mesmo da RLS', async () => {
    const app = await connectAs('app_rw');
    try {
      await expect(app.query(INSERT_SQL, [TENANT_A])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await app.end();
    }
  });

  it('app_rw so enxerga eventos do proprio tenant', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT_A, actorKind: 'system' });
      const res = await app.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM audit.event',
      );
      await app.query('ROLLBACK');
      expect(res.rows.map((r) => r.tenant_id)).toEqual([TENANT_A]);
    } finally {
      await app.end();
    }
  });

  it('sem preambulo de contexto, app_rw le zero linhas da trilha', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      const res = await app.query<{ n: string }>('SELECT count(*) AS n FROM audit.event');
      await app.query('ROLLBACK');
      expect(Number(res.rows[0]?.n)).toBe(0);
    } finally {
      await app.end();
    }
  });

  it('RLS esta habilitada E forcada no pai e em toda particao', async () => {
    const res = await root.query<{ relname: string; rowsecurity: boolean; forced: boolean; policies: string }>(
      `SELECT c.relname,
              c.relrowsecurity AS rowsecurity,
              c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::text AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relkind IN ('r','p')
          AND (c.relname = 'event' OR c.relname LIKE 'event\\_%')`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(7);
    for (const row of res.rows) {
      expect({ t: row.relname, rls: row.rowsecurity, forced: row.forced }).toEqual({
        t: row.relname,
        rls: true,
        forced: true,
      });
      expect(Number(row.policies)).toBeGreaterThanOrEqual(1);
    }
  });

  it('audit.ensure_partitions cria particao futura ja com RLS forcada e policies', async () => {
    await root.query('SELECT audit.ensure_partitions(9)');
    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname LIKE 'event\\_%'
          AND c.relrowsecurity AND c.relforcerowsecurity
          AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) >= 2`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(9);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/grants-rls.int.test.ts`
Esperado: FALHA. O caso `a trilha nasce morta...` falha com `error: policy "writer" for table "event" does not exist` (`42704`), e `RLS esta habilitada E forcada` falha com `expected false to equal true`.

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_grants_rls` — cria `packages/db/migrations/0009_audit_grants_rls.sql`. Preencher com exatamente:

```sql
-- 0009_audit_grants_rls.sql
-- Privilegios e RLS da trilha. A aplicacao LE a trilha e nunca escreve nela.

SET ROLE audit_owner;

REVOKE ALL ON audit.event FROM PUBLIC, app_rw, app_owner;
GRANT USAGE ON SCHEMA audit TO app_rw;
GRANT SELECT ON audit.event TO app_rw;          -- e nada mais: sem INSERT direto

ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.event FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON audit.event AS PERMISSIVE FOR SELECT TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());

-- SEM ESTA POLICY A TRILHA NASCE MORTA: com FORCE RLS o proprio dono e filtrado,
-- e a funcao SECURITY DEFINER (que roda como audit_owner) nao conseguiria inserir.
-- Consequencia concreta: clin.finalize_encounter chama audit.log, o INSERT viola
-- a RLS, a transacao aborta e nenhum atendimento pode ser finalizado.
CREATE POLICY writer ON audit.event AS PERMISSIVE FOR INSERT TO audit_owner WITH CHECK (true);

-- Particoes: so sao alcancadas pelo pai (nao recebem GRANT nenhum), mas a regra
-- de CI varre o catalogo e exige RLS habilitada, forcada e >= 1 policy em toda
-- particao. A funcao abaixo cria a particao ja em conformidade.
CREATE FUNCTION audit.ensure_partitions(p_months int DEFAULT 6) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_from date;
  v_to   date;
  v_name text;
  v_made int := 0;
BEGIN
  FOR i IN 0 .. greatest(p_months, 1) - 1 LOOP
    v_from := (date_trunc('month', now()) + (i || ' month')::interval)::date;
    v_to   := (v_from + interval '1 month')::date;
    v_name := 'event_' || to_char(v_from, 'YYYYMM');

    IF NOT EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'audit' AND c.relname = v_name) THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.event FOR VALUES FROM (%L) TO (%L)',
        v_name, v_from, v_to);
      v_made := v_made + 1;
    END IF;

    EXECUTE format('ALTER TABLE audit.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('ALTER TABLE audit.%I FORCE  ROW LEVEL SECURITY', v_name);

    IF NOT EXISTS (SELECT 1 FROM pg_policy p
                     JOIN pg_class c ON c.oid = p.polrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'audit' AND c.relname = v_name
                      AND p.polname = 'tenant_read') THEN
      EXECUTE format(
        'CREATE POLICY tenant_read ON audit.%I AS PERMISSIVE FOR SELECT TO app_rw
           USING (tenant_id = app.current_tenant_id() AND app.is_member())', v_name);
      EXECUTE format(
        'CREATE POLICY writer ON audit.%I AS PERMISSIVE FOR INSERT TO audit_owner
           WITH CHECK (true)', v_name);
    END IF;
  END LOOP;
  RETURN v_made;
END $$;

-- Aplica a conformidade as particoes ja criadas pela 0008.
SELECT audit.ensure_partitions(6);

RESET ROLE;
```

- [ ] **Passo 4: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/grants-rls.int.test.ts
```

Esperado: PASSA, 8 testes verdes.

- [ ] **Passo 5: Confirmar que a Task 25 e a suíte de isolamento continuam verdes**

Rodar:

```bash
pnpm test:int
pnpm test:iso
```

Esperado: PASSA nas duas. Os testes da Task 25 leem a trilha pelo superusuário, que não é filtrado pela RLS; e `audit.event` agora satisfaz a varredura de catálogo do T1.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0009_audit_grants_rls.sql \
        packages/audit/test/grants-rls.int.test.ts
git commit -m "feat(audit): forced RLS with read policy and owner insert policy"
```

---

### Task 27: Trigger `no_mutate` — a trilha resiste inclusive ao superusuário

`REVOKE` protege a trilha de `app_rw` e de `app_owner`. Não protege de superusuário: dentro do banco, superusuário sempre vence `REVOKE` e sempre vence RLS. Trigger, não. Um `BEFORE UPDATE OR DELETE` que levanta exceção dispara para **qualquer** papel, inclusive superusuário e inclusive `jobs` (que tem `BYPASSRLS`). É a última linha de defesa, e é a única que o `pg_dump`/`psql` de um administrador distraído não atravessa.

Por isso o teste desta tarefa roda como **superusuário**, sem `SET ROLE`: é o único ator contra o qual o trigger tem algo a provar.

**Arquivos:**
- Criar: `packages/db/migrations/0010_audit_no_mutate.sql`
- Teste: `packages/audit/test/no-mutate.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/no-mutate.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

const TENANT = '0192f8a0-0000-7000-8000-00000000020a';

describe('audit.event e append-only por trigger, nao por convencao', () => {
  let owner: Client;
  let root: Client;

  beforeAll(async () => {
    owner = await connectAs('audit_owner');
    root = await connectSuperuser();
    await owner.query(
      `INSERT INTO audit.event
         (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
       VALUES ($1, 'system', 'SEAL_RUN', 'audit', 'seal', 'sucesso', '{}'::jsonb)`,
      [TENANT],
    );
  });

  afterAll(async () => {
    await owner.end();
    await root.end();
  });

  it('UPDATE levanta excecao mesmo para o superusuario', async () => {
    await expect(
      root.query(`UPDATE audit.event SET outcome = 'sucesso' WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('append-only'),
    });
  });

  it('DELETE levanta excecao mesmo para o superusuario', async () => {
    await expect(
      root.query(`DELETE FROM audit.event WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({
      code: '42501',
      message: expect.stringContaining('append-only'),
    });
  });

  it('a linha continua la depois das duas tentativas', async () => {
    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event WHERE tenant_id = $1`,
      [TENANT],
    );
    expect(Number(res.rows[0]?.n)).toBe(1);
  });

  it('a mensagem da excecao nomeia a operacao recusada', async () => {
    await expect(
      root.query(`DELETE FROM audit.event WHERE tenant_id = $1`, [TENANT]),
    ).rejects.toMatchObject({ message: expect.stringContaining('DELETE') });
  });

  it('o trigger existe no pai e cobre UPDATE e DELETE', async () => {
    const res = await root.query<{ tgname: string; def: string }>(
      `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname = 'event' AND NOT t.tgisinternal`,
    );
    expect(res.rows[0]?.tgname).toBe('no_mutate');
    expect(res.rows[0]?.def).toContain('BEFORE UPDATE OR DELETE');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/no-mutate.int.test.ts`
Esperado: FALHA — o `UPDATE` **passa** (não há trigger), então o `expect(...).rejects` falha com `promise resolved instead of rejecting`, e o último caso falha com `expected undefined to be 'no_mutate'`.

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_no_mutate` — cria `packages/db/migrations/0010_audit_no_mutate.sql`. Preencher com exatamente:

```sql
-- 0010_audit_no_mutate.sql
-- REVOKE detem app_rw e app_owner. Nao detem superusuario nem o papel jobs
-- (BYPASSRLS). Trigger detem: dispara para qualquer papel, sem excecao.

SET ROLE audit_owner;

CREATE FUNCTION audit.deny() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.event e append-only: % nao e permitido nesta tabela', TG_OP
    USING ERRCODE = '42501',
          HINT = 'A trilha so aceita INSERT. Correcao de registro se faz com evento novo.';
END $$;

CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.deny();

RESET ROLE;
```

- [ ] **Passo 4: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/no-mutate.int.test.ts
```

Esperado: PASSA, 5 testes verdes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/migrations/0010_audit_no_mutate.sql \
        packages/audit/test/no-mutate.int.test.ts
git commit -m "feat(audit): no_mutate trigger makes audit.event append-only for every role"
```

---

## Parte IV (continuação) — Trilha de auditoria

> **Onde esta parte continua.** As Tasks 25 a 27 já entregaram o esqueleto da trilha: o schema `audit` com dono próprio, a whitelist de chaves de `meta`, a tabela particionada `audit.event`, os GRANTs, a RLS **forçada** com as policies `tenant_read` e `writer`, e o trigger `no_mutate`. O que falta é o que **escreve** na trilha e o que a torna verificável: os dois canais de gravação (§3.7), a auditoria de leitura deduplicada e o selo diário.
>
> **Convenções que valem para as quatro tarefas seguintes.**
>
> - Migrations continuam em `packages/db/migrations/`, criadas com `pnpm db:new <nome>` e aplicadas com `pnpm db:migrate`. As faixas `0001`–`0010` já foram usadas; esta parte usa `0011`–`0014`.
> - Os testes ficam em `packages/audit/test/`, terminam em `.int.test.ts`, rodam com `pnpm test:int <caminho>` e usam o helper `packages/audit/test/helpers/pg.ts` criado na Task 25 (`connectAs`, `connectSuperuser`, `setContext`). Eles **não** chamam `runMigrations()`: `packages/audit` e `packages/db` são irmãos em L0 e não se importam (§2.2). Cada tarefa manda rodar `pnpm db:migrate` explicitamente.
> - `pnpm test:int` roda com `fileParallelism: false` (já configurado em `vitest.int.config.ts`, Task 1). Isso **não é detalhe**: os arquivos deste pacote mantêm transações abertas de propósito e, com arquivos em paralelo, a marca d'água do selo (Task 31) enxerga a transação de outro arquivo e adia o selo, deixando a suíte vermelha de forma intermitente.
> - Imports sem extensão `.js` (o projeto usa `moduleResolution: Bundler`).

---

### Task 28: Canal A — evento de domínio, dentro da transação de negócio

São **dois canais de gravação**, por razões diferentes. Este é o A.

| Canal | O quê | Como | Por quê |
|---|---|---|---|
| **A — domínio** | Finalização, retificação, exportação, envio de lote | Dentro da transação de negócio | **O evento só é verdade se a escrita commitou** |
| B — segurança e acesso | Login, acesso negado, leitura de prontuário, break-glass, tentativa sem contexto | Pool dedicado, fora da transação | Evento de negação é o que o auditor procura (Task 29) |

O Canal A é gravado **dentro** da transação de propósito. Se `clin.finalize_encounter()` der `ROLLBACK`, o evento `ENCOUNTER_FINALIZE` tem que sumir junto: uma trilha que afirma que um atendimento foi finalizado quando ele não foi é pior que não ter trilha, porque é prova documental de um fato falso. O teste do Passo 1 verifica exatamente isso, nas duas direções.

`audit.log` é `SECURITY DEFINER`: roda como `audit_owner` e portanto casa com a policy `writer` da Task 26. A aplicação (`app_rw`) recebe apenas `EXECUTE` — nunca `INSERT`.

**Arquivos:**
- Criar: `packages/db/migrations/0011_audit_log.sql`
- Criar: `packages/audit/src/domain.ts`
- Modificar: `packages/audit/src/index.ts`
- Teste: `packages/audit/test/channel-a.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/channel-a.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';
import { logDomainEvent } from '../src/domain';

// Os quatro UUIDs sao DISTINTOS de proposito: se `audit.log` trocar duas colunas
// de lugar, o teste do mapeamento abaixo tem que ficar vermelho.
const TENANT = '0192f8a0-0000-7000-8000-00000000030a';
const USER = '0192f8a0-0000-7000-8000-000000000301';
const VERSION = '0192f8a0-0000-7000-8000-000000000302';
const REQUEST = '0192f8a0-0000-7000-8000-000000000303';

async function countEvents(root: Client, eventType: string): Promise<number> {
  const res = await root.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit.event
      WHERE tenant_id = $1 AND event_type = $2`,
    [TENANT, eventType],
  );
  return Number(res.rows[0]?.n);
}

describe('Canal A: o evento de dominio so e verdade se a escrita commitou', () => {
  let root: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
  });

  afterAll(async () => {
    await root.end();
  });

  it('grava o evento na mesma transacao do negocio e ele sobrevive ao commit', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, {
        tenantId: TENANT,
        userId: USER,
        actorKind: 'system',
        requestId: REQUEST,
      });
      const id = await logDomainEvent(app, {
        eventType: 'ENCOUNTER_FINALIZE',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: VERSION,
        meta: { version_no: 1, kind: 'original' },
      });
      expect(id).toBeGreaterThan(0n);
      await app.query('COMMIT');
    } finally {
      await app.end();
    }

    const res = await root.query<{
      tenant_id: string;
      entity_id: string;
      actor_user_id: string;
      outcome: string;
      request_id: string;
      entity_schema: string;
      entity_table: string;
      meta: Record<string, unknown>;
    }>(
      `SELECT tenant_id, entity_id, actor_user_id, outcome, request_id,
              entity_schema, entity_table, meta
         FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'ENCOUNTER_FINALIZE'`,
      [TENANT],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toEqual({
      tenant_id: TENANT,
      entity_id: VERSION,
      actor_user_id: USER,
      request_id: REQUEST,
      outcome: 'sucesso',
      entity_schema: 'clin',
      entity_table: 'encounter_version',
      meta: { version_no: 1, kind: 'original' },
    });
  });

  it('o evento de dominio desaparece se a transacao de negocio faz rollback', async () => {
    const antes = await countEvents(root, 'ENCOUNTER_AMEND');

    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'system' });
      await logDomainEvent(app, {
        eventType: 'ENCOUNTER_AMEND',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: VERSION,
        meta: { version_no: 2, kind: 'retificacao' },
      });
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    // Trilha que afirma uma retificacao que nao aconteceu e prova documental
    // de um fato falso: pior que nao ter trilha.
    expect(await countEvents(root, 'ENCOUNTER_AMEND')).toBe(antes);
  });

  it('o ator de sistema (worker, sem user_id) grava sem estourar em uuid vazio', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, actorKind: 'system' });
      await logDomainEvent(app, {
        eventType: 'TISS_BATCH_SUBMIT',
        entitySchema: 'tiss',
        entityTable: 'lote',
        meta: { batch_id: 'lote-2026-08', record_count: 42 },
      });
      await app.query('COMMIT');
    } finally {
      await app.end();
    }

    const res = await root.query<{ actor_user_id: string | null; actor_kind: string }>(
      `SELECT actor_user_id, actor_kind FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'TISS_BATCH_SUBMIT'`,
      [TENANT],
    );
    expect(res.rows[0]).toEqual({ actor_user_id: null, actor_kind: 'system' });
  });

  it('a whitelist de meta vale tambem pelo Canal A', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'system' });
      await expect(
        logDomainEvent(app, {
          eventType: 'ENCOUNTER_FINALIZE',
          entitySchema: 'clin',
          entityTable: 'encounter_version',
          entityId: VERSION,
          meta: { diagnostico: 'I10' } as unknown as Record<string, string>,
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  });

  it('app_rw tem EXECUTE em audit.log e continua sem INSERT na tabela', async () => {
    const res = await root.query<{ exec: boolean; ins: boolean; writer: boolean }>(
      `SELECT has_function_privilege('app_rw',
                'audit.log(text,text,text,uuid,text,jsonb,uuid)', 'EXECUTE') AS exec,
              has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins,
              has_schema_privilege('clin_writer', 'audit', 'USAGE') AS writer`,
    );
    // Sem `writer`, clin.finalize_encounter (que roda como clin_writer) morre com
    // 42501 "permission denied for schema audit" no primeiro deploy — o EXECUTE
    // concedido abaixo seria inutil.
    expect(res.rows[0]).toEqual({ exec: true, ins: false, writer: true });
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/channel-a.int.test.ts`
Esperado: FALHA já na resolução do import — `Failed to resolve import "../src/domain" from "packages/audit/test/channel-a.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_log` — cria `packages/db/migrations/0011_audit_log.sql`. Preencher com exatamente:

```sql
-- 0011_audit_log.sql
-- Canal A: evento de dominio, DENTRO da transacao de negocio.
-- SECURITY DEFINER porque roda como audit_owner e so assim casa com a
-- policy `writer` da 0009. A aplicacao recebe EXECUTE; nunca INSERT.

SET ROLE audit_owner;

-- clin_writer e o papel das funcoes SECURITY DEFINER do nucleo clinico
-- (clin.finalize_encounter), que chamam audit.log. A 0009 concedeu USAGE no
-- schema audit apenas a app_rw. Sem esta linha o EXECUTE abaixo e inutil:
-- a finalizacao de atendimento falha com 42501 "permission denied for schema
-- audit" no primeiro deploy, e nenhum atendimento pode ser finalizado.
GRANT USAGE ON SCHEMA audit TO clin_writer;

CREATE FUNCTION audit.log(
  p_event_type    text,
  p_entity_schema text,
  p_entity_table  text,
  p_entity_id     uuid  DEFAULT NULL,
  p_outcome       text  DEFAULT 'sucesso',
  p_meta          jsonb DEFAULT '{}'::jsonb,
  p_clinic_id     uuid  DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, app, pg_catalog AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      session_id, request_id, meta)
  VALUES (
      app.current_tenant_id(),
      p_clinic_id,
      app.current_user_id(),
      -- nullif em TODA leitura de GUC: worker e agendamento online nao tem
      -- user_id, e ''::uuid explode com 22P02 e aborta a transacao inteira.
      coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system'),
      p_event_type, p_entity_schema, p_entity_table, p_entity_id, p_outcome,
      nullif(current_setting('app.session_id', true), '')::uuid,
      nullif(current_setting('app.request_id', true), '')::uuid,
      p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log(text,text,text,uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log(text,text,text,uuid,text,jsonb,uuid)
  TO app_rw, clin_writer;

RESET ROLE;
```

- [ ] **Passo 4: Escrever o Canal A em TypeScript**

Criar `packages/audit/src/domain.ts`:

```ts
import type { Client, PoolClient } from 'pg';

/** Conexao ja dentro de uma transacao de negocio. */
export type Tx = Client | PoolClient;

export type AuditOutcome = 'sucesso' | 'negado' | 'erro';

/** Valores aceitos em `meta`. Chaves fora da whitelist do banco sao recusadas. */
export type AuditMeta = Readonly<Record<string, string | number | boolean | null>>;

export interface DomainAuditEvent {
  readonly eventType: string;
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly entityId?: string | null;
  readonly outcome?: AuditOutcome;
  readonly meta?: AuditMeta;
  readonly clinicId?: string | null;
}

/**
 * Canal A. Grava DENTRO da transacao de negocio recebida em `tx`.
 * Se a transacao fizer rollback, o evento some junto — de proposito:
 * o evento so e verdade se a escrita commitou.
 */
export async function logDomainEvent(tx: Tx, event: DomainAuditEvent): Promise<bigint> {
  const res = await tx.query<{ id: string }>(
    'SELECT audit.log($1, $2, $3, $4, $5, $6::jsonb, $7) AS id',
    [
      event.eventType,
      event.entitySchema,
      event.entityTable,
      event.entityId ?? null,
      event.outcome ?? 'sucesso',
      JSON.stringify(event.meta ?? {}),
      event.clinicId ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error('audit.log returned no row');
  }
  return BigInt(row.id);
}
```

Substituir o conteúdo de `packages/audit/src/index.ts` por:

```ts
export type { AuditMeta, AuditOutcome, DomainAuditEvent, Tx } from './domain';
export { logDomainEvent } from './domain';
```

- [ ] **Passo 5: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/channel-a.int.test.ts
```

Esperado: `aplicada: 0011_audit_log.sql` e PASSA, 5 testes verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0011_audit_log.sql \
        packages/audit/src/domain.ts \
        packages/audit/src/index.ts \
        packages/audit/test/channel-a.int.test.ts
git commit -m "feat(audit): channel A logs domain events inside the business transaction"
```

---

### Task 29: Canal B — segurança e acesso, em pool dedicado, fora da transação

> **A razão de existir deste canal, escrita para quem vai implementá-lo.**
>
> Evento de negação é **o que o auditor procura**. Ninguém abre a trilha para ver o que deu certo; abre para ver quem tentou o que não podia. E o desenho ingênuo — gravar tudo pela mesma conexão da transação de negócio — apaga justamente esses eventos: a tentativa negada faz a transação de negócio abortar, o `ROLLBACK` leva embora o registro da negação, e a trilha fica com um buraco exatamente onde deveria ter a evidência.
>
> Por isso o Canal B usa um **pool dedicado, de 2 conexões, que nunca participa da transação de negócio**. O `ROLLBACK` do domínio não alcança um `INSERT` que já commitou em outra conexão. É o mesmo raciocínio que já produziu o `auditPool()` da Task 14.
>
> E se o banco recusar (indisponível, saturado, em failover)? O evento vai para um **buffer em disco** (arquivo NDJSON), drenado depois. Perder um evento de segurança porque o banco piscou é o mesmo furo, com outro nome. **Mas buffer é só para banco indisponível** — erro de constraint, de dado ou de privilégio é bug nosso e tem que falhar alto, senão um `meta` recusado pela whitelist grava queixa e CID em texto claro num arquivo, que é precisamente o que a NGS1.07.06 proíbe.

O pool conecta com o papel de login `api`, que é `NOINHERIT` — ele **não** herda os privilégios de `app_rw` automaticamente. Por isso o pool executa `SET ROLE app_rw` em cada conexão nova.

`audit.log_security` recebe tenant e ator **explicitamente**, e não pelo GUC: o evento típico deste canal é exatamente aquele em que o contexto está ausente ou é inválido. Por isso `tenant_id` é nullable na tabela.

**Arquivos:**
- Criar: `packages/db/migrations/0012_audit_log_security.sql`
- Criar: `packages/audit/src/security.ts`
- Modificar: `packages/audit/src/index.ts`
- Teste: `packages/audit/test/channel-b.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/channel-b.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connectAs, connectSuperuser, setContext } from './helpers/pg';
import { logDomainEvent } from '../src/domain';
import { SecurityAuditChannel } from '../src/security';

const TENANT = '0192f8a0-0000-7000-8000-00000000040a';
const USER = '0192f8a0-0000-7000-8000-000000000401';
const PATIENT = '0192f8a0-0000-7000-8000-000000000402';

/** DATABASE_URL e o papel `api`, NOINHERIT: e o mesmo caminho de producao. */
function urlDaAplicacao(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente: rode `cp .env.example .env` e `pnpm db:up`');
  return url;
}

describe('Canal B: o evento de acesso negado sobrevive ao rollback do negocio', () => {
  let root: Client;
  let dir: string;
  let channel: SecurityAuditChannel;

  beforeAll(async () => {
    root = await connectSuperuser();
    dir = mkdtempSync(join(tmpdir(), 'cadencia-audit-'));
    channel = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath: join(dir, 'security-audit.ndjson'),
    });
  });

  afterAll(async () => {
    await channel.close();
    await root.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a negacao gravada pelo canal B sobrevive ao ROLLBACK da transacao de negocio', async () => {
    const app = await connectAs('app_rw');
    try {
      await app.query('BEGIN');
      await setContext(app, { tenantId: TENANT, userId: USER, actorKind: 'user' });

      // Canal A, na MESMA transacao que vai abortar.
      await logDomainEvent(app, {
        eventType: 'ENCOUNTER_FINALIZE',
        entitySchema: 'clin',
        entityTable: 'encounter_version',
        entityId: PATIENT,
        meta: { version_no: 1, kind: 'original' },
      });

      // Canal B, em conexao propria, fora da transacao.
      const resultado = await channel.record({
        eventType: 'RECORD_ACCESS_DENIED',
        outcome: 'negado',
        entitySchema: 'clin',
        entityTable: 'encounter',
        entityId: PATIENT,
        tenantId: TENANT,
        actorUserId: USER,
        actorKind: 'user',
        meta: { reason: 'sem_compartilhamento', route: '/v1/atendimentos/:id' },
      });
      expect(resultado).toBe('gravado');

      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    const negados = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'RECORD_ACCESS_DENIED'`,
      [TENANT],
    );
    const dominio = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'ENCOUNTER_FINALIZE'`,
      [TENANT],
    );

    // A negacao — que e o que o auditor procura — ficou.
    expect(Number(negados.rows[0]?.n)).toBe(1);
    // O evento de dominio da transacao abortada, nao.
    expect(Number(dominio.rows[0]?.n)).toBe(0);
  });

  it('tentativa sem contexto de tenant tambem vira evento, com tenant_id nulo', async () => {
    const resultado = await channel.record({
      eventType: 'SESSION_LOGIN',
      outcome: 'negado',
      entitySchema: 'id',
      entityTable: 'user',
      actorKind: 'anon',
      ip: '187.60.10.7',
      meta: { reason: 'tenant_ausente', route: '/v1/sessoes' },
    });
    expect(resultado).toBe('gravado');

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id IS NULL AND event_type = 'SESSION_LOGIN' AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('quando o banco recusa, o evento vai para o buffer em disco e nao se perde', async () => {
    const bufferPath = join(dir, 'offline.ndjson');
    const offline = new SecurityAuditChannel({
      // porta 1: nao existe servidor. Simula banco indisponivel.
      connectionString: 'postgres://ninguem@127.0.0.1:1/cadencia',
      bufferPath,
    });

    const resultado = await offline.record({
      eventType: 'BREAK_GLASS_OPEN',
      outcome: 'sucesso',
      entitySchema: 'clin',
      entityTable: 'patient',
      entityId: PATIENT,
      tenantId: TENANT,
      actorUserId: USER,
      actorKind: 'user',
      meta: { reason: 'paciente_inconsciente', ticket: 'CH-2026-0001' },
    });

    expect(resultado).toBe('bufferizado');
    expect(existsSync(bufferPath)).toBe(true);

    const linhas = readFileSync(bufferPath, 'utf8').trim().split('\n');
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0] ?? '{}')).toMatchObject({
      eventType: 'BREAK_GLASS_OPEN',
      tenantId: TENANT,
    });

    await offline.close();
  });

  it('meta fora da whitelist falha alto e NAO vai parar em arquivo no disco', async () => {
    const bufferPath = join(dir, 'pii.ndjson');
    const canal = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath,
    });
    try {
      await expect(
        canal.record({
          eventType: 'RECORD_ACCESS_DENIED',
          outcome: 'negado',
          entitySchema: 'clin',
          entityTable: 'encounter',
          entityId: PATIENT,
          tenantId: TENANT,
          actorUserId: USER,
          actorKind: 'user',
          meta: { queixa_principal: 'cefaleia ha 3 dias' } as unknown as Record<string, string>,
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'meta_sem_pii' });

      // O ponto do teste: o conteudo clinico recusado pelo banco nao pode ter
      // sido gravado em texto claro no volume da task.
      expect(existsSync(bufferPath)).toBe(false);
    } finally {
      await canal.close();
    }
  });

  it('drain envia o buffer para o banco e esvazia o arquivo', async () => {
    const bufferPath = join(dir, 'drenar.ndjson');
    const offline = new SecurityAuditChannel({
      connectionString: 'postgres://ninguem@127.0.0.1:1/cadencia',
      bufferPath,
    });
    await offline.record({
      eventType: 'BREAK_GLASS_CLOSE',
      outcome: 'sucesso',
      entitySchema: 'clin',
      entityTable: 'patient',
      entityId: PATIENT,
      tenantId: TENANT,
      actorUserId: USER,
      actorKind: 'user',
      meta: { ticket: 'CH-2026-0001' },
    });
    await offline.close();

    const online = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath,
    });
    const drenados = await online.drain();
    await online.close();

    expect(drenados).toBe(1);
    expect(readFileSync(bufferPath, 'utf8')).toBe('');

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'BREAK_GLASS_CLOSE'`,
      [TENANT],
    );
    expect(Number(res.rows[0]?.n)).toBe(1);
  });

  it('o pool do canal B nao abre mais que 2 conexoes, nem com 6 eventos simultaneos', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        channel.record({
          eventType: 'SESSION_LOGIN',
          outcome: 'negado',
          entitySchema: 'id',
          entityTable: 'user',
          actorKind: 'anon',
          ip: '187.60.10.7',
          meta: { reason: 'senha_invalida', route: `/v1/sessoes/${i}` },
        }),
      ),
    );

    // Todos gravaram: o limite serializa, nao descarta.
    expect(resultados).toEqual(Array.from({ length: 6 }, () => 'gravado'));
    // E o teto de 2 conexoes da §2.1 vale de verdade, nao so no campo do objeto.
    expect(channel.openConnections).toBeLessThanOrEqual(2);
    expect(channel.maxConnections).toBe(2);

    const res = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id IS NULL AND event_type = 'SESSION_LOGIN' AND outcome = 'negado'`,
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(6);
  });

  it('app_rw tem EXECUTE em audit.log_security e continua sem INSERT na tabela', async () => {
    const res = await root.query<{ exec: boolean; ins: boolean }>(
      `SELECT has_function_privilege('app_rw',
                'audit.log_security(text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb)',
                'EXECUTE') AS exec,
              has_table_privilege('app_rw', 'audit.event', 'INSERT') AS ins`,
    );
    expect(res.rows[0]).toEqual({ exec: true, ins: false });
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/channel-b.int.test.ts`
Esperado: FALHA com `Failed to resolve import "../src/security" from "packages/audit/test/channel-b.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_log_security` — cria `packages/db/migrations/0012_audit_log_security.sql`. Preencher com exatamente:

```sql
-- 0012_audit_log_security.sql
-- Canal B: seguranca e acesso. Recebe tenant e ator EXPLICITAMENTE, porque o
-- evento tipico deste canal e justamente aquele em que o contexto esta ausente
-- ou e invalido. Chamado por um pool dedicado, fora da transacao de negocio.

SET ROLE audit_owner;

CREATE FUNCTION audit.log_security(
  p_event_type    text,
  p_outcome       text,
  p_entity_schema text,
  p_entity_table  text,
  p_entity_id     uuid  DEFAULT NULL,
  p_tenant_id     uuid  DEFAULT NULL,
  p_clinic_id     uuid  DEFAULT NULL,
  p_actor_user_id uuid  DEFAULT NULL,
  p_actor_kind    text  DEFAULT 'anon',
  p_session_id    uuid  DEFAULT NULL,
  p_request_id    uuid  DEFAULT NULL,
  p_ip            inet  DEFAULT NULL,
  p_meta          jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, pg_catalog AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      ip, session_id, request_id, meta)
  VALUES (
      p_tenant_id, p_clinic_id, p_actor_user_id, p_actor_kind, p_event_type,
      p_entity_schema, p_entity_table, p_entity_id, p_outcome,
      p_ip, p_session_id, p_request_id, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) TO app_rw;

RESET ROLE;
```

- [ ] **Passo 4: Escrever o Canal B em TypeScript**

Criar `packages/audit/src/security.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Pool } from 'pg';
import type { AuditMeta, AuditOutcome } from './domain';

export interface SecurityAuditEvent {
  readonly eventType: string;
  readonly outcome: AuditOutcome;
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly entityId?: string | null;
  readonly tenantId?: string | null;
  readonly clinicId?: string | null;
  readonly actorUserId?: string | null;
  readonly actorKind: 'user' | 'system' | 'anon';
  readonly sessionId?: string | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly meta?: AuditMeta;
}

export interface SecurityAuditChannelOptions {
  /** Conexao do pool DEDICADO. Nunca a mesma do pool de negocio. */
  readonly connectionString: string;
  /** Arquivo NDJSON de contingencia, em volume persistente da task. */
  readonly bufferPath: string;
  /** §2.1: 2 conexoes. */
  readonly max?: number;
}

const SQL_LOG_SECURITY = `
  SELECT audit.log_security($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) AS id`;

/**
 * Buffer em disco existe para banco indisponivel — e so para isso.
 * SQLSTATE de constraint (23*), de dado (22*) ou de privilegio (42*) e bug nosso
 * e tem que falhar alto: bufferizar um `meta` recusado pela whitelist gravaria
 * queixa, CID ou nome de paciente em texto claro num arquivo NDJSON, que e
 * precisamente o que a NGS1.07.06 proibe.
 */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  // Erro de rede/socket do Node (ECONNREFUSED, ETIMEDOUT) ou timeout do pool:
  // nao tem SQLSTATE de 5 caracteres.
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true;
  // 08 conexao · 53 recursos esgotados · 57 intervencao do operador ·
  // 58 erro de sistema · XX corrupcao interna.
  return /^(08|53|57|58|XX)/.test(code);
}

/**
 * Canal B: seguranca e acesso, FORA da transacao de negocio.
 *
 * Evento de negacao e o que o auditor procura, e a negacao acontece exatamente
 * quando a transacao de negocio vai abortar. Gravar pela mesma conexao faria o
 * ROLLBACK apagar a evidencia. Se o banco recusar, o evento vai para disco.
 */
export class SecurityAuditChannel {
  private readonly pool: Pool;
  private readonly bufferPath: string;
  readonly maxConnections: number;

  constructor(options: SecurityAuditChannelOptions) {
    this.maxConnections = options.max ?? 2;
    this.bufferPath = options.bufferPath;
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: this.maxConnections,
      connectionTimeoutMillis: 2_000,
      application_name: 'cadencia-audit-channel',
    });
    // O papel de login `api` e NOINHERIT: nao herda app_rw sozinho. A query e
    // enfileirada na conexao antes de qualquer outra, porque o `pg` mantem uma
    // fila FIFO por cliente.
    this.pool.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });
    this.pool.on('error', () => undefined);
  }

  /** Conexoes fisicas efetivamente abertas agora por este pool. */
  get openConnections(): number {
    return this.pool.totalCount;
  }

  async record(event: SecurityAuditEvent): Promise<'gravado' | 'bufferizado'> {
    try {
      await this.insert(event);
      return 'gravado';
    } catch (err) {
      if (!isTransient(err)) throw err;
      this.buffer(event);
      return 'bufferizado';
    }
  }

  /** Reenvia o buffer de disco. Para no primeiro erro e preserva o restante. */
  async drain(): Promise<number> {
    if (!existsSync(this.bufferPath)) {
      return 0;
    }
    const linhas = readFileSync(this.bufferPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    let enviados = 0;
    try {
      for (; enviados < linhas.length; enviados += 1) {
        await this.insert(JSON.parse(linhas[enviados] ?? '{}') as SecurityAuditEvent);
      }
    } finally {
      writeFileSync(
        this.bufferPath,
        linhas
          .slice(enviados)
          .map((l) => `${l}\n`)
          .join(''),
        'utf8',
      );
    }
    return enviados;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async insert(event: SecurityAuditEvent): Promise<void> {
    await this.pool.query(SQL_LOG_SECURITY, [
      event.eventType,
      event.outcome,
      event.entitySchema,
      event.entityTable,
      event.entityId ?? null,
      event.tenantId ?? null,
      event.clinicId ?? null,
      event.actorUserId ?? null,
      event.actorKind,
      event.sessionId ?? null,
      event.requestId ?? null,
      event.ip ?? null,
      JSON.stringify(event.meta ?? {}),
    ]);
  }

  private buffer(event: SecurityAuditEvent): void {
    mkdirSync(dirname(this.bufferPath), { recursive: true });
    appendFileSync(this.bufferPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
```

- [ ] **Passo 5: Publicar no barril do pacote**

Substituir o conteúdo de `packages/audit/src/index.ts` por:

```ts
export type { AuditMeta, AuditOutcome, DomainAuditEvent, Tx } from './domain';
export { logDomainEvent } from './domain';
export type { SecurityAuditChannelOptions, SecurityAuditEvent } from './security';
export { SecurityAuditChannel } from './security';
```

- [ ] **Passo 6: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/channel-b.int.test.ts
```

Esperado: `aplicada: 0012_audit_log_security.sql` e PASSA, 7 testes verdes.

- [ ] **Passo 7: Commitar**

```bash
git add packages/db/migrations/0012_audit_log_security.sql \
        packages/audit/src/security.ts \
        packages/audit/src/index.ts \
        packages/audit/test/channel-b.int.test.ts
git commit -m "feat(audit): channel B writes security events outside the business transaction"
```

---

### Task 30: Deduplicação da auditoria de leitura — 1 evento por (usuário, paciente, caso de uso) em 5 minutos

Toda leitura de prontuário é evento de auditoria: é obrigação (NGS1.07) e é o que sustenta a tela "Auditoria › Trilha". Mas registrar **por linha** ou **por componente de tela** é inviável: a lista virtualizada de 50 pacientes gera 50 INSERTs por scroll, o médico que abre e fecha a mesma aba três vezes gera três eventos, e a trilha passa a crescer mais rápido que o domínio inteiro — o que degrada exatamente a exportação da trilha que ela existe para permitir.

Granularidade decidida: **um evento por (usuário, paciente, caso de uso), deduplicado em janela de 5 minutos**.

A deduplicação vive **no banco**, não na aplicação: dois processos `api` atrás do balanceador não compartilham cache de memória, e um `INSERT ... ON CONFLICT DO UPDATE ... WHERE` resolve a corrida atomicamente. `audit.read_dedup` é tabela de controle, sem GRANT para a aplicação, com RLS forçada e policy só para o dono.

Sobre `entity_id` guardar o `patient_id`: é referência interna (UUID), não identificador de pessoa. CPF, CNS, nome e nome social **nunca** entram na trilha.

**Arquivos:**
- Criar: `packages/db/migrations/0013_audit_log_read.sql`
- Modificar: `packages/audit/src/security.ts` (acrescentar o método `recordRead`)
- Teste: `packages/audit/test/read-dedup.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/read-dedup.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';
import { SecurityAuditChannel } from '../src/security';

const TENANT = '0192f8a0-0000-7000-8000-00000000050a';
const MEDICO = '0192f8a0-0000-7000-8000-000000000501';
const OUTRO_MEDICO = '0192f8a0-0000-7000-8000-000000000502';
const PACIENTE = '0192f8a0-0000-7000-8000-000000000511';
const OUTRO_PACIENTE = '0192f8a0-0000-7000-8000-000000000512';

function urlDaAplicacao(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente: rode `cp .env.example .env` e `pnpm db:up`');
  return url;
}

async function contarLeituras(root: Client, paciente: string, usuario: string): Promise<number> {
  const res = await root.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit.event
      WHERE tenant_id = $1 AND event_type = 'PATIENT_RECORD_READ'
        AND entity_id = $2 AND actor_user_id = $3`,
    [TENANT, paciente, usuario],
  );
  return Number(res.rows[0]?.n);
}

describe('auditoria de leitura: um evento por (usuario, paciente, caso de uso) em 5 minutos', () => {
  let root: Client;
  let app: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
    app = await connectAs('app_rw');
  });

  afterAll(async () => {
    await app.end();
    await root.end();
  });

  it('50 leituras do mesmo paciente na mesma janela geram 1 evento, nao 50', async () => {
    for (let i = 0; i < 50; i += 1) {
      await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
        'emr.open_record',
        PACIENTE,
        TENANT,
        MEDICO,
      ]);
    }

    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(1);
  });

  it('a primeira chamada devolve o id do evento e as seguintes devolvem NULL', async () => {
    const primeira = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.print_record', PACIENTE, TENANT, MEDICO],
    );
    const segunda = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.print_record', PACIENTE, TENANT, MEDICO],
    );

    expect(primeira.rows[0]?.id).not.toBeNull();
    expect(segunda.rows[0]?.id).toBeNull();
  });

  it('outro caso de uso do mesmo paciente e outro evento', async () => {
    const antes = await contarLeituras(root, PACIENTE, MEDICO);
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.export_record',
      PACIENTE,
      TENANT,
      MEDICO,
    ]);
    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(antes + 1);
  });

  it('outro usuario lendo o mesmo paciente gera evento proprio', async () => {
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.open_record',
      PACIENTE,
      TENANT,
      OUTRO_MEDICO,
    ]);
    expect(await contarLeituras(root, PACIENTE, OUTRO_MEDICO)).toBe(1);
  });

  it('outro paciente do mesmo usuario gera evento proprio', async () => {
    await app.query('SELECT audit.log_read($1, $2, $3, $4)', [
      'emr.open_record',
      OUTRO_PACIENTE,
      TENANT,
      MEDICO,
    ]);
    expect(await contarLeituras(root, OUTRO_PACIENTE, MEDICO)).toBe(1);
  });

  it('passados os 5 minutos da janela, a leitura volta a gerar evento', async () => {
    const antes = await contarLeituras(root, PACIENTE, MEDICO);

    // Envelhece a marca da deduplicacao em 6 minutos: e o equivalente
    // deterministico de esperar a janela expirar.
    const marca = await root.query(
      `UPDATE audit.read_dedup
          SET last_logged_at = last_logged_at - interval '6 minutes'
        WHERE tenant_id = $1 AND actor_user_id = $2 AND entity_id = $3
          AND use_case = 'emr.open_record'`,
      [TENANT, MEDICO, PACIENTE],
    );
    // Garante que o teste esta de fato envelhecendo a marca certa, e nao
    // passando por acidente porque o UPDATE nao pegou nenhuma linha.
    expect(marca.rowCount).toBe(1);

    const res = await app.query<{ id: string | null }>(
      'SELECT audit.log_read($1, $2, $3, $4) AS id',
      ['emr.open_record', PACIENTE, TENANT, MEDICO],
    );

    expect(res.rows[0]?.id).not.toBeNull();
    expect(await contarLeituras(root, PACIENTE, MEDICO)).toBe(antes + 1);
  });

  it('a tabela de deduplicacao nao e visivel para a aplicacao', async () => {
    const res = await root.query<{ sel: boolean; ins: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.read_dedup', 'SELECT') AS sel,
              has_table_privilege('app_rw', 'audit.read_dedup', 'INSERT') AS ins`,
    );
    expect(res.rows[0]).toEqual({ sel: false, ins: false });
  });

  it('o canal B expoe recordRead e distingue gravado de deduplicado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadencia-read-'));
    const channel = new SecurityAuditChannel({
      connectionString: urlDaAplicacao(),
      bufferPath: join(dir, 'buffer.ndjson'),
    });
    try {
      const primeira = await channel.recordRead({
        useCase: 'emr.timeline',
        patientId: OUTRO_PACIENTE,
        tenantId: TENANT,
        actorUserId: OUTRO_MEDICO,
      });
      const segunda = await channel.recordRead({
        useCase: 'emr.timeline',
        patientId: OUTRO_PACIENTE,
        tenantId: TENANT,
        actorUserId: OUTRO_MEDICO,
      });
      expect([primeira, segunda]).toEqual(['gravado', 'deduplicado']);
    } finally {
      await channel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/read-dedup.int.test.ts`
Esperado: FALHA com `error: function audit.log_read(unknown, unknown, unknown, unknown) does not exist` (SQLSTATE `42883`).

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_log_read` — cria `packages/db/migrations/0013_audit_log_read.sql`. Preencher com exatamente:

```sql
-- 0013_audit_log_read.sql
-- Auditoria de leitura clinica, deduplicada por (usuario, paciente, caso de uso)
-- em janela de 5 minutos. Sem isso, a lista virtualizada de 50 pacientes gera
-- 50 INSERTs por scroll e a trilha cresce mais rapido que o dominio.
-- A deduplicacao vive no banco: dois processos api nao compartilham cache.

SET ROLE audit_owner;

CREATE TABLE audit.read_dedup (
  tenant_id      uuid NOT NULL,
  actor_user_id  uuid NOT NULL,
  entity_id      uuid NOT NULL,          -- patient_id: REFERENCIA, nunca CPF/CNS/nome
  use_case       text NOT NULL,
  last_logged_at timestamptz(3) NOT NULL,
  PRIMARY KEY (tenant_id, actor_user_id, entity_id, use_case));

ALTER TABLE audit.read_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.read_dedup FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_all ON audit.read_dedup AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);
REVOKE ALL ON audit.read_dedup FROM PUBLIC, app_rw, app_owner;

CREATE FUNCTION audit.log_read(
  p_use_case      text,
  p_patient_id    uuid,
  p_tenant_id     uuid DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_clinic_id     uuid DEFAULT NULL,
  p_session_id    uuid DEFAULT NULL,
  p_request_id    uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = audit, app, pg_catalog AS $$
DECLARE
  -- Aceita os valores explicitos (pool dedicado do canal B) e cai para o GUC
  -- quando chamada de dentro de clin.read_encounter()/clin.read_patient_record().
  v_tenant uuid    := coalesce(p_tenant_id,     app.current_tenant_id());
  v_user   uuid    := coalesce(p_actor_user_id, app.current_user_id());
  v_nova   boolean;
  v_id     bigint;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    -- Leitura sem contexto nao e deduplicavel: e tentativa, e vira evento
    -- de negacao sempre, sem janela.
    INSERT INTO audit.event (
        tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
        entity_schema, entity_table, entity_id, outcome,
        session_id, request_id, meta)
    VALUES (
        v_tenant, p_clinic_id, v_user, 'anon', 'PATIENT_RECORD_READ',
        'clin', 'patient', p_patient_id, 'negado',
        p_session_id, p_request_id, jsonb_build_object('use_case', p_use_case))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- Atomico entre processos: se a marca ainda esta dentro da janela, o
  -- DO UPDATE nao acontece e o RETURNING nao devolve linha.
  INSERT INTO audit.read_dedup AS d
         (tenant_id, actor_user_id, entity_id, use_case, last_logged_at)
  VALUES (v_tenant, v_user, p_patient_id, p_use_case, clock_timestamp())
  ON CONFLICT (tenant_id, actor_user_id, entity_id, use_case) DO UPDATE
     SET last_logged_at = clock_timestamp()
   WHERE d.last_logged_at < clock_timestamp() - interval '5 minutes'
  RETURNING true INTO v_nova;

  IF v_nova IS NULL THEN
    RETURN NULL;                 -- dentro da janela: nada a registrar
  END IF;

  INSERT INTO audit.event (
      tenant_id, clinic_id, actor_user_id, actor_kind, event_type,
      entity_schema, entity_table, entity_id, outcome,
      session_id, request_id, meta)
  VALUES (
      v_tenant, p_clinic_id, v_user, 'user', 'PATIENT_RECORD_READ',
      'clin', 'patient', p_patient_id, 'sucesso',
      p_session_id, p_request_id, jsonb_build_object('use_case', p_use_case))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION audit.log_read(text,uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.log_read(text,uuid,uuid,uuid,uuid,uuid,uuid)
  TO app_rw, clin_writer;

RESET ROLE;
```

- [ ] **Passo 4: Acrescentar `recordRead` ao canal B**

Modificar `packages/audit/src/security.ts` — inserir o método abaixo dentro da classe `SecurityAuditChannel`, logo depois de `record`:

```ts
  /**
   * Leitura de prontuario. A deduplicacao (1 evento por usuario × paciente ×
   * caso de uso, janela de 5 min) acontece no banco: dois processos api nao
   * compartilham cache de memoria.
   */
  async recordRead(read: {
    readonly useCase: string;
    readonly patientId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly clinicId?: string | null;
    readonly sessionId?: string | null;
    readonly requestId?: string | null;
  }): Promise<'gravado' | 'deduplicado' | 'bufferizado'> {
    try {
      const res = await this.pool.query<{ id: string | null }>(
        'SELECT audit.log_read($1,$2,$3,$4,$5,$6,$7) AS id',
        [
          read.useCase,
          read.patientId,
          read.tenantId,
          read.actorUserId,
          read.clinicId ?? null,
          read.sessionId ?? null,
          read.requestId ?? null,
        ],
      );
      return res.rows[0]?.id == null ? 'deduplicado' : 'gravado';
    } catch (err) {
      if (!isTransient(err)) throw err;
      this.buffer({
        eventType: 'PATIENT_RECORD_READ',
        outcome: 'sucesso',
        entitySchema: 'clin',
        entityTable: 'patient',
        entityId: read.patientId,
        tenantId: read.tenantId,
        actorUserId: read.actorUserId,
        actorKind: 'user',
        clinicId: read.clinicId ?? null,
        sessionId: read.sessionId ?? null,
        requestId: read.requestId ?? null,
        meta: { use_case: read.useCase },
      });
      return 'bufferizado';
    }
  }
```

- [ ] **Passo 5: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/read-dedup.int.test.ts
```

Esperado: `aplicada: 0013_audit_log_read.sql` e PASSA, 8 testes verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0013_audit_log_read.sql \
        packages/audit/src/security.ts \
        packages/audit/test/read-dedup.int.test.ts
git commit -m "feat(audit): deduplicate record-read events per user, patient and use case"
```

---

### Task 31: Selo diário com marca d'água de visibilidade, e o *dead man's switch*

> **A promessa honesta não é "trilha imutável", é "adulteração detectável".** Dentro do banco, superusuário sempre vence `REVOKE`. O que torna a adulteração detectável é o **selo diário**: uma linha por (tenant, dia) com o intervalo de ids, a contagem e um hash encadeado com o selo do dia anterior, assinado e exportado para bucket com Object Lock **em conta separada**. Adulterar passa a exigir mexer no Postgres **e** num objeto travado em outra conta — e ainda assim quebra a cadeia de forma verificável.

**A marca d'água de visibilidade (`snapshot_xmin`) e o cenário que ela resolve.**

Um lote TISS começa às 23h58 do dia 12 e commita às 00h03 do dia 13. Os eventos que ele gravou têm `occurred_at` do dia 12 — o `clock_timestamp()` foi avaliado quando o `INSERT` rodou — mas **só ficam visíveis** para outras transações depois do commit, já no dia 13. Se o job de selo rodar às 00h01 e selar o dia 12, ele conta as linhas visíveis naquele instante: as do lote não estão lá. Às 00h03 elas aparecem, dentro de um dia **já selado**. Meses depois, a verificação da cadeia recalcula o hash do dia 12, encontra linhas a mais e **acusa adulteração** — de um sistema que funcionou perfeitamente.

A correção: o dia D só é selado quando não existe transação **que já escreveu** aberta desde antes do fim de D. O selo grava o `xmin` do snapshot em que foi calculado (`snapshot_xmin`), de modo que a verificação futura sabe exatamente qual horizonte de visibilidade produziu aquele hash. Se ainda houver transação antiga em curso, o selo é **adiado**, não aproximado. Repare que a condição olha `backend_xid IS NOT NULL`: só transação que já adquiriu XID pode ter linha dentro do dia fechado. Transação ociosa ou somente-leitura não adia nada — se adiasse, qualquer conexão aberta no banco travaria o selo para sempre.

**O *dead man's switch*.** O selo é a única garantia real de imutabilidade, e job que para não faz barulho: ele simplesmente deixa de existir. O alarme não pode ser só por erro — tem que ser por **ausência de execução**. `audit.seal_watchdog()` responde `nunca_executou` quando não há nenhuma execução bem-sucedida registrada, `ausente` quando a última passou do limite, e `ok` só quando houve sucesso dentro da janela. Uma execução que terminou em `erro` ou em `adiado` **não** conta como sinal de vida. E quem produz esse sinal é `audit.run_seal` — o envelope que grava `audit.seal_run` e o evento `SEAL_RUN` na trilha. **O agendamento diário chama `audit.run_seal`, nunca `audit.seal_day` direto**: sem o envelope, o watchdog responde `nunca_executou` para sempre, o alarme vira ruído permanente e é desligado na primeira semana.

O selo roda como `jobs`, o único papel do cluster com `BYPASSRLS` — é o que permite ler todos os tenants. Sem esse papel, o selo rodaria vendo zero linhas e reportando sucesso para sempre.

**Arquivos:**
- Criar: `packages/db/migrations/0014_audit_seal.sql`
- Teste: `packages/audit/test/seal.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/audit/test/seal.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connectAs, connectSuperuser } from './helpers/pg';

const TENANT = '0192f8a0-0000-7000-8000-00000000060a';
const TENANT_RUN_OK = '0192f8a0-0000-7000-8000-00000000060b';
const TENANT_RUN_ADIADO = '0192f8a0-0000-7000-8000-00000000060c';

async function inserirEvento(owner: Client, tipo: string): Promise<void> {
  await owner.query(
    `INSERT INTO audit.event
       (tenant_id, actor_kind, event_type, entity_schema, entity_table, outcome, meta)
     VALUES ($1, 'system', $2, 'clin', 'encounter_version', 'sucesso', '{}'::jsonb)`,
    [TENANT, tipo],
  );
}

describe('audit.seal: selo diario, marca d agua de visibilidade e dead man switch', () => {
  let root: Client;
  let jobs: Client;
  let owner: Client;

  beforeAll(async () => {
    root = await connectSuperuser();
    jobs = await connectAs('jobs');
    owner = await connectAs('audit_owner');
    await inserirEvento(owner, 'ENCOUNTER_FINALIZE');
    await inserirEvento(owner, 'ENCOUNTER_AMEND');
  });

  afterAll(async () => {
    await owner.end();
    await jobs.end();
    await root.end();
  });

  it('o papel jobs e o unico do cluster com BYPASSRLS', async () => {
    const res = await root.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY rolname',
    );
    expect(res.rows.map((r) => r.rolname)).toEqual(['jobs']);
  });

  it('a marca d agua exige pg_read_all_stats em jobs, senao o selo cega em silencio', async () => {
    const res = await root.query<{ ok: boolean }>(
      `SELECT pg_has_role('jobs', 'pg_read_all_stats', 'MEMBER') AS ok`,
    );
    expect(res.rows[0]?.ok).toBe(true);
  });

  it('adia o selo enquanto existe transacao COM ESCRITA aberta antes do fim do dia', async () => {
    const lote = await connectAs('audit_owner');
    try {
      // O "lote das 23h58": abriu antes do corte, ja escreveu e ainda nao commitou.
      await lote.query('BEGIN');
      await inserirEvento(lote, 'TISS_BATCH_SUBMIT');

      // Selar hoje com esse lote aberto entraria num dia que ainda pode receber
      // linhas: a verificacao futura acusaria adulteracao.
      await expect(
        jobs.query('SELECT audit.seal_day($1, CURRENT_DATE)', [TENANT]),
      ).rejects.toMatchObject({
        code: '55006',
        message: expect.stringContaining('selo adiado'),
      });

      await lote.query('COMMIT');
    } finally {
      await lote.end();
    }
  });

  it('depois do commit do lote, o selo fecha o dia contando as linhas do lote', async () => {
    const res = await jobs.query<{
      row_count: string;
      snapshot_xmin: string;
      chain_hash: Buffer;
      prev_chain_hash: Buffer | null;
    }>(
      `SELECT row_count::text, snapshot_xmin::text, chain_hash, prev_chain_hash
         FROM audit.seal_day($1, CURRENT_DATE)`,
      [TENANT],
    );

    const selo = res.rows[0];
    expect(selo).toBeDefined();
    expect(Number(selo?.row_count)).toBe(3);          // 2 do beforeAll + 1 do lote
    expect(Number(selo?.snapshot_xmin)).toBeGreaterThan(0);
    expect(selo?.chain_hash?.length).toBe(32);
    expect(selo?.prev_chain_hash).toBeNull();          // primeiro selo do tenant
  });

  it('nao sela o mesmo dia duas vezes', async () => {
    await expect(
      jobs.query('SELECT audit.seal_day($1, CURRENT_DATE)', [TENANT]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a aplicacao le o selo mas nao escreve nele', async () => {
    const res = await root.query<{ sel: boolean; ins: boolean; upd: boolean }>(
      `SELECT has_table_privilege('app_rw', 'audit.seal', 'SELECT') AS sel,
              has_table_privilege('app_rw', 'audit.seal', 'INSERT') AS ins,
              has_table_privilege('app_rw', 'audit.seal', 'UPDATE') AS upd`,
    );
    expect(res.rows[0]).toEqual({ sel: true, ins: false, upd: false });
  });

  it('run_seal e o batimento do dead man switch: registra sucesso e o proprio evento', async () => {
    await root.query('TRUNCATE audit.seal_run');

    const res = await jobs.query<{ run_seal: string }>(
      'SELECT audit.run_seal($1, CURRENT_DATE) AS run_seal',
      [TENANT_RUN_OK],
    );
    expect(res.rows[0]?.run_seal).toBe('sucesso');

    const run = await root.query<{ outcome: string; finished: boolean }>(
      `SELECT outcome, finished_at IS NOT NULL AS finished FROM audit.seal_run`,
    );
    expect(run.rows).toEqual([{ outcome: 'sucesso', finished: true }]);

    // Sem esta linha o watchdog nunca sai de 'nunca_executou' em producao.
    const wd = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(wd.rows[0]?.status).toBe('ok');

    // §3.1: toda execucao de `jobs` grava evento proprio na trilha.
    const ev = await root.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.event
        WHERE tenant_id = $1 AND event_type = 'SEAL_RUN' AND meta ->> 'job_name' = 'seal'`,
      [TENANT_RUN_OK],
    );
    expect(Number(ev.rows[0]?.n)).toBe(1);
  });

  it('run_seal registra adiado sem contar como sinal de vida', async () => {
    await root.query('TRUNCATE audit.seal_run');
    const lote = await connectAs('audit_owner');
    try {
      await lote.query('BEGIN');
      await inserirEvento(lote, 'TISS_BATCH_SUBMIT');

      const res = await jobs.query<{ run_seal: string }>(
        'SELECT audit.run_seal($1, CURRENT_DATE) AS run_seal',
        [TENANT_RUN_ADIADO],
      );
      expect(res.rows[0]?.run_seal).toBe('adiado');

      await lote.query('ROLLBACK');
    } finally {
      await lote.end();
    }

    const wd = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(wd.rows[0]?.status).toBe('nunca_executou');
  });

  it('sem nenhuma execucao registrada, o watchdog acusa ausencia, nao ok', async () => {
    await root.query('TRUNCATE audit.seal_run');
    const res = await jobs.query<{ status: string; ultima_execucao: Date | null }>(
      'SELECT * FROM audit.seal_watchdog()',
    );
    expect(res.rows[0]?.status).toBe('nunca_executou');
    expect(res.rows[0]?.ultima_execucao).toBeNull();
  });

  it('execucao que terminou em erro nao conta como sinal de vida', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, outcome, detail)
       VALUES ($1, CURRENT_DATE - 1, 'erro', 'conexao recusada')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('nunca_executou');
  });

  it('ultima execucao bem-sucedida ha 30 horas dispara o alarme de ausencia', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, started_at, finished_at, outcome)
       VALUES ($1, CURRENT_DATE - 2, clock_timestamp() - interval '30 hours',
               clock_timestamp() - interval '30 hours', 'sucesso')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('ausente');
  });

  it('execucao bem-sucedida ha 2 horas mantem o watchdog em ok', async () => {
    await root.query('TRUNCATE audit.seal_run');
    await root.query(
      `INSERT INTO audit.seal_run (tenant_id, seal_date, started_at, finished_at, outcome)
       VALUES ($1, CURRENT_DATE - 1, clock_timestamp() - interval '2 hours',
               clock_timestamp() - interval '2 hours', 'sucesso')`,
      [TENANT],
    );
    const res = await jobs.query<{ status: string }>('SELECT * FROM audit.seal_watchdog()');
    expect(res.rows[0]?.status).toBe('ok');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/audit/test/seal.int.test.ts`
Esperado: FALHA com `error: relation "audit.seal_run" does not exist` (`42P01`) e `error: function audit.seal_day(unknown, date) does not exist` (`42883`).

- [ ] **Passo 3: Escrever a migration**

Rodar: `pnpm db:new audit_seal` — cria `packages/db/migrations/0014_audit_seal.sql`. Preencher com exatamente:

```sql
-- 0014_audit_seal.sql
-- Selo diario: a unica garantia real de imutabilidade. Dentro do banco,
-- superusuario sempre vence REVOKE; o que resta e adulteracao DETECTAVEL.
-- Roda como `jobs`, unico papel com BYPASSRLS: sem ele o selo leria zero
-- linhas e reportaria sucesso para sempre.

-- pg_read_all_stats e necessario para a marca d'agua de visibilidade. Em
-- producao o GRANT pertence ao bootstrap (superusuario); aqui ele e tentado e,
-- se faltar privilegio, o teste de CI reprova alto em vez de o selo cegar.
DO $$
BEGIN
  EXECUTE 'GRANT pg_read_all_stats TO jobs';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'GRANT pg_read_all_stats TO jobs precisa ser feito pelo superusuario de bootstrap';
END $$;

SET ROLE audit_owner;

GRANT USAGE ON SCHEMA audit TO jobs;
GRANT SELECT ON audit.event TO jobs;

CREATE TABLE audit.seal (
  tenant_id uuid NOT NULL, seal_date date NOT NULL,
  first_id bigint NOT NULL, last_id bigint NOT NULL, row_count bigint NOT NULL,
  chain_hash bytea NOT NULL, prev_chain_hash bytea,
  -- Marca d'agua de visibilidade: o dia D so e selado quando nao ha transacao
  -- com escrita mais antiga que o inicio de D+1. Sem isso, um lote TISS que
  -- comeca 23h58 e commita 00h03 entra num dia ja selado e a verificacao futura
  -- acusa adulteracao de um sistema que funcionou perfeitamente.
  snapshot_xmin bigint NOT NULL,
  signed_pkcs7 bytea, sealed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, seal_date));

ALTER TABLE audit.seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.seal FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON audit.seal FROM PUBLIC, app_rw, app_owner;
GRANT SELECT ON audit.seal TO app_rw;
GRANT SELECT, INSERT ON audit.seal TO jobs;
CREATE POLICY tenant_read ON audit.seal AS PERMISSIVE FOR SELECT TO app_rw
  USING (tenant_id = app.current_tenant_id() AND app.is_member());
CREATE POLICY owner_all ON audit.seal AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);

-- Registro de EXECUCAO do job. E sobre esta tabela que o dead man's switch
-- opera: o alarme e por AUSENCIA de execucao, nao so por erro.
CREATE TABLE audit.seal_run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid,                       -- NULL = execucao global do job
  seal_date date NOT NULL,
  started_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz(3),
  outcome text NOT NULL CHECK (outcome IN ('sucesso','adiado','erro')),
  detail text);

ALTER TABLE audit.seal_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.seal_run FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON audit.seal_run FROM PUBLIC, app_rw, app_owner;
GRANT SELECT, INSERT ON audit.seal_run TO jobs;
CREATE POLICY owner_all ON audit.seal_run AS PERMISSIVE FOR ALL TO audit_owner
  USING (true) WITH CHECK (true);

-- SECURITY INVOKER de proposito: roda como `jobs` e usa o BYPASSRLS dele para
-- enxergar todos os tenants. Como SECURITY DEFINER (audit_owner) a RLS forcada
-- devolveria zero linhas e o selo seria de um dia vazio.
CREATE FUNCTION audit.seal_day(p_tenant uuid, p_date date) RETURNS audit.seal
LANGUAGE plpgsql
SET search_path = audit, pg_catalog AS $$
DECLARE
  v_cut  timestamptz := (p_date + 1)::timestamptz;   -- inicio de D+1
  v_xmin bigint;
  v_prev bytea;
  v_row  audit.seal;
BEGIN
  v_xmin := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;

  -- So bloqueia transacao que JA ESCREVEU (isto e, que ja adquiriu XID): e a
  -- unica que pode ter linhas com occurred_at dentro do dia fechado e ainda
  -- invisiveis. O lote TISS que comeca 23h58, INSERE antes da meia-noite e
  -- commita 00h03 cai aqui — que e o caso que o selo existe para cobrir.
  -- Transacao aberta e ociosa, ou somente-leitura, nao adia nada.
  IF EXISTS (
      SELECT 1 FROM pg_stat_activity a
       WHERE a.datname = current_database()
         AND a.pid <> pg_backend_pid()
         AND a.xact_start IS NOT NULL
         AND a.xact_start < v_cut
         AND a.backend_xid IS NOT NULL)
  THEN
    RAISE EXCEPTION 'selo adiado: transacao com escrita aberta desde antes de % ainda em curso', v_cut
      USING ERRCODE = '55006',
            HINT = 'Rode o selo de novo quando a transacao antiga terminar.';
  END IF;

  SELECT s.chain_hash INTO v_prev
    FROM audit.seal s
   WHERE s.tenant_id = p_tenant AND s.seal_date < p_date
   ORDER BY s.seal_date DESC
   LIMIT 1;

  INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id, row_count,
                          chain_hash, prev_chain_hash, snapshot_xmin)
  SELECT p_tenant, p_date,
         coalesce(min(e.id), 0), coalesce(max(e.id), 0), count(*),
         -- sha256() e do pg_catalog: nao depende do pgcrypto nem de USAGE em
         -- `public`, que a §3.1 revoga de PUBLIC. Com digest(), o selo falharia
         -- com 42883 na primeira execucao noturna, em silencio.
         sha256(
           coalesce(v_prev, ''::bytea) ||
           convert_to(coalesce(string_agg(
               e.id || '|' ||
               to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '|' ||
               e.event_type || '|' || e.outcome || '|' ||
               coalesce(e.entity_id::text, ''),
             E'\n' ORDER BY e.id), ''), 'UTF8')),
         v_prev, v_xmin
    FROM audit.event e
   WHERE e.tenant_id = p_tenant
     AND e.occurred_at >= p_date::timestamptz
     AND e.occurred_at <  v_cut
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION audit.seal_day(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.seal_day(uuid, date) TO jobs;

-- O selo precisa gravar a PROPRIA execucao, senao o dead man's switch abaixo
-- responde 'nunca_executou' para sempre e o alarme e desligado na primeira
-- semana. 'adiado' (55006) nao e erro e nao e sinal de vida: e um estado.
GRANT EXECUTE ON FUNCTION audit.log_security(
  text,text,text,text,uuid,uuid,uuid,uuid,text,uuid,uuid,inet,jsonb) TO jobs;

CREATE FUNCTION audit.run_seal(p_tenant uuid, p_date date) RETURNS text
LANGUAGE plpgsql
SET search_path = audit, pg_catalog AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_outcome text;
  v_detail  text;
BEGIN
  BEGIN
    PERFORM audit.seal_day(p_tenant, p_date);
    v_outcome := 'sucesso';
  EXCEPTION
    WHEN sqlstate '55006' THEN
      v_outcome := 'adiado';  v_detail := SQLERRM;
    WHEN OTHERS THEN
      v_outcome := 'erro';    v_detail := SQLERRM;
  END;

  INSERT INTO audit.seal_run
         (tenant_id, seal_date, started_at, finished_at, outcome, detail)
  VALUES (p_tenant, p_date, v_started, clock_timestamp(), v_outcome, v_detail);

  PERFORM audit.log_security(
    'SEAL_RUN',
    CASE WHEN v_outcome = 'erro' THEN 'erro' ELSE 'sucesso' END,
    'audit', 'seal', NULL, p_tenant, NULL, NULL, 'system', NULL, NULL, NULL,
    jsonb_build_object('seal_date', p_date::text, 'job_name', 'seal',
                       'reason', v_outcome));

  RETURN v_outcome;
END $$;

REVOKE ALL ON FUNCTION audit.run_seal(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.run_seal(uuid, date) TO jobs;

-- DEAD MAN'S SWITCH. O selo e a unica garantia real de imutabilidade, e job que
-- para nao faz barulho. Alarme por AUSENCIA de execucao, nao so por erro:
-- execucao que terminou em 'erro' ou 'adiado' NAO conta como sinal de vida.
CREATE FUNCTION audit.seal_watchdog(p_max_atraso interval DEFAULT interval '26 hours')
RETURNS TABLE (status text, ultima_execucao timestamptz, atraso interval)
LANGUAGE sql STABLE
SET search_path = audit, pg_catalog AS $$
  SELECT CASE
           WHEN max(r.started_at) IS NULL                          THEN 'nunca_executou'
           WHEN clock_timestamp() - max(r.started_at) > p_max_atraso THEN 'ausente'
           ELSE 'ok'
         END,
         max(r.started_at),
         clock_timestamp() - max(r.started_at)
    FROM audit.seal_run r
   WHERE r.outcome = 'sucesso';
$$;

REVOKE ALL ON FUNCTION audit.seal_watchdog(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.seal_watchdog(interval) TO jobs, app_rw;

RESET ROLE;
```

- [ ] **Passo 4: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/audit/test/seal.int.test.ts
```

Esperado: `aplicada: 0014_audit_seal.sql` e PASSA, 12 testes verdes.

Se o caso `a marca d agua exige pg_read_all_stats em jobs` falhar, o `GRANT` do bloco `DO` não teve privilégio: acrescentar `GRANT pg_read_all_stats TO jobs;` ao script de bootstrap de papéis, que roda como superusuário, e rodar `pnpm db:reset && pnpm db:migrate`.

- [ ] **Passo 5: Rodar a suíte inteira do pacote e a suíte de isolamento**

Rodar:

```bash
pnpm test:int packages/audit
pnpm test:iso
```

Esperado: PASSA nas duas. As três tabelas novas (`audit.read_dedup`, `audit.seal`, `audit.seal_run`) já nascem com `tenant_id`, RLS habilitada, forçada e policy — que é o que a varredura de catálogo da suíte de isolamento exige de toda tabela em `app clin fin tiss audit`.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0014_audit_seal.sql \
        packages/audit/test/seal.int.test.ts
git commit -m "feat(audit): daily seal with visibility watermark and dead man's switch"
```

---

## Parte V — Autenticação, autorização e catálogos

> **Contexto que o engenheiro precisa antes de começar.** Esta parte constrói três coisas que não têm tela e não podem ser retrofitadas: (1) a separação entre **identidade global** e **vínculo por tenant**, (2) a autenticação com **sessão opaca** (token aleatório no banco, nunca JWT com claim de tenant), e (3) o catálogo de terminologia **versionado por data do evento**. O entregável continua sendo o teste verde.
>
> **Três convenções que valem para todas as tarefas abaixo e que, se ignoradas, produzem código que o CI derruba depois.**
>
> 1. **Irmão não importa irmão, e a regra vale para `packages/kernel` também.** `authn`, `authz`, `db`, `audit` e `kernel` são todos L0 (§2.2 regra 2, proibição absoluta). Por isso `packages/authn/src/*` **não** importa `@cadencia/db`, `@cadencia/kernel` nem `@cadencia/audit`: as funções recebem a conexão, o gerador de id e o canal de auditoria **por parâmetro**, e quem compõe é L3 (`apps/api`). Onde há duplicação (o `Result` de `authn`, a lista de papéis de `membership.ts`), ela é **intencional** e vem acompanhada de um teste que impede as duas cópias de divergirem. **Arquivos de teste podem importar irmãos** — eles não são código de produção e não entram no grafo de módulos.
> 2. **Nenhum arquivo fora de `packages/kernel/src/clock.ts` e `uuid.ts` lê o relógio do sistema.** O guarda `tools/repo/time-source.ts` (Task 21) reprova `Date.now(` e `new Date(` em todo `packages/**` e `apps/**` que não seja teste, e a instrução dele é explícita: a correção nunca é acrescentar o arquivo à allowlist. É por isso que `verifyTotpForUser` recebe o `Clock` como parâmetro **obrigatório** e que toda janela de sessão é calculada com `clock_timestamp()` dentro do SQL.
> 3. **Migrations continuam em `packages/db/migrations/`**, criadas com `pnpm db:new <nome>`. Esta parte usa `0015`–`0020`. Testes de unidade terminam em `.test.ts` e rodam com `pnpm test <caminho>`; testes que precisam de PostgreSQL terminam em `.int.test.ts` e rodam com `pnpm test:int <caminho>`.
>
> **Atenção ao que já existe:** `id."user"`, `app.membership` e `app.professional` foram criados na **migration 0004** (Task 9), junto com `app.is_member()`, `app.has_role_in()` e `app.current_professional_id()`. A migration 0006 já lhes deu GRANTs e a policy `tenant_isolation`. A Task 32 **estende** essas tabelas; não as recria.

---

### Task 32: Credencial da identidade global e o pool do papel `jobs`

**Por que esta tarefa existe (§10 item 2).** O médico tem **um** certificado ICP-Brasil, logo **uma** identidade. Se a credencial nascer dentro do tenant, o mesmo CPF vira N usuários, a assinatura de um não vale para o outro, e a trilha de auditoria — que é append-only — passa a apontar para atores duplicados. Separar depois significa reescrever `authn`, reescrever `authz` e **reindexar uma trilha que não pode ser reescrita**. `id."user"` já nasceu global e sem `tenant_id` na 0004; falta a credencial (`id.user_credential`), faltam as colunas que `authn` precisa (`cpf`, `status`) e faltam as colunas de proveniência do vínculo (`granted_by`, `revoked_reason`).

E falta um pool: os *fixtures* de teste de tudo o que vem daqui em diante montam cenário com o papel `jobs`, o único do cluster com `BYPASSRLS`. `BYPASSRLS` ignora **POLICY**, **não** ignora **GRANT** — por isso a migration também concede privilégio de tabela a `jobs`, senão toda suíte `.int.test.ts` desta parte falha com `permission denied for table` (42501).

**Arquivos:**
- Modificar: `packages/db/src/pool.ts` (acrescentar `jobsPool`)
- Modificar: `packages/db/src/index.ts`
- Criar: `packages/db/migrations/0015_identity_credentials.sql`
- Teste: `packages/authn/src/identity-global.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authn/src/identity-global.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';

// jobsPool usa o papel `jobs`, o unico do cluster com BYPASSRLS. Serve APENAS
// para montar cenario; toda asserticao roda por withTenantTx, sujeita a RLS.
async function seedTenant(nome: string): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES ($1, $2, $3, $4)`,
    [tenantId, `t-${tenantId.slice(0, 8)}`, nome, '12ABC34501DE35'],
  );
  await jobsPool().query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES ($1, $2, $3, $4)`,
    [tenantId, clinicId, `${nome} - Unidade Centro`, 'America/Sao_Paulo'],
  );
  return { tenantId, clinicId };
}

async function seedUser(fullName: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, fullName],
  );
  return userId;
}

async function grant(
  tenantId: string, clinicId: string, userId: string, role: string,
): Promise<string> {
  const id = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, id, userId, clinicId, role],
  );
  return id;
}

describe('identidade global x vinculo por tenant', () => {
  it('id.user nao tem coluna tenant_id: a credencial do medico e unica, nao por clinica', async () => {
    const { rows } = await jobsPool().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'id' AND table_name = 'user'`,
    );
    const colunas = rows.map((r) => r.column_name as string);
    expect(colunas).toContain('id');
    expect(colunas).toContain('email');
    expect(colunas).toContain('cpf');
    expect(colunas).toContain('status');
    expect(colunas).not.toContain('tenant_id');
  });

  it('a credencial mora fora do tenant: id.user_credential tambem nao tem tenant_id', async () => {
    const { rows } = await jobsPool().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'id' AND table_name = 'user_credential'`,
    );
    const colunas = rows.map((r) => r.column_name as string);
    expect(colunas).toContain('password_hash');
    expect(colunas).toContain('locked_until');
    expect(colunas).not.toContain('tenant_id');
  });

  it('o mesmo medico e admin em uma rede e recepcao em outra, sem duplicar identidade', async () => {
    const sp = await seedTenant('Clinica Sao Paulo');
    const manaus = await seedTenant('Clinica Manaus');
    const userId = await seedUser('Dra. Ana Ribeiro');
    await grant(sp.tenantId, sp.clinicId, userId, 'admin_clinico');
    await grant(manaus.tenantId, manaus.clinicId, userId, 'recepcao');

    const emSp = await withTenantTx(
      { kind: 'user', tenantId: sp.tenantId, userId, clinicId: sp.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ pode: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS pode`, [sp.clinicId],
      ),
    );
    expect(emSp.rows[0]?.pode).toBe(true);

    const emManaus = await withTenantTx(
      { kind: 'user', tenantId: manaus.tenantId, userId, clinicId: manaus.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ pode: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS pode`, [manaus.clinicId],
      ),
    );
    expect(emManaus.rows[0]?.pode).toBe(false);
  });

  it('vinculo revogado para de valer imediatamente, e o motivo fica registrado', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedUser('Dr. Bruno Camargo');
    const membershipId = await grant(t.tenantId, t.clinicId, userId, 'profissional');

    const antes = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ membro: boolean }>(`SELECT app.is_member() AS membro`),
    );
    expect(antes.rows[0]?.membro).toBe(true);

    await jobsPool().query(
      `UPDATE app.membership
          SET revoked_at = clock_timestamp(), revoked_reason = $2
        WHERE id = $1`,
      [membershipId, 'desligamento'],
    );

    const depois = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ membro: boolean }>(`SELECT app.is_member() AS membro`),
    );
    expect(depois.rows[0]?.membro).toBe(false);
  });

  it('o vinculo do tenant A e invisivel dentro do contexto do tenant B', async () => {
    const a = await seedTenant('Clinica A');
    const b = await seedTenant('Clinica B');
    const userId = await seedUser('Dra. Carla Nunes');
    await grant(a.tenantId, a.clinicId, userId, 'admin_clinico');
    await grant(b.tenantId, b.clinicId, userId, 'admin_clinico');

    const vistoDeB = await withTenantTx(
      { kind: 'user', tenantId: b.tenantId, userId, clinicId: b.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.membership WHERE tenant_id = $1`, [a.tenantId],
      ),
    );
    expect(vistoDeB.rows[0]?.n).toBe(0);

    // E o pool de jobs, que e o unico com BYPASSRLS, enxerga os dois. E por isso
    // que ele monta cenario e NUNCA serve caminho de requisicao.
    const doJobs = await jobsPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.membership WHERE user_id = $1`, [userId],
    );
    expect(Number(doJobs.rows[0]?.n)).toBe(2);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/authn/src/identity-global.int.test.ts`
Esperado: FALHA já na importação — `SyntaxError: The requested module '@cadencia/db' does not provide an export named 'jobsPool'`.

- [ ] **Passo 3: Acrescentar o pool do papel `jobs`**

Modificar `packages/db/src/pool.ts` — acrescentar a variável de módulo, a função e a nova versão de `closePools`.

Logo abaixo de `let audit: Pool | undefined;`, acrescentar:

```ts
let jobs: Pool | undefined;
```

Logo depois da função `auditPool()`, acrescentar:

```ts
/**
 * Pool do papel `jobs` — o UNICO do cluster com BYPASSRLS (§3.1). Existe para
 * selo diario, detector de divergencia do financeiro, carga bimestral da TUSS e
 * montagem de cenario nos testes. NUNCA serve caminho de requisicao: aqui a RLS
 * nao filtra nada, e o isolamento entre clinicas deixa de existir.
 *
 * BYPASSRLS ignora POLICY, nao ignora GRANT: cada migration que cria tabela usada
 * por job ou por fixture precisa conceder privilegio a `jobs` explicitamente.
 */
export function jobsPool(): Pool {
  jobs ??= new Pool({
    connectionString: requireEnv('DATABASE_URL_JOBS'),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'cadencia-jobs',
  });
  return jobs;
}
```

Substituir a função `closePools` inteira por:

```ts
/** Fecha todos os pools. Usado no shutdown do processo e entre arquivos de teste. */
export async function closePools(): Promise<void> {
  const pools = [business, audit, jobs].filter((p): p is Pool => p !== undefined);
  business = undefined;
  audit = undefined;
  jobs = undefined;
  await Promise.all(pools.map((p) => p.end()));
}
```

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, jobsPool, closePools } from './pool';
export { withTenantTx, preambleParams, type Actor, type TxClient } from './tx';
```

- [ ] **Passo 4: Rodar de novo e confirmar que a falha mudou**

Rodar: `pnpm test:int packages/authn/src/identity-global.int.test.ts`
Esperado: FALHA com `error: permission denied for schema app` (SQLSTATE `42501`) no primeiro `INSERT INTO app.tenant`. É o `BYPASSRLS` ignorando POLICY e **não** ignorando GRANT, exatamente como descrito acima.

- [ ] **Passo 5: Escrever a migration**

Rodar: `pnpm db:new identity_credentials` — cria `packages/db/migrations/0015_identity_credentials.sql`. Preencher com exatamente:

```sql
-- 0015_identity_credentials.sql
-- Identidade GLOBAL (§10 item 2). id."user" e app.membership ja existem desde a
-- 0004: esta migration ESTENDE, nunca recria. O medico tem UM certificado
-- ICP-Brasil, logo UMA identidade; nada aqui tem tenant_id.

-- Colunas que `authn` precisa e que a 0004 nao tinha.
ALTER TABLE id."user"
  ADD COLUMN cpf    varchar(11) CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
  ADD COLUMN status text NOT NULL DEFAULT 'ativo'
             CHECK (status IN ('ativo','suspenso','desativado'));

-- Proveniencia do vinculo: quem concedeu e por que foi revogado. Sem
-- revoked_reason, "o vinculo sumiu" nao tem explicacao em auditoria.
ALTER TABLE app.membership
  ADD COLUMN granted_by     uuid,
  ADD COLUMN revoked_reason text;

CREATE TABLE id.user_credential (
  user_id             uuid PRIMARY KEY REFERENCES id."user"(id),
  password_hash       text NOT NULL,
  password_updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  failed_attempts     int NOT NULL DEFAULT 0,
  locked_until        timestamptz(3)
);
ALTER TABLE id.user_credential OWNER TO app_owner;
COMMENT ON TABLE id.user_credential IS 'global-reference';

-- A aplicacao le e grava a credencial, mas nunca o id do dono: trocar user_id
-- seria transferir a senha de uma pessoa para outra.
GRANT SELECT, INSERT ON id.user_credential TO app_rw;
GRANT UPDATE (password_hash, password_updated_at, failed_attempts, locked_until)
  ON id.user_credential TO app_rw;

-- O papel `jobs` (unico do cluster com BYPASSRLS) monta cenario de teste e roda
-- carga. BYPASSRLS ignora POLICY, NAO ignora GRANT: sem estas linhas toda suite
-- .int.test.ts do repositorio falha com "permission denied for table" (42501).
GRANT USAGE ON SCHEMA app, id TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.tenant            TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.clinic            TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.membership        TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON id."user"             TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON id.user_credential    TO jobs;
```

- [ ] **Passo 6: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/authn/src/identity-global.int.test.ts
```

Esperado: `aplicada: 0015_identity_credentials.sql` e PASSA, 5 testes verdes.

- [ ] **Passo 7: Commitar**

```bash
git add packages/db/migrations/0015_identity_credentials.sql \
        packages/db/src/pool.ts packages/db/src/index.ts \
        packages/authn/src/identity-global.int.test.ts
git commit -m "feat(identity): global user credentials and the BYPASSRLS jobs pool"
```

---

### Task 33: Hash de senha com Argon2id

A senha da recepcionista é digitada num Windows (que compõe o acento, NFC) e conferida num macOS (que às vezes entrega a forma decomposta, NFD). São dois strings diferentes para o mesmo que o usuário digitou. Normalizar para NFC no cadastro **e** na verificação é o que impede o chamado "minha senha parou de funcionar quando troquei de computador".

**Arquivos:**
- Criar: `packages/authn/src/password.ts`
- Modificar: `packages/authn/package.json` (dependência `@node-rs/argon2`)
- Teste: `packages/authn/src/password.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authn/src/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from './password';

describe('hash de senha com Argon2id', () => {
  it('aceita a senha correta e recusa a errada', async () => {
    const hash = await hashPassword('Consultorio#2026');
    await expect(verifyPassword(hash, 'Consultorio#2026')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'consultorio#2026')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
  });

  it('grava um hash Argon2id parametrizado e nunca a senha em claro', async () => {
    const hash = await hashPassword('Consultorio#2026');
    expect(hash).not.toContain('Consultorio');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('duas gravacoes da mesma senha produzem hashes diferentes (salt por linha)', async () => {
    const a = await hashPassword('Consultorio#2026');
    const b = await hashPassword('Consultorio#2026');
    expect(a).not.toEqual(b);
    await expect(verifyPassword(a, 'Consultorio#2026')).resolves.toBe(true);
    await expect(verifyPassword(b, 'Consultorio#2026')).resolves.toBe(true);
  });

  it('senha com acento digitada em teclado que compoe o acento (NFD) continua autenticando', async () => {
    // Caso real: a recepcionista cadastra "Recepção@2026" no Windows (NFC) e
    // entra pelo macOS, onde o navegador entrega a forma decomposta (NFD).
    const nfc = 'Recep\u00e7\u00e3o@2026';
    const nfd = 'Recepc\u0327a\u0303o@2026';
    expect(nfc).not.toEqual(nfd);
    const hash = await hashPassword(nfc);
    await expect(verifyPassword(hash, nfd)).resolves.toBe(true);
  });

  it('hash corrompido no banco falha fechado, sem lancar excecao', async () => {
    await expect(verifyPassword('$2y$10$hashDeOutroSistema', 'Consultorio#2026')).resolves.toBe(false);
    await expect(verifyPassword('', 'Consultorio#2026')).resolves.toBe(false);
  });

  it('hash de outro algoritmo ou de parametros antigos e marcado para rehash no proximo login', async () => {
    expect(needsRehash('$2y$10$hashDeOutroSistema')).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$abc$def')).toBe(true);
    expect(needsRehash(await hashPassword('Consultorio#2026'))).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test packages/authn/src/password.test.ts`
Esperado: FALHA com `Failed to resolve import "./password" from "packages/authn/src/password.test.ts". Does the file exist?`

- [ ] **Passo 3: Instalar a dependência e implementar**

```bash
pnpm add @node-rs/argon2 --filter @cadencia/authn
```

Criar `packages/authn/src/password.ts`:

```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Parametros minimos recomendados pela OWASP para Argon2id (19 MiB, 2 iteracoes,
 * paralelismo 1). Mudar qualquer valor aqui obriga a mudar PREFIXO_ATUAL abaixo,
 * senao needsRehash() para de detectar hashes antigos e ninguem nunca migra.
 */
export const ARGON2ID_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const PREFIXO_ATUAL = '$argon2id$v=19$m=19456,t=2,p=1$';

/**
 * Unifica a forma Unicode: NFC no cadastro e no login. Sem isto, "Recepção@2026"
 * digitado no Windows e no macOS sao dois strings diferentes.
 */
function normalizar(plain: string): string {
  return plain.normalize('NFC');
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(normalizar(plain), ARGON2ID_PARAMS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (storedHash.length === 0) return false;
  try {
    return await verify(storedHash, normalizar(plain), ARGON2ID_PARAMS);
  } catch {
    // Hash corrompido, truncado ou de outro algoritmo: falha fechada.
    return false;
  }
}

export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith(PREFIXO_ATUAL);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test packages/authn/src/password.test.ts`
Esperado: PASSA — 6 testes verdes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/authn/src/password.ts packages/authn/src/password.test.ts \
        packages/authn/package.json pnpm-lock.yaml
git commit -m "feat(authn): Argon2id password hashing with NFC normalization and fail-closed verify"
```

---

### Task 34: Sessão opaca — o token vive no banco, e revogar mata na hora

**Por que não JWT.** Um JWT com claim de tenant é um cheque assinado que o servidor não consegue cancelar: enquanto não expira, ele vale. Neste produto isso é inaceitável por três motivos concretos — desligamento de funcionário, `revoked_at` no vínculo, e break-glass do suporte. A sessão é **opaca**: 32 bytes aleatórios entregues ao navegador, `sha256` do token guardado no banco. Toda requisição consulta a linha; revogar é um `UPDATE`, e o efeito é imediato. O teste `REVOGAR MATA NA HORA` do Passo 1 existe exatamente para provar isso.

Repare também: `id.session` fica no schema `id`, que é global e **sem RLS** — e é por isso que a sessão pode ser resolvida **antes** de existir contexto de tenant. Se a sessão morasse em `app`, a resolução dependeria do tenant que ainda não foi escolhido.

E é por isso que ela **não** pode passar por `withTenantTx`: aquela função exige tenant e abre transação de negócio. O caminho é um pool próprio, `appPool()`, que executa `SET ROLE app_rw` em cada conexão nova — porque `api` é `NOINHERIT` e sem o `SET ROLE` toda query retorna 42501.

**Arquivos:**
- Modificar: `packages/db/src/pool.ts` (acrescentar `appPool`)
- Modificar: `packages/db/src/index.ts`
- Criar: `packages/authn/src/result.ts`
- Criar: `packages/authn/src/session.ts`
- Criar: `packages/db/migrations/0016_session.sql`
- Teste: `packages/authn/src/session.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authn/src/session.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import {
  createSession, resolveSession, revokeSession, revokeAllSessionsOfUser, hashSessionToken,
} from './session';

async function seedUser(fullName: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, fullName],
  );
  return userId;
}

describe('sessao opaca', () => {
  it('o pool de aplicacao assume app_rw sozinho: `api` e NOINHERIT', async () => {
    const { rows } = await appPool().query<{ papel: string }>('SELECT current_user AS papel');
    expect(rows[0]?.papel).toBe('app_rw');
  });

  it('resolve uma sessao recem-criada e devolve o usuario dono dela', async () => {
    const userId = await seedUser('Dra. Ana Ribeiro');
    const { token, sessionId } = await createSession(appPool(), { userId });

    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.userId).toBe(userId);
    expect(r.value.sessionId).toBe(sessionId);
  });

  it('REVOGAR MATA NA HORA: a requisicao seguinte ja e recusada', async () => {
    // Esta e a razao de a sessao nao ser JWT. Com token assinado, este teste
    // so poderia passar com uma lista de revogacao consultada no banco --
    // ou seja, com o mesmo custo e sem nenhuma das vantagens.
    const userId = await seedUser('Dr. Bruno Camargo');
    const { token, sessionId } = await createSession(appPool(), { userId });
    expect((await resolveSession(appPool(), token)).ok).toBe(true);

    await revokeSession(appPool(), sessionId, 'desligamento');

    const depois = await resolveSession(appPool(), token);
    expect(depois.ok).toBe(false);
    if (depois.ok) return;
    expect(depois.error).toBe('revogada');
  });

  it('o token nunca fica em claro no banco: so o sha256 dele', async () => {
    const userId = await seedUser('Dra. Carla Nunes');
    const { token, sessionId } = await createSession(appPool(), { userId });

    const { rows } = await jobsPool().query(
      `SELECT token_hash FROM id.session WHERE id = $1`, [sessionId],
    );
    const guardado = rows[0].token_hash as Buffer;
    expect(guardado.length).toBe(32);
    expect(guardado.equals(Buffer.from(token, 'utf8'))).toBe(false);
    expect(guardado.equals(hashSessionToken(token))).toBe(true);
  });

  it('token inexistente e recusado sem revelar se ja existiu', async () => {
    const r = await resolveSession(appPool(), 'token-que-nunca-foi-emitido');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('nao_encontrada');
  });

  it('sessao parada alem da janela de inatividade e recusada', async () => {
    const userId = await seedUser('Dr. Diego Alves');
    const { token, sessionId } = await createSession(appPool(), { userId });
    await jobsPool().query(
      `UPDATE id.session SET idle_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [sessionId],
    );
    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('expirada_inatividade');
  });

  it('sessao alem do limite absoluto e recusada mesmo com uso continuo', async () => {
    const userId = await seedUser('Dra. Elisa Prado');
    const { token, sessionId } = await createSession(appPool(), { userId });
    await jobsPool().query(
      `UPDATE id.session SET absolute_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [sessionId],
    );
    const r = await resolveSession(appPool(), token);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('expirada_absoluta');
  });

  it('usar a sessao empurra a janela de inatividade para frente', async () => {
    const userId = await seedUser('Dr. Fabio Lins');
    const { token, sessionId } = await createSession(appPool(), { userId });
    const antes = await jobsPool().query(
      `SELECT idle_expires_at FROM id.session WHERE id = $1`, [sessionId],
    );
    await new Promise((r) => setTimeout(r, 30));
    await resolveSession(appPool(), token);
    const depois = await jobsPool().query(
      `SELECT idle_expires_at FROM id.session WHERE id = $1`, [sessionId],
    );
    expect(new Date(depois.rows[0].idle_expires_at).getTime())
      .toBeGreaterThan(new Date(antes.rows[0].idle_expires_at).getTime());
  });

  it('desligar o funcionario derruba todas as sessoes dele de uma vez', async () => {
    const userId = await seedUser('Dra. Gabriela Souza');
    const s1 = await createSession(appPool(), { userId });
    const s2 = await createSession(appPool(), { userId });

    const n = await revokeAllSessionsOfUser(appPool(), userId, 'desligamento');
    expect(n).toBe(2);
    expect((await resolveSession(appPool(), s1.token)).ok).toBe(false);
    expect((await resolveSession(appPool(), s2.token)).ok).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/authn/src/session.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./session" from "packages/authn/src/session.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Acrescentar o pool da aplicação sem tenant**

Modificar `packages/db/src/pool.ts`.

Logo abaixo de `let jobs: Pool | undefined;`, acrescentar:

```ts
let app: Pool | undefined;
```

Logo depois da função `jobsPool()`, acrescentar:

```ts
/**
 * Pool da aplicacao para o que acontece FORA de uma transacao de negocio:
 * resolucao de sessao (que precisa rodar ANTES de existir tenant) e consulta de
 * terminologia global (`ref.*`, sem RLS). Nunca substitui withTenantTx — nada
 * que leia tabela com tenant_id passa por aqui.
 *
 * `api` foi criado NOINHERIT na 0001: sem o SET ROLE abaixo, toda query retorna
 * 42501. A query e enfileirada na conexao antes de qualquer outra, porque o `pg`
 * mantem uma fila FIFO por cliente.
 */
export function appPool(): Pool {
  if (app === undefined) {
    const created = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'cadencia-app',
    });
    created.on('connect', (client) => {
      void client.query('SET ROLE app_rw').catch(() => undefined);
    });
    app = created;
  }
  return app;
}
```

Substituir a função `closePools` inteira por:

```ts
/** Fecha todos os pools. Usado no shutdown do processo e entre arquivos de teste. */
export async function closePools(): Promise<void> {
  const pools = [business, audit, jobs, app].filter((p): p is Pool => p !== undefined);
  business = undefined;
  audit = undefined;
  jobs = undefined;
  app = undefined;
  await Promise.all(pools.map((p) => p.end()));
}
```

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, jobsPool, appPool, closePools } from './pool';
export { withTenantTx, preambleParams, type Actor, type TxClient } from './tx';
```

- [ ] **Passo 4: Escrever o `Result` local e a sessão**

Criar `packages/authn/src/result.ts`:

```ts
/**
 * Result<T, E> local do pacote `authn`.
 *
 * A forma e IDENTICA a de `packages/kernel/src/result.ts` de proposito, e a
 * duplicacao tambem: `authn` e `kernel` sao irmaos em L0 e import entre irmaos e
 * proibido sem excecao (§2.2 regra 2). Como as duas formas sao estruturalmente
 * iguais, L3 recebe o resultado de `authn` e o trata com as funcoes do kernel
 * sem conversao nenhuma. Se alguem mudar o formato aqui, essa ponte quebra.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
```

Criar `packages/authn/src/session.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { err, ok, type Result } from './result';

/** Superficie minima de conexao. Quem passa o pool e L3 (§2.2 regra 3). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 12;

export type SessionFailure =
  | 'nao_encontrada' | 'revogada' | 'expirada_inatividade' | 'expirada_absoluta';

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  activeClinicId: string | null;
  mfaAt: Date | null;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * O id da sessao e gerado pelo PostgreSQL 18 (`uuidv7()` nativo, DEFAULT da
 * coluna) e nao pelo Node: `authn` nao pode importar o gerador do kernel
 * (§2.2 regra 2) e duplicar o algoritmo seria pior. O efeito colateral e
 * desejavel — o componente temporal do id vem do mesmo relogio que carimba
 * created_at, que e a fonte de tempo persistido do sistema (§3).
 */
export async function createSession(
  db: Queryable,
  input: {
    userId: string;
    activeTenantId?: string | null;
    activeClinicId?: string | null;
    ip?: string | null;
    userAgentHash?: Buffer | null;
  },
): Promise<{ sessionId: string; token: string }> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  // As janelas sao calculadas com clock_timestamp(), nunca com o relogio do Node.
  const { rows } = await db.query(
    `INSERT INTO id.session
       (user_id, token_hash, active_tenant_id, active_clinic_id,
        idle_expires_at, absolute_expires_at, ip, user_agent_hash)
     VALUES ($1, $2, $3, $4,
             clock_timestamp() + make_interval(mins => $5::int),
             clock_timestamp() + make_interval(hours => $6::int),
             $7, $8)
     RETURNING id`,
    [
      input.userId, hashSessionToken(token),
      input.activeTenantId ?? null, input.activeClinicId ?? null,
      SESSION_IDLE_MINUTES, SESSION_ABSOLUTE_HOURS,
      input.ip ?? null, input.userAgentHash ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('id.session insert returned no row');
  return { sessionId: row.id as string, token };
}

export async function resolveSession(
  db: Queryable, token: string,
): Promise<Result<ResolvedSession, SessionFailure>> {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.active_tenant_id, s.active_clinic_id, s.mfa_at,
            s.revoked_at IS NOT NULL                       AS revogada,
            s.idle_expires_at     < clock_timestamp()      AS idle_expirou,
            s.absolute_expires_at < clock_timestamp()      AS absoluta_expirou
       FROM id.session s
      WHERE s.token_hash = $1`,
    [hashSessionToken(token)],
  );
  const row = rows[0];
  if (!row) return err('nao_encontrada');
  if (row.revogada) return err('revogada');
  if (row.absoluta_expirou) return err('expirada_absoluta');
  if (row.idle_expirou) return err('expirada_inatividade');

  await db.query(
    `UPDATE id.session
        SET last_seen_at = clock_timestamp(),
            idle_expires_at = clock_timestamp() + make_interval(mins => $2::int)
      WHERE id = $1`,
    [row.id, SESSION_IDLE_MINUTES],
  );

  return ok({
    sessionId: row.id as string,
    userId: row.user_id as string,
    activeTenantId: (row.active_tenant_id as string | null) ?? null,
    activeClinicId: (row.active_clinic_id as string | null) ?? null,
    mfaAt: (row.mfa_at as Date | null) ?? null,
  });
}

export async function revokeSession(
  db: Queryable, sessionId: string, reason: string,
): Promise<void> {
  await db.query(
    `UPDATE id.session
        SET revoked_at = clock_timestamp(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}

export async function revokeAllSessionsOfUser(
  db: Queryable, userId: string, reason: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE id.session
        SET revoked_at = clock_timestamp(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return rowCount ?? 0;
}
```

- [ ] **Passo 5: Rodar e confirmar que a falha mudou**

Rodar: `pnpm test:int packages/authn/src/session.int.test.ts`
Esperado: FALHA com `error: relation "id.session" does not exist` (SQLSTATE `42P01`).

- [ ] **Passo 6: Escrever a migration**

Rodar: `pnpm db:new session` — cria `packages/db/migrations/0016_session.sql`. Preencher com exatamente:

```sql
-- 0016_session.sql
-- Sessao OPACA (§8 Fase 0). Token aleatorio de 32 bytes entregue ao navegador;
-- no banco fica so o sha256. Nunca JWT com claim de tenant: claim assinada nao
-- se revoga, e desligamento, revogacao de vinculo e break-glass exigem revogacao
-- com efeito imediato.
--
-- Fica no schema `id`, que e global e sem RLS: e por isso que a sessao pode ser
-- resolvida ANTES de existir contexto de tenant. Em `app` a resolucao dependeria
-- do tenant que ainda nao foi escolhido.
CREATE TABLE id.session (
  -- uuidv7() nativo do PostgreSQL 18: `authn` nao pode importar o gerador do
  -- kernel (irmaos em L0, §2.2) e duplicar o algoritmo seria pior.
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id             uuid NOT NULL REFERENCES id."user"(id),
  token_hash          bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  -- Tenant ativo da sessao: e LINHA DE BANCO, revogavel, nao claim assinada.
  active_tenant_id    uuid REFERENCES app.tenant(id),
  active_clinic_id    uuid,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  last_seen_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  idle_expires_at     timestamptz(3) NOT NULL,
  absolute_expires_at timestamptz(3) NOT NULL,
  revoked_at          timestamptz(3),
  revoked_reason      text,
  mfa_at              timestamptz(3),
  ip                  inet,
  user_agent_hash     bytea
);
ALTER TABLE id.session OWNER TO app_owner;
COMMENT ON TABLE id.session IS 'global-reference';

CREATE INDEX ix_session_user_vivo ON id.session (user_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT ON id.session TO app_rw;
-- Sem UPDATE em user_id nem em token_hash: trocar qualquer um dos dois seria
-- transferir a sessao de uma pessoa para outra.
GRANT UPDATE (last_seen_at, idle_expires_at, revoked_at, revoked_reason,
              active_tenant_id, active_clinic_id, mfa_at) ON id.session TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON id.session TO jobs;
```

- [ ] **Passo 7: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/authn/src/session.int.test.ts
```

Esperado: `aplicada: 0016_session.sql` e PASSA, 9 testes verdes.

- [ ] **Passo 8: Commitar**

```bash
git add packages/db/migrations/0016_session.sql packages/db/src/pool.ts \
        packages/db/src/index.ts packages/authn/src/result.ts \
        packages/authn/src/session.ts packages/authn/src/session.int.test.ts
git commit -m "feat(authn): opaque server-side sessions with immediate revocation"
```

---

### Task 35: TOTP com `otpauth` — sem SMS, com segredo cifrado e sem replay

SMS não entra: portabilidade de chip e SIM swap são vetor conhecido no Brasil, e o segundo fator que chega por SMS protege exatamente contra quem já conseguiu a senha. O segredo TOTP é cifrado com AES-256-GCM antes de ir para o banco, e o último passo de 30 segundos consumido fica gravado — sem isso, o código de 6 dígitos lido por cima do ombro vale por 90 segundos para quem o interceptou.

**Repare no `Clock` obrigatório.** `verifyTotpForUser` não tem relógio padrão. Não é rigor gratuito: o guarda `tools/repo/time-source.ts` reprova `new Date(` em qualquer arquivo de `packages/**` que não seja `kernel/clock.ts` ou `kernel/uuid.ts`, e a instrução dele diz que a correção nunca é acrescentar o arquivo à allowlist. Quem escolhe o relógio é L3.

**Arquivos:**
- Criar: `packages/authn/src/totp.ts`
- Modificar: `packages/authn/package.json` (dependência `otpauth`)
- Criar: `packages/db/migrations/0017_totp.sql`
- Teste: `packages/authn/src/totp.test.ts`
- Teste: `packages/authn/src/totp.int.test.ts`

- [ ] **Passo 1: Escrever o teste unitário que falha**

Criar `packages/authn/src/totp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { randomBytes } from 'node:crypto';
import {
  newTotpSecret, totpUri, verifyTotpAgainstStep, encryptTotpSecret, decryptTotpSecret,
  TOTP_PERIOD_SECONDS,
} from './totp';

function codigoEm(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Cadencia', label: 'teste', algorithm: 'SHA1', digits: 6,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

describe('TOTP', () => {
  const agora = new Date('2026-08-03T14:00:00.000Z');

  it('aceita o codigo do passo atual', () => {
    const secret = newTotpSecret();
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, agora), agora, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(Math.floor(agora.getTime() / 1000 / TOTP_PERIOD_SECONDS));
  });

  it('aceita o codigo do passo anterior: o celular do medico atrasa alguns segundos', () => {
    const secret = newTotpSecret();
    const trintaSegundosAntes = new Date(agora.getTime() - 30_000);
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, trintaSegundosAntes), agora, null);
    expect(r.ok).toBe(true);
  });

  it('recusa codigo de dois minutos atras', () => {
    const secret = newTotpSecret();
    const doisMinutosAntes = new Date(agora.getTime() - 120_000);
    const r = verifyTotpAgainstStep(secret, codigoEm(secret, doisMinutosAntes), agora, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_invalido');
  });

  it('recusa o mesmo codigo usado duas vezes: quem leu por cima do ombro nao entra', () => {
    const secret = newTotpSecret();
    const codigo = codigoEm(secret, agora);
    const primeira = verifyTotpAgainstStep(secret, codigo, agora, null);
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;

    const segunda = verifyTotpAgainstStep(secret, codigo, agora, primeira.value);
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.error).toBe('codigo_reutilizado');
  });

  it('recusa codigo com formato invalido sem lancar excecao', () => {
    const secret = newTotpSecret();
    for (const lixo of ['', '12345', 'abcdef', '1234567']) {
      const r = verifyTotpAgainstStep(secret, lixo, agora, null);
      expect(r.ok).toBe(false);
    }
  });

  it('a URI de cadastro identifica o emissor e a conta', () => {
    const secret = newTotpSecret();
    const uri = totpUri('ana.ribeiro@clinica.com.br', secret);
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Cadencia');
    expect(uri).toContain('period=30');
  });

  it('o segredo e cifrado antes de ir para o banco e volta identico', () => {
    const key = randomBytes(32);
    const secret = newTotpSecret();
    const blob = encryptTotpSecret(secret, key);
    expect(blob.toString('utf8')).not.toContain(secret);
    expect(decryptTotpSecret(blob, key)).toBe(secret);
  });

  it('segredo cifrado com outra chave nao decifra', () => {
    const blob = encryptTotpSecret(newTotpSecret(), randomBytes(32));
    expect(() => decryptTotpSecret(blob, randomBytes(32))).toThrow();
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test packages/authn/src/totp.test.ts`
Esperado: FALHA com `Failed to resolve import "./totp" from "packages/authn/src/totp.test.ts". Does the file exist?`

- [ ] **Passo 3: Instalar a dependência e implementar o módulo**

```bash
pnpm add otpauth --filter @cadencia/authn
```

Criar `packages/authn/src/totp.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { err, ok, type Result } from './result';
import type { Queryable } from './session';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Janela de 1 passo para cada lado: tolera ate 30 s de drift no celular. */
export const TOTP_WINDOW = 1;
const ISSUER = 'Cadencia';

/**
 * Relogio injetado. Declarado aqui e nao importado de @cadencia/kernel porque
 * `authn` e `kernel` sao irmaos em L0 (§2.2 regra 2). NAO existe valor padrao:
 * `new Date()` neste arquivo seria reprovado pelo guarda tools/repo/time-source.ts,
 * cuja regra e explicita — a correcao nunca e acrescentar o arquivo a allowlist.
 */
export interface Clock {
  now(): Date;
}

export type TotpFailure = 'codigo_invalido' | 'codigo_reutilizado' | 'nao_cadastrado';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER, label, algorithm: 'SHA1', digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  });
}

export function totpUri(email: string, secretBase32: string): string {
  return totp(secretBase32, email).toString();
}

export function stepAt(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Valida o codigo e devolve o PASSO aceito. `lastAcceptedStep` e o ultimo passo
 * ja consumido por este usuario: sem ele, o mesmo codigo de 6 digitos vale por
 * 90 segundos para quem o interceptar.
 */
export function verifyTotpAgainstStep(
  secretBase32: string, code: string, at: Date, lastAcceptedStep: number | null,
): Result<number, TotpFailure> {
  if (!/^[0-9]{6}$/.test(code)) return err('codigo_invalido');
  let delta: number | null;
  try {
    delta = totp(secretBase32, 'x').validate({
      token: code, timestamp: at.getTime(), window: TOTP_WINDOW,
    });
  } catch {
    return err('codigo_invalido');
  }
  if (delta === null) return err('codigo_invalido');
  const step = stepAt(at) + delta;
  if (lastAcceptedStep !== null && step <= lastAcceptedStep) return err('codigo_reutilizado');
  return ok(step);
}

/** AES-256-GCM: [12 bytes IV][16 bytes tag][ciphertext]. */
export function encryptTotpSecret(secretBase32: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptTotpSecret(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export async function enrollTotp(
  db: Queryable, userId: string, key: Buffer,
): Promise<{ secretBase32: string; uri: string; email: string }> {
  const secretBase32 = newTotpSecret();
  const { rows } = await db.query(`SELECT email FROM id."user" WHERE id = $1`, [userId]);
  const email = rows[0]?.email as string;
  await db.query(
    `INSERT INTO id.user_totp (user_id, secret_ciphertext)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_ciphertext = EXCLUDED.secret_ciphertext,
           confirmed_at = NULL, last_accepted_step = NULL`,
    [userId, encryptTotpSecret(secretBase32, key)],
  );
  return { secretBase32, uri: totpUri(email, secretBase32), email };
}

export async function verifyTotpForUser(
  db: Queryable, userId: string, code: string, key: Buffer, clock: Clock,
): Promise<Result<number, TotpFailure>> {
  const { rows } = await db.query(
    `SELECT secret_ciphertext, last_accepted_step FROM id.user_totp WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return err('nao_cadastrado');

  const secret = decryptTotpSecret(row.secret_ciphertext as Buffer, key);
  const last = row.last_accepted_step === null ? null : Number(row.last_accepted_step);
  const r = verifyTotpAgainstStep(secret, code, clock.now(), last);
  if (!r.ok) return r;

  // Consome o passo. A condicao no WHERE fecha a corrida entre duas abas.
  const upd = await db.query(
    `UPDATE id.user_totp
        SET last_accepted_step = $2, confirmed_at = coalesce(confirmed_at, clock_timestamp())
      WHERE user_id = $1
        AND (last_accepted_step IS NULL OR last_accepted_step < $2)`,
    [userId, r.value],
  );
  if ((upd.rowCount ?? 0) === 0) return err('codigo_reutilizado');
  return r;
}
```

- [ ] **Passo 4: Rodar e confirmar que o teste unitário passa**

Rodar: `pnpm test packages/authn/src/totp.test.ts`
Esperado: PASSA — 8 testes verdes.

- [ ] **Passo 5: Escrever o teste de integração que falha**

Criar `packages/authn/src/totp.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import { enrollTotp, verifyTotpForUser, TOTP_PERIOD_SECONDS } from './totp';

const KEY = randomBytes(32);
const AGORA = new Date('2026-08-03T14:00:00.000Z');
const relogioFixo = { now: () => AGORA };

async function seedUser(): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  return userId;
}

function codigoEm(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Cadencia', label: 'teste', algorithm: 'SHA1', digits: 6,
    period: TOTP_PERIOD_SECONDS, secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

describe('TOTP persistido', () => {
  it('o segredo nao fica legivel no banco', async () => {
    const userId = await seedUser();
    const { secretBase32 } = await enrollTotp(appPool(), userId, KEY);
    const { rows } = await jobsPool().query(
      `SELECT secret_ciphertext FROM id.user_totp WHERE user_id = $1`, [userId],
    );
    expect((rows[0].secret_ciphertext as Buffer).toString('utf8')).not.toContain(secretBase32);
  });

  it('o mesmo codigo nao entra duas vezes, mesmo dentro dos 30 segundos', async () => {
    const userId = await seedUser();
    const { secretBase32 } = await enrollTotp(appPool(), userId, KEY);
    const codigo = codigoEm(secretBase32, AGORA);

    const primeira = await verifyTotpForUser(appPool(), userId, codigo, KEY, relogioFixo);
    expect(primeira.ok).toBe(true);

    const segunda = await verifyTotpForUser(appPool(), userId, codigo, KEY, relogioFixo);
    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;
    expect(segunda.error).toBe('codigo_reutilizado');
  });

  it('usuario sem TOTP cadastrado falha fechado', async () => {
    const userId = await seedUser();
    const r = await verifyTotpForUser(appPool(), userId, '123456', KEY, relogioFixo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('nao_cadastrado');
  });
});
```

- [ ] **Passo 6: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/authn/src/totp.int.test.ts`
Esperado: FALHA com `error: relation "id.user_totp" does not exist` (SQLSTATE `42P01`).

- [ ] **Passo 7: Escrever a migration**

Rodar: `pnpm db:new totp` — cria `packages/db/migrations/0017_totp.sql`. Preencher com exatamente:

```sql
-- 0017_totp.sql
-- Segundo fator por TOTP (§2.3: `otpauth`, TOTP sem SMS). SMS nao entra:
-- portabilidade de chip e SIM swap sao vetor conhecido no Brasil, e o fator
-- que chega por SMS protege justamente contra quem ja tem a senha.
CREATE TABLE id.user_totp (
  user_id            uuid PRIMARY KEY REFERENCES id."user"(id),
  secret_ciphertext  bytea NOT NULL,   -- AES-256-GCM, chave em Secrets Manager
  created_at         timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  confirmed_at       timestamptz(3),
  -- Ultimo passo de 30 s ja consumido: e o que impede replay do codigo lido
  -- por cima do ombro dentro da janela de validade.
  last_accepted_step bigint
);
ALTER TABLE id.user_totp OWNER TO app_owner;
COMMENT ON TABLE id.user_totp IS 'global-reference';

GRANT SELECT, INSERT ON id.user_totp TO app_rw;
GRANT UPDATE (secret_ciphertext, confirmed_at, last_accepted_step) ON id.user_totp TO app_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON id.user_totp TO jobs;
```

- [ ] **Passo 8: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/authn/src/totp.int.test.ts
```

Esperado: `aplicada: 0017_totp.sql` e PASSA, 3 testes verdes.

- [ ] **Passo 9: Commitar**

```bash
git add packages/db/migrations/0017_totp.sql packages/authn/src/totp.ts \
        packages/authn/src/totp.test.ts packages/authn/src/totp.int.test.ts \
        packages/authn/package.json pnpm-lock.yaml
git commit -m "feat(authn): TOTP second factor with encrypted secret and replay protection"
```

---

### Task 36: Cookie `SameSite` + proteção CSRF no plugin de sessão

**Por que double-submit e não só `SameSite`.** `SameSite=Lax` bloqueia o envio do cookie em POST cross-site, mas não cobre subdomínio comprometido nem navegador antigo, e `SameSite=Strict` quebraria o caso legítimo de a clínica abrir `app.cadencia.med.br` a partir de um link no e-mail. Então: sessão em cookie `SameSite=Lax` + `HttpOnly` + prefixo `__Host-`, mais um token CSRF em cookie legível por JS que o front reenvia no header `x-csrf-token`. Método inseguro sem os dois batendo é 403 e vira evento de segurança.

**E o caminho que quase todo mundo esquece:** o cookie de CSRF só é emitido no login, mas o próprio login é um `POST`. Sem um passo que emita o token CSRF ao **anônimo**, em método seguro, o primeiro `POST /v1/login` de todo navegador leva 403 e ninguém consegue entrar em produção — o front não tem como fabricar um cookie `__Host-` para reenviar no header. O primeiro teste do Passo 1 existe por causa disso.

**Injeção de dependência, não import de irmão.** O plugin recebe o pool, o gerador de `requestId` e o canal de auditoria **como opções**. `authn` não importa `@cadencia/db`, `@cadencia/kernel` nem `@cadencia/audit` (§2.2 regra 2); quem compõe os três é `apps/api`, em L3.

**Arquivos:**
- Criar: `packages/authn/src/fastify/session-plugin.ts`
- Modificar: `packages/authn/package.json` (dependências `fastify`, `fastify-plugin`, `@fastify/cookie`)
- Teste: `packages/authn/src/fastify/session-plugin.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authn/src/fastify/session-plugin.int.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { uuidv7 } from '@cadencia/kernel';
import { appPool, jobsPool } from '@cadencia/db';
import { createSession } from '../session';
import {
  sessionPlugin, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, issueSessionCookies,
  type SecurityEventInput,
} from './session-plugin';

const eventos: SecurityEventInput[] = [];

async function seedUser(): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  return userId;
}

function buildApp(): FastifyInstance {
  const app = Fastify();
  // L3 e quem compoe: o pool vem de @cadencia/db, o id vem de @cadencia/kernel
  // e o canal de auditoria viria de @cadencia/audit. `authn` nao importa nenhum.
  app.register(sessionPlugin, {
    db: appPool(),
    newRequestId: () => uuidv7(),
    onSecurityEvent: async (e) => { eventos.push(e); },
  });
  app.get('/v1/ping', async (req) => ({ userId: req.session?.userId ?? null }));
  app.post('/v1/echo', async (req) => ({ userId: req.session?.userId ?? null }));
  app.post('/v1/login', async (_req, reply) => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    issueSessionCookies(reply, token);
    return { userId };
  });
  return app;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const bruto = res.headers['set-cookie'] as string[] | string | undefined;
  if (bruto === undefined) return [];
  return Array.isArray(bruto) ? bruto : [bruto];
}

describe('cookie de sessao e protecao CSRF', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });

  it('GET anonimo ja recebe o cookie de CSRF: senao o primeiro login e impossivel', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    const csrf = setCookies(res).find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(csrf).toBeDefined();
    expect(csrf).toContain('Secure');
    expect(csrf).toContain('Path=/');
    expect(csrf).not.toContain('HttpOnly');   // o front precisa ler para reenviar
  });

  it('o cookie de sessao e HttpOnly, Secure, SameSite=Lax e usa o prefixo __Host-', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/login',
      headers: { [CSRF_HEADER]: 'x'.repeat(43) },
      cookies: { [CSRF_COOKIE]: 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(200);
    const sid = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sid).toContain('HttpOnly');
    expect(sid).toContain('Secure');
    expect(sid).toContain('SameSite=Lax');
    expect(sid).toContain('Path=/');
    expect(sid).not.toContain('Domain=');
    const csrf = setCookies(res).find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Lax');
  });

  it('GET nao exige token CSRF e resolve a sessao do cookie', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'GET', url: '/v1/ping', cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(userId);
  });

  it('POST com cookie de sessao valido e SEM header CSRF e recusado com 403', async () => {
    // E o formulario escondido num site de terceiro: o navegador manda o cookie,
    // mas nao consegue ler o cookie de CSRF para montar o header.
    eventos.length = 0;
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: 'a'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('csrf_invalido');
    // A recusa vira evento de seguranca: e o que o auditor procura.
    expect(eventos.map((e) => e.eventType)).toContain('CSRF_REJECTED');
  });

  it('POST com header CSRF diferente do cookie e recusado com 403', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: 'a'.repeat(43) },
      headers: { [CSRF_HEADER]: 'b'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST com header CSRF igual ao cookie passa', async () => {
    const userId = await seedUser();
    const { token } = await createSession(appPool(), { userId });
    const csrf = 'c'.repeat(43);
    const res = await app.inject({
      method: 'POST', url: '/v1/echo',
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(userId);
  });

  it('sessao revogada nao chega na rota: request.session fica nulo', async () => {
    const userId = await seedUser();
    const { token, sessionId } = await createSession(appPool(), { userId });
    await appPool().query(
      `UPDATE id.session SET revoked_at = clock_timestamp(), revoked_reason = 'teste' WHERE id = $1`,
      [sessionId],
    );
    const res = await app.inject({
      method: 'GET', url: '/v1/ping', cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBeNull();
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/authn/src/fastify/session-plugin.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./session-plugin" from "packages/authn/src/fastify/session-plugin.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Instalar as dependências e implementar o plugin**

```bash
pnpm add fastify fastify-plugin @fastify/cookie --filter @cadencia/authn
```

Criar `packages/authn/src/fastify/session-plugin.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import fp from 'fastify-plugin';
import type { FastifyReply } from 'fastify';
import {
  resolveSession, SESSION_IDLE_MINUTES,
  type Queryable, type ResolvedSession,
} from '../session';

/** Prefixo __Host-: o navegador so aceita com Secure, Path=/ e sem Domain. */
export const SESSION_COOKIE = '__Host-cadencia_sid';
export const CSRF_COOKIE = '__Host-cadencia_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const METODOS_INSEGUROS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Forma do evento de seguranca entregue ao canal B. Declarada aqui porque
 * `authn` nao importa `@cadencia/audit` (irmaos em L0, §2.2 regra 2): quem liga
 * as duas pontas e `apps/api`, passando `onSecurityEvent`.
 */
export interface SecurityEventInput {
  readonly eventType: string;
  readonly outcome: 'sucesso' | 'negado' | 'erro';
  readonly entitySchema: string;
  readonly entityTable: string;
  readonly actorKind: 'user' | 'system' | 'anon';
  readonly requestId: string;
  readonly ip?: string | null;
  readonly meta?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SessionPluginOptions {
  /** Pool que ja assume app_rw (appPool de @cadencia/db). */
  readonly db: Queryable;
  /** Gerador de id de requisicao (uuidv7 mora no kernel, que authn nao importa). */
  readonly newRequestId: () => string;
  /** Canal B da auditoria. Opcional para nao travar teste de rota isolada. */
  readonly onSecurityEvent?: (event: SecurityEventInput) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: ResolvedSession | null;
  }
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfMatches(
  cookieValue: string | undefined, headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookieValue || !header) return false;
  const a = Buffer.from(cookieValue, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issueSessionCookies(reply: FastifyReply, sessionToken: string): void {
  const base = {
    path: '/', secure: true, sameSite: 'lax' as const,
    maxAge: SESSION_IDLE_MINUTES * 60,
  };
  reply.setCookie(SESSION_COOKIE, sessionToken, { ...base, httpOnly: true });
  // Legivel por JS de proposito: o front le e reenvia no header (double-submit).
  reply.setCookie(CSRF_COOKIE, newCsrfToken(), { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export const sessionPlugin = fp<SessionPluginOptions>(async (app, opts) => {
  await app.register(cookie);

  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req, reply) => {
    if (METODOS_INSEGUROS.has(req.method)) {
      if (!csrfMatches(req.cookies[CSRF_COOKIE], req.headers[CSRF_HEADER])) {
        await opts.onSecurityEvent?.({
          eventType: 'CSRF_REJECTED',
          entitySchema: 'id', entityTable: 'session',
          outcome: 'negado', actorKind: 'anon',
          requestId: (req.headers['x-request-id'] as string | undefined) ?? opts.newRequestId(),
          ip: req.ip, meta: { method: req.method, route: req.url },
        });
        return reply.code(403).send({ error: 'csrf_invalido' });
      }
    }

    // Metodo seguro sem cookie de CSRF: emite um agora. Sem este caminho o
    // primeiro POST /v1/login de todo navegador cai no 403 acima -- o front nao
    // tem como fabricar um cookie __Host- para reenviar no header.
    if (!METODIOS_INSEGUROS.has(req.method) && !req.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, newCsrfToken(), {
        path: '/', secure: true, sameSite: 'lax', httpOnly: false,
        maxAge: SESSION_IDLE_MINUTES * 60,
      });
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;

    const r = await resolveSession(opts.db, token);
    if (r.ok) {
      req.session = r.value;
      return;
    }
    // Sessao morta: limpa o cookie e segue como anonimo. Quem exige sessao e a
    // rota, via authz -- este hook nao decide autorizacao.
    clearSessionCookies(reply);
    await opts.onSecurityEvent?.({
      eventType: 'SESSION_REJECTED',
      entitySchema: 'id', entityTable: 'session',
      outcome: 'negado', actorKind: 'anon',
      requestId: (req.headers['x-request-id'] as string | undefined) ?? opts.newRequestId(),
      ip: req.ip, meta: { reason: r.error },
    });
  });
});
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/authn/src/fastify/session-plugin.int.test.ts`
Esperado: PASSA — 7 testes verdes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/authn/src/fastify/session-plugin.ts \
        packages/authn/src/fastify/session-plugin.int.test.ts \
        packages/authn/package.json pnpm-lock.yaml
git commit -m "feat(authn): SameSite session cookie with double-submit CSRF protection"
```

---

### Task 36B: `resolveMemberships` — o vínculo que vira sujeito de autorização

**Por que esta tarefa existe (§10 item 3).** O papel nunca vem do cliente: é derivado do vínculo, por clínica, dentro do banco. `resolveMemberships` é o único caminho que lê esse vínculo e o entrega ao `can()` da Task 37. Repare que o tipo `Role` é declarado **aqui** e não importado de `@cadencia/authz`: `authn` e `authz` são irmãos em L0 e import entre irmãos é proibido sem exceção (§2.2), então a duplicação é intencional — e o último teste do Passo 1 é o que impede as duas listas de divergirem, comparando a lista do TypeScript com o `CHECK` da tabela.

**Arquivos:**
- Criar: `packages/authn/src/membership.ts`
- Teste: `packages/authn/src/membership.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authn/src/membership.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';
import { MEMBERSHIP_ROLES, resolveMemberships } from './membership';

async function seedTenant(nome: string): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES ($1, $2, $3, $4)`,
    [tenantId, `t-${tenantId.slice(0, 8)}`, nome, '12ABC34501DE35'],
  );
  await jobsPool().query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES ($1, $2, $3, $4)`,
    [tenantId, clinicId, `${nome} - Unidade Centro`, 'America/Sao_Paulo'],
  );
  return { tenantId, clinicId };
}

async function seedUser(fullName: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, fullName],
  );
  return userId;
}

async function grant(
  tenantId: string, clinicId: string, userId: string, role: string,
): Promise<string> {
  const id = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, id, userId, clinicId, role],
  );
  return id;
}

describe('resolveMemberships', () => {
  it('dentro do tenant A o vinculo do mesmo medico no tenant B nao aparece', async () => {
    const a = await seedTenant('Clinica Sao Paulo');
    const b = await seedTenant('Clinica Manaus');
    const userId = await seedUser('Dra. Ana Ribeiro');
    await grant(a.tenantId, a.clinicId, userId, 'admin_clinico');
    await grant(b.tenantId, b.clinicId, userId, 'recepcao');

    const vinculos = await withTenantTx(
      { kind: 'user', tenantId: a.tenantId, userId, clinicId: a.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(vinculos).toEqual([
      { tenantId: a.tenantId, clinicId: a.clinicId, role: 'admin_clinico' },
    ]);
  });

  it('vinculo revogado some da lista na requisicao seguinte', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedUser('Dr. Bruno Camargo');
    const membershipId = await grant(t.tenantId, t.clinicId, userId, 'profissional');

    const antes = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(antes).toHaveLength(1);

    await jobsPool().query(
      `UPDATE app.membership
          SET revoked_at = clock_timestamp(), revoked_reason = $2
        WHERE id = $1`,
      [membershipId, 'desligamento'],
    );

    const depois = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(depois).toEqual([]);
  });

  it('dois papeis na mesma unidade devolvem duas linhas, nao um papel escalar', async () => {
    const t = await seedTenant('Clinica Integrada');
    const userId = await seedUser('Dra. Carla Nunes');
    await grant(t.tenantId, t.clinicId, userId, 'profissional');
    await grant(t.tenantId, t.clinicId, userId, 'financeiro');

    const vinculos = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => resolveMemberships(tx, userId),
    );
    expect(vinculos.map((v) => v.role).sort()).toEqual(['financeiro', 'profissional']);
  });

  it('a lista de papeis do TypeScript e exatamente a do CHECK de app.membership', async () => {
    const { rows } = await jobsPool().query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'app.membership'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%role%'`,
    );
    const def = rows.map((r) => r.def as string).join(' ');
    const noBanco = (def.match(/'[a-z_]+'/g) ?? []).map((s) => s.slice(1, -1)).sort();
    expect(noBanco).toEqual([...MEMBERSHIP_ROLES].sort());
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/authn/src/membership.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./membership" from "packages/authn/src/membership.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar o mínimo**

Criar `packages/authn/src/membership.ts`:

```ts
import type { Queryable } from './session';

/**
 * Declarado aqui, e nao importado de @cadencia/authz: authn e authz sao irmaos
 * em L0 e import entre irmaos e proibido sem excecao (§2.2 regra 2). O teste
 * `membership.int.test.ts` compara esta lista com o CHECK de app.membership,
 * que e o que impede as duas divergirem em silencio.
 */
export const MEMBERSHIP_ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof MEMBERSHIP_ROLES)[number];

export interface MembershipRow {
  tenantId: string;
  clinicId: string;
  role: Role;
}

/**
 * Le os vinculos VIGENTES do usuario. Precisa rodar dentro de withTenantTx: a
 * policy de app.membership ja filtra por tenant e por dono do vinculo, e o
 * parametro `tenantId` serve so para o chamador estreitar ainda mais.
 */
export async function resolveMemberships(
  db: Queryable, userId: string, tenantId?: string,
): Promise<MembershipRow[]> {
  const { rows } = await db.query(
    `SELECT m.tenant_id, m.clinic_id, m.role
       FROM app.membership m
      WHERE m.user_id = $1
        AND m.revoked_at IS NULL
        AND ($2::uuid IS NULL OR m.tenant_id = $2::uuid)
      ORDER BY m.clinic_id, m.role`,
    [userId, tenantId ?? null],
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id as string,
    clinicId: r.clinic_id as string,
    role: r.role as Role,
  }));
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/authn/src/membership.int.test.ts`
Esperado: PASSA — 4 testes verdes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/authn/src/membership.ts packages/authn/src/membership.int.test.ts
git commit -m "feat(authn): resolve active per-clinic memberships from the tenant context"
```

---

### Task 37: `authz` — catálogo de ações com fonte única e negação por padrão

**A divisão de trabalho com o RLS, escrita para não ser reinventada em cada sprint.** O RLS decide **o que a linha permite**; o `authz` decide **o que a rota permite**. Não há regra duplicada: o `can()` nunca consulta paciente, atendimento ou qualquer dado clínico — ele só olha o par (papel no vínculo, ação da rota). Quem filtra linha é a policy no banco. Consequência prática: uma rota liberada pelo `authz` continua devolvendo zero linhas se o RLS não autorizar — e é isso que a Task 38 prova com teste.

O tipo `Role` daqui é estruturalmente idêntico ao de `packages/authn/src/membership.ts`, de propósito e pelo mesmo motivo (§2.2 regra 2). Quem junta os dois é `apps/api`: passa o resultado de `resolveMemberships` direto para `can()`.

**Arquivos:**
- Criar: `packages/authz/src/actions.ts`
- Criar: `packages/authz/src/can.ts`
- Teste: `packages/authz/src/can.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/authz/src/can.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY } from './actions';
import { can, assertCan, type AuthzSubject } from './can';

const CLINICA_SP = '01890a5d-ac96-774b-bcce-b302099a8057';
const CLINICA_MANAUS = '01890a5d-ac96-774b-bcce-b302099a8058';

function sujeito(
  memberships: AuthzSubject['memberships'], mfaAt: Date | null = new Date(),
): AuthzSubject {
  return {
    userId: '01890a5d-ac96-774b-bcce-b302099a8000',
    tenantId: '01890a5d-ac96-774b-bcce-b302099a8001',
    memberships, mfaAt,
  };
}

describe('catalogo de acoes', () => {
  it('nao tem chave duplicada', () => {
    expect(ACTION_BY_KEY.size).toBe(ACTIONS.length);
  });

  it('toda acao declara ao menos um papel: acao sem papel seria letra morta', () => {
    for (const a of ACTIONS) expect(a.roles.length).toBeGreaterThan(0);
  });

  it('toda chave segue o formato dominio.verbo', () => {
    for (const a of ACTIONS) expect(a.key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});

describe('can', () => {
  it('FAIL-CLOSED: acao que nao existe no catalogo e negada ate para o admin', () => {
    // O caso real: alguem escreve requireAction('financeiro.exportar_tudo') numa
    // rota nova e esquece de cadastrar a acao. Sem esta regra, a rota nasce aberta.
    const admin = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    const d = can(admin, 'financeiro.exportar_tudo', { clinicId: CLINICA_SP });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('acao_desconhecida');
  });

  it('admin_clinico le paciente na clinica em que tem vinculo', () => {
    const admin = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    expect(can(admin, 'patient.read', { clinicId: CLINICA_SP }).allowed).toBe(true);
  });

  it('papel de uma unidade nao vale na outra: admin em SP e recepcao em Manaus', () => {
    const medica = sujeito([
      { clinicId: CLINICA_SP, role: 'admin_clinico' },
      { clinicId: CLINICA_MANAUS, role: 'recepcao' },
    ]);
    expect(can(medica, 'membership.grant', { clinicId: CLINICA_SP }).allowed).toBe(true);
    const emManaus = can(medica, 'membership.grant', { clinicId: CLINICA_MANAUS });
    expect(emManaus.allowed).toBe(false);
    if (emManaus.allowed) return;
    expect(emManaus.reason).toBe('papel_insuficiente');
  });

  it('sem vinculo na clinica alvo e negado antes de olhar papel', () => {
    const medica = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    const d = can(medica, 'patient.read', { clinicId: CLINICA_MANAUS });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('sem_vinculo');
  });

  it('acao marcada com requiresMfa exige segundo fator na sessao', () => {
    const semMfa = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }], null);
    const d = can(semMfa, 'membership.grant', { clinicId: CLINICA_SP });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('mfa_exigida');
  });

  it('sujeito sem nenhum vinculo e negado em tudo', () => {
    const ninguem = sujeito([]);
    for (const a of ACTIONS) {
      expect(can(ninguem, a.key, { clinicId: CLINICA_SP }).allowed).toBe(false);
    }
  });

  it('assertCan lanca com a chave e o motivo quando nega', () => {
    const recepcao = sujeito([{ clinicId: CLINICA_SP, role: 'recepcao' }]);
    expect(() => assertCan(recepcao, 'membership.grant', { clinicId: CLINICA_SP }))
      .toThrow(/membership\.grant.*papel_insuficiente/);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test packages/authz/src/can.test.ts`
Esperado: FALHA com `Failed to resolve import "./actions" from "packages/authz/src/can.test.ts". Does the file exist?`

- [ ] **Passo 3: Escrever o catálogo**

Criar `packages/authz/src/actions.ts`:

```ts
/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] **Passo 4: Escrever a decisão**

Criar `packages/authz/src/can.ts`:

```ts
import { ACTION_BY_KEY, type ActionDef, type Role } from './actions';

export type DenyReason = 'acao_desconhecida' | 'sem_vinculo' | 'papel_insuficiente' | 'mfa_exigida';

/**
 * O sujeito da autorizacao. `memberships` vem de resolveMemberships (Task 36B),
 * que le o vinculo dentro do banco. Papel NUNCA vem do cliente (§10 item 3).
 */
export interface AuthzSubject {
  userId: string;
  tenantId: string;
  memberships: readonly { clinicId: string; role: Role }[];
  mfaAt: Date | null;
}

export type Decision =
  | { allowed: true; action: ActionDef }
  | { allowed: false; reason: DenyReason };

export function can(
  subject: AuthzSubject, actionKey: string, target: { clinicId: string },
): Decision {
  const action = ACTION_BY_KEY.get(actionKey);
  // Fail-closed: chave fora do catalogo e negada. Rota nova nasce fechada.
  if (!action) return { allowed: false, reason: 'acao_desconhecida' };

  const naClinica = subject.memberships.filter((m) => m.clinicId === target.clinicId);
  if (naClinica.length === 0) return { allowed: false, reason: 'sem_vinculo' };

  const temPapel = naClinica.some((m) => action.roles.includes(m.role));
  if (!temPapel) return { allowed: false, reason: 'papel_insuficiente' };

  if (action.requiresMfa === true && subject.mfaAt === null) {
    return { allowed: false, reason: 'mfa_exigida' };
  }
  return { allowed: true, action };
}

export function assertCan(
  subject: AuthzSubject, actionKey: string, target: { clinicId: string },
): ActionDef {
  const d = can(subject, actionKey, target);
  if (!d.allowed) throw new Error(`authz negou ${actionKey}: ${d.reason}`);
  return d.action;
}
```

- [ ] **Passo 5: Rodar e confirmar que passa**

Rodar: `pnpm test packages/authz/src/can.test.ts`
Esperado: PASSA — 10 testes verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/authz/src/actions.ts packages/authz/src/can.ts packages/authz/src/can.test.ts
git commit -m "feat(authz): single-source action catalog with fail-closed evaluation"
```

---

### Task 38: `pnpm authz:seed` e a prova de que `authz` não substitui RLS

A tabela `ref.action` existe para a tela de papéis e para consulta operacional. Ela **não** é fonte da verdade: `packages/authz/src/actions.ts` é. O `authz:seed` regenera a tabela e o `actions.lock.json` a partir do arquivo, e apaga do banco qualquer chave que não esteja mais no catálogo — porque duas fontes da verdade para permissão é como um usuário ganha acesso que ninguém concedeu.

**Arquivos:**
- Criar: `packages/authz/src/catalog.ts`
- Teste: `packages/authz/src/catalog.test.ts`
- Criar: `packages/db/migrations/0018_action_catalog.sql`
- Criar: `tools/authz-seed.ts`
- Modificar: `package.json` (raiz) — bloco `scripts`
- Teste: `packages/authz/src/authz-e-rls.int.test.ts`

- [ ] **Passo 1: Escrever o teste unitário que falha**

Criar `packages/authz/src/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionDef } from './actions';
import { catalogRows, catalogChecksum } from './catalog';

describe('catalogo derivado de actions.ts', () => {
  it('gera uma linha por acao, com os papeis ordenados', () => {
    const rows = catalogRows(ACTIONS);
    expect(rows.length).toBe(ACTIONS.length);
    const patientRead = rows.find((r) => r.key === 'patient.read')!;
    expect(patientRead.roles).toEqual([...patientRead.roles].sort());
    expect(patientRead.requiresMfa).toBe(false);
    expect(rows.find((r) => r.key === 'membership.grant')!.requiresMfa).toBe(true);
  });

  it('as linhas saem ordenadas por chave, para o checksum nao depender da ordem do arquivo', () => {
    const keys = catalogRows(ACTIONS).map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('o checksum muda quando uma acao muda de papel', () => {
    const base = catalogChecksum(catalogRows(ACTIONS));
    const alterado: readonly ActionDef[] = [
      ...ACTIONS.filter((a) => a.key !== 'patient.read'),
      { key: 'patient.read', description: 'Ler cadastro de paciente',
        roles: ['admin_clinico'] as const },
    ];
    expect(catalogChecksum(catalogRows(alterado))).not.toBe(base);
  });

  it('o checksum NAO muda quando so a ordem das acoes no arquivo muda', () => {
    const base = catalogChecksum(catalogRows(ACTIONS));
    const invertido = catalogChecksum(catalogRows([...ACTIONS].reverse()));
    expect(invertido).toBe(base);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test packages/authz/src/catalog.test.ts`
Esperado: FALHA com `Failed to resolve import "./catalog" from "packages/authz/src/catalog.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar o módulo puro**

Criar `packages/authz/src/catalog.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ActionDef } from './actions';

export interface ActionRow {
  key: string;
  description: string;
  roles: string[];
  requiresMfa: boolean;
}

export function catalogRows(actions: readonly ActionDef[]): ActionRow[] {
  return actions
    .map((a) => ({
      key: a.key,
      description: a.description,
      roles: [...a.roles].sort(),
      requiresMfa: a.requiresMfa === true,
    }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

export function catalogChecksum(rows: readonly ActionRow[]): string {
  const canonical = rows
    .map((r) => `${r.key}|${r.description}|${r.roles.join(',')}|${r.requiresMfa}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

- [ ] **Passo 4: Rodar e confirmar que o teste unitário passa**

Rodar: `pnpm test packages/authz/src/catalog.test.ts`
Esperado: PASSA — 4 testes verdes.

- [ ] **Passo 5: Escrever o teste de integração que falha**

Criar `packages/authz/src/authz-e-rls.int.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { uuidv7 } from '@cadencia/kernel';
import { jobsPool, withTenantTx } from '@cadencia/db';
import { ACTIONS } from './actions';
import { can, type AuthzSubject } from './can';

async function seedTenant(nome: string): Promise<{ tenantId: string; clinicId: string }> {
  const tenantId = uuidv7();
  const clinicId = uuidv7();
  await jobsPool().query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES ($1, $2, $3, $4)`,
    [tenantId, `t-${tenantId.slice(0, 8)}`, nome, '12ABC34501DE35'],
  );
  await jobsPool().query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES ($1, $2, $3, $4)`,
    [tenantId, clinicId, `${nome} - Unidade Centro`, 'America/Sao_Paulo'],
  );
  return { tenantId, clinicId };
}

async function seedMember(tenantId: string, clinicId: string, role: string): Promise<string> {
  const userId = uuidv7();
  await jobsPool().query(
    `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, $3)`,
    [userId, `u-${userId.slice(0, 12)}@exemplo.com.br`, 'Dra. Ana Ribeiro'],
  );
  await jobsPool().query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, uuidv7(), userId, clinicId, role],
  );
  return userId;
}

describe('pnpm authz:seed', () => {
  it('a tabela ref.action espelha exatamente actions.ts, sem sobra nem falta', async () => {
    // Uma chave plantada a mao no banco tem que sumir no proximo seed: se o banco
    // pudesse ganhar acao propria, existiriam duas fontes da verdade.
    await jobsPool().query(
      `INSERT INTO ref.action (key, description, roles) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      ['fantasma.acao', 'inserida a mao', ['admin_clinico']],
    );

    execFileSync('pnpm', ['authz:seed'], { stdio: 'pipe', shell: process.platform === 'win32' });

    const { rows } = await jobsPool().query(`SELECT key FROM ref.action ORDER BY key`);
    const noBanco = rows.map((r) => r.key as string);
    expect(noBanco).toEqual([...ACTIONS.map((a) => a.key)].sort());
    expect(noBanco).not.toContain('fantasma.acao');
  });

  it('--check passa com o lock em dia', () => {
    expect(() =>
      execFileSync('pnpm', ['authz:seed', '--check'],
        { stdio: 'pipe', shell: process.platform === 'win32' }),
    ).not.toThrow();
  });
});

describe('authz decide a rota, RLS decide a linha', () => {
  it('rota permitida pelo authz continua devolvendo zero linhas do tenant alheio', async () => {
    const a = await seedTenant('Clinica A');
    const b = await seedTenant('Clinica B');
    const userId = await seedMember(a.tenantId, a.clinicId, 'admin_clinico');

    const sujeito: AuthzSubject = {
      userId, tenantId: a.tenantId,
      memberships: [{ clinicId: a.clinicId, role: 'admin_clinico' }],
      mfaAt: new Date(),
    };
    // O authz libera a rota...
    expect(can(sujeito, 'clinic.read', { clinicId: a.clinicId }).allowed).toBe(true);

    // ...e o RLS continua sendo quem decide a linha.
    const r = await withTenantTx(
      { kind: 'user', tenantId: a.tenantId, userId, clinicId: a.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.clinic WHERE id = $1`, [b.clinicId],
      ),
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('linha visivel pelo RLS nao basta: recepcao segue sem a acao de conceder vinculo', async () => {
    const t = await seedTenant('Clinica do Vale');
    const userId = await seedMember(t.tenantId, t.clinicId, 'recepcao');

    const r = await withTenantTx(
      { kind: 'user', tenantId: t.tenantId, userId, clinicId: t.clinicId, requestId: uuidv7() },
      (tx) => tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.clinic WHERE id = $1`, [t.clinicId],
      ),
    );
    expect(r.rows[0]?.n).toBe(1);   // o RLS deixa ver

    const d = can(
      { userId, tenantId: t.tenantId,
        memberships: [{ clinicId: t.clinicId, role: 'recepcao' }], mfaAt: new Date() },
      'membership.grant', { clinicId: t.clinicId },
    );
    expect(d.allowed).toBe(false);  // e o authz recusa a rota
    if (d.allowed) return;
    expect(d.reason).toBe('papel_insuficiente');
  });
});
```

Rodar: `pnpm test:int packages/authz/src/authz-e-rls.int.test.ts`
Esperado: FALHA com `error: relation "ref.action" does not exist` (SQLSTATE `42P01`).

- [ ] **Passo 6: Criar a migration da tabela espelho**

Rodar: `pnpm db:new action_catalog` — cria `packages/db/migrations/0018_action_catalog.sql`. Preencher com exatamente:

```sql
-- 0018_action_catalog.sql
-- Espelho do catalogo de acoes no banco, para consulta operacional e para a
-- tela de papeis. NAO e fonte da verdade: packages/authz/src/actions.ts e.
-- Fica em `ref` (referencia global, sem tenant) e nao em `app`, porque o
-- catalogo e igual para todos os tenants.
CREATE TABLE ref.action (
  key          text PRIMARY KEY,
  description  text NOT NULL,
  roles        text[] NOT NULL,
  requires_mfa boolean NOT NULL DEFAULT false,
  generated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE ref.action OWNER TO app_owner;
COMMENT ON TABLE ref.action IS 'global-reference';

GRANT USAGE  ON SCHEMA ref TO app_rw;
GRANT SELECT ON ref.action TO app_rw;
-- `pnpm authz:seed` roda como `jobs`: BYPASSRLS ignora POLICY, nao ignora GRANT.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, UPDATE, DELETE ON ref.action TO jobs;
```

Rodar: `pnpm db:migrate`
Esperado: `aplicada: 0018_action_catalog.sql`.

- [ ] **Passo 7: Escrever o script de seed**

Criar `tools/authz-seed.ts`:

```ts
/**
 * pnpm authz:seed         regenera ref.action e actions.lock.json a partir de actions.ts
 * pnpm authz:seed --check falha se o lock estiver desatualizado (invariante de CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIONS } from '../packages/authz/src/actions';
import { catalogRows, catalogChecksum } from '../packages/authz/src/catalog';
import { closePools, jobsPool } from '../packages/db/src/pool';

// Este script roda em processo proprio (o teste o invoca por execFileSync) e
// nao passa pelo setupFiles do vitest: sem isto, DATABASE_URL_JOBS nao existe.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const LOCK = resolve(process.cwd(), 'packages/authz/actions.lock.json');

async function main(): Promise<void> {
  const rows = catalogRows(ACTIONS);
  const checksum = catalogChecksum(rows);
  const lockBody = `${JSON.stringify({ checksum, rows }, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const atual = existsSync(LOCK) ? readFileSync(LOCK, 'utf8') : '';
    if (atual !== lockBody) {
      console.error(
        'actions.lock.json esta desatualizado. Rode `pnpm authz:seed` e commite o resultado.',
      );
      process.exit(1);
    }
    console.log(`catalogo em dia: ${rows.length} acoes, checksum ${checksum}`);
    return;
  }

  writeFileSync(LOCK, lockBody, 'utf8');

  const client = await jobsPool().connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO ref.action (key, description, roles, requires_mfa)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
           SET description = EXCLUDED.description,
               roles = EXCLUDED.roles,
               requires_mfa = EXCLUDED.requires_mfa,
               generated_at = clock_timestamp()`,
        [r.key, r.description, r.roles, r.requiresMfa],
      );
    }
    // Acao que saiu de actions.ts sai do banco: o banco nunca vira fonte paralela.
    await client.query(`DELETE FROM ref.action WHERE key <> ALL($1::text[])`,
      [rows.map((r) => r.key)]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`catalogo regenerado: ${rows.length} acoes, checksum ${checksum}`);
}

main()
  .then(() => closePools())
  .catch(async (e) => { console.error(e); await closePools(); process.exit(1); });
```

- [ ] **Passo 8: Registrar o comando no `package.json` da raiz**

Modificar `package.json` (raiz), no bloco `"scripts"`, acrescentando as duas linhas:

```json
    "authz:seed": "tsx tools/authz-seed.ts",
    "authz:check": "tsx tools/authz-seed.ts --check",
```

Rodar: `pnpm authz:seed --check`
Esperado: FALHA com `actions.lock.json esta desatualizado. Rode \`pnpm authz:seed\` e commite o resultado.` e código de saída 1 — o lock ainda não existe.

- [ ] **Passo 9: Rodar o seed e confirmar que os testes passam**

Rodar:

```bash
pnpm authz:seed
pnpm test:int packages/authz/src/authz-e-rls.int.test.ts
```

Esperado: `pnpm authz:seed` imprime `catalogo regenerado: 9 acoes, checksum <hex>` e cria `packages/authz/actions.lock.json`; o teste PASSA — 4 testes verdes.

- [ ] **Passo 10: Commitar**

```bash
git add packages/db/migrations/0018_action_catalog.sql packages/authz/src/catalog.ts \
        packages/authz/src/catalog.test.ts packages/authz/src/authz-e-rls.int.test.ts \
        packages/authz/actions.lock.json tools/authz-seed.ts package.json
git commit -m "feat(authz): authz:seed regenerates action catalog from single source"
```

---

### Task 39: `catalogs` — CID-10 versionado por data, com lookup pela data do evento

**O erro que esta tarefa existe para impedir.** Uma consulta de 2024 impressa ou faturada em 2026 tem que mostrar a descrição do código **vigente em 2024**. Quem resolve o código pelo relógio de quem executa produz um lote que a operadora rejeita meses depois, e o relatório de auditoria fica sem explicação. Por isso a tabela tem `daterange` com `EXCLUDE USING gist` (impossível carregar duas vigências sobrepostas do mesmo código) e a função de lookup **exige a data do evento como parâmetro obrigatório**.

**Arquivos:**
- Criar: `packages/db/migrations/0019_ref_cid10.sql`
- Criar: `packages/catalogs/src/cid10.ts`
- Teste: `packages/catalogs/src/cid10.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/catalogs/src/cid10.int.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { resolveCid10At, loadCid10Competencia, parseCid10Csv } from './cid10';

// Cenario: a CID-10 e recarregada em 2025 e a descricao de J45 muda. Um
// atendimento de 2024 tem que continuar resolvendo a descricao de 2024.
beforeAll(async () => {
  await jobsPool().query(`DELETE FROM ref.cid10_term WHERE codigo IN ('J45','I10','A00')`);
  await loadCid10Competencia(jobsPool(), {
    competencia: '200801',
    vigenciaFrom: '2008-01-01',
    vigenciaTo: '2025-01-01',
    rows: [
      { codigo: 'J45', descricao: 'Asma', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ],
  });
  await loadCid10Competencia(jobsPool(), {
    competencia: '202501',
    vigenciaFrom: '2025-01-01',
    vigenciaTo: null,
    rows: [
      { codigo: 'J45', descricao: 'Asma (revisao 2025)', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ],
  });
});

describe('CID-10 versionada por data', () => {
  it('ATENDIMENTO DE 2024 RESOLVE PELA VIGENCIA DE 2024, nao pela de hoje', async () => {
    const passado = await resolveCid10At(appPool(), 'J45', '2024-08-03');
    const hoje = await resolveCid10At(appPool(), 'J45', '2026-08-03');
    expect(passado.ok).toBe(true);
    expect(hoje.ok).toBe(true);
    if (!passado.ok || !hoje.ok) return;
    expect(passado.value.display).toBe('Asma');
    expect(hoje.value.display).toBe('Asma (revisao 2025)');
    expect(passado.value.terminologyVersion).toBe('200801');
    expect(hoje.value.terminologyVersion).toBe('202501');
  });

  it('codigo que nao existia na data do atendimento nao e inventado', async () => {
    await loadCid10Competencia(jobsPool(), {
      competencia: '202501',
      vigenciaFrom: '2025-01-01',
      vigenciaTo: null,
      rows: [{ codigo: 'A00', descricao: 'Colera', capitulo: 1 }],
    });
    const r = await resolveCid10At(appPool(), 'A00', '2024-08-03');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_inexistente_na_data');
  });

  it('a data do limite superior e exclusiva: 2025-01-01 ja e a vigencia nova', async () => {
    const vespera = await resolveCid10At(appPool(), 'J45', '2024-12-31');
    const virada = await resolveCid10At(appPool(), 'J45', '2025-01-01');
    expect(vespera.ok && vespera.value.display).toBe('Asma');
    expect(virada.ok && virada.value.display).toBe('Asma (revisao 2025)');
  });

  it('carregar competencia com vigencia sobreposta e impossivel: o banco recusa', async () => {
    await expect(
      loadCid10Competencia(jobsPool(), {
        competencia: '202403',
        vigenciaFrom: '2024-01-01',   // invade a faixa 2008-2025 de J45
        vigenciaTo: '2026-01-01',
        rows: [{ codigo: 'J45', descricao: 'Asma (carga errada)', capitulo: 10 }],
      }),
    ).rejects.toMatchObject({ code: '23P01' });   // exclusion_violation
  });

  it('a funcao SQL ref.cid10_at devolve o mesmo termo que a funcao TS', async () => {
    const { rows } = await appPool().query(
      `SELECT descricao, competencia FROM ref.cid10_at($1, $2::date)`, ['J45', '2024-08-03'],
    );
    expect(rows[0].descricao).toBe('Asma');
    expect(rows[0].competencia).toBe('200801');
  });

  it('parseCid10Csv le o formato distribuido pelo DATASUS', () => {
    const csv = [
      'codigo;descricao;capitulo',
      'J45;Asma;10',
      'I10;Hipertensao essencial (primaria);9',
      '',
    ].join('\n');
    expect(parseCid10Csv(csv)).toEqual([
      { codigo: 'J45', descricao: 'Asma', capitulo: 10 },
      { codigo: 'I10', descricao: 'Hipertensao essencial (primaria)', capitulo: 9 },
    ]);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/catalogs/src/cid10.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./cid10" from "packages/catalogs/src/cid10.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Criar a migration**

Rodar: `pnpm db:new ref_cid10` — cria `packages/db/migrations/0019_ref_cid10.sql`. Preencher com exatamente:

```sql
-- 0019_ref_cid10.sql
-- Terminologia GLOBAL, versionada por data (§3.9, §10 item 11).
-- Sem RLS e sem tenant_id: 15 mil codigos x N clinicas seria absurdo, e a CID
-- e a mesma para todo mundo. Usa btree_gist (para o operador `=` participar do
-- EXCLUDE ao lado do `&&` do daterange) e pg_trgm (gin_trgm_ops); as duas ja
-- foram instaladas pela migration 0002.
CREATE TABLE ref.cid10_term (
  codigo      varchar(6) NOT NULL,
  descricao   text NOT NULL,
  capitulo    smallint,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,          -- AAAAMM da publicacao carregada
  PRIMARY KEY (codigo, vigencia),
  -- Impossivel carregar uma competencia que sobreponha a vigencia do mesmo codigo.
  -- Sem isto, duas linhas concorrentes fariam o lookup devolver a que o planejador
  -- escolher -- e a descricao do prontuario mudaria entre duas impressoes.
  EXCLUDE USING gist (codigo WITH =, vigencia WITH &&)
);
ALTER TABLE ref.cid10_term OWNER TO app_owner;
COMMENT ON TABLE ref.cid10_term IS 'global-reference';

CREATE INDEX ix_cid10_busca ON ref.cid10_term USING gin (descricao gin_trgm_ops);

-- Lookup PELA DATA DO EVENTO. Repare que nao existe versao sem parametro de
-- data: quem chama e obrigado a dizer de quando e o atendimento.
CREATE FUNCTION ref.cid10_at(p_codigo varchar, p_data date)
RETURNS ref.cid10_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.cid10_term
   WHERE codigo = p_codigo AND vigencia @> p_data $$;
ALTER FUNCTION ref.cid10_at(varchar, date) OWNER TO app_owner;

GRANT USAGE  ON SCHEMA ref TO app_rw;
GRANT SELECT ON ref.cid10_term TO app_rw;
GRANT EXECUTE ON FUNCTION ref.cid10_at(varchar, date) TO app_rw;
-- USAGE no schema e SELECT sao obrigatorios: sem USAGE nada em `ref` e alcancavel,
-- e o `DELETE ... WHERE codigo IN (...)` do fixture le as colunas do predicado.
-- A carga bimestral e job, nunca caminho de requisicao.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, DELETE ON ref.cid10_term TO jobs;
```

- [ ] **Passo 4: Implementar o módulo**

Criar `packages/catalogs/src/cid10.ts`:

```ts
import { err, ok, type Result } from '@cadencia/kernel';

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Um pool capaz de RESERVAR uma conexao. BEGIN/INSERT/COMMIT por `Pool.query`
 * nao caem necessariamente na mesma conexao: a carga deixaria de ser atomica e
 * o ROLLBACK rodaria numa conexao sem transacao aberta.
 */
export interface TransactionalDb {
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
    release(): void;
  }>;
}

export interface ResolvedTerm {
  system: 'CID10';
  code: string;
  display: string;
  terminologyVersion: string;   // competencia da publicacao consultada
}

export type Cid10Failure = 'codigo_inexistente_na_data';

/**
 * Resolve o codigo PELA DATA DO EVENTO. `eventDate` e obrigatorio e vem no
 * formato AAAA-MM-DD: e a `occurred_date` do atendimento, ja no fuso da clinica.
 * NAO existe default para hoje -- resolver pelo relogio de quem executa e o erro
 * que so aparece meses depois, num lote rejeitado pela operadora (§10 item 11).
 */
export async function resolveCid10At(
  db: Queryable, codigo: string, eventDate: string,
): Promise<Result<ResolvedTerm, Cid10Failure>> {
  const { rows } = await db.query(
    `SELECT codigo, descricao, competencia
       FROM ref.cid10_term
      WHERE codigo = $1 AND vigencia @> $2::date`,
    [codigo, eventDate],
  );
  const row = rows[0];
  if (!row) return err('codigo_inexistente_na_data');
  return ok({
    system: 'CID10',
    code: row.codigo as string,
    display: row.descricao as string,
    terminologyVersion: row.competencia as string,
  });
}

export function parseCid10Csv(
  csv: string,
): Array<{ codigo: string; descricao: string; capitulo: number | null }> {
  const linhas = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return linhas.slice(1).map((linha) => {
    const [codigo, descricao, capitulo] = linha.split(';');
    return {
      codigo: (codigo ?? '').trim(),
      descricao: (descricao ?? '').trim(),
      capitulo: capitulo && capitulo.trim().length > 0 ? Number(capitulo.trim()) : null,
    };
  });
}

/**
 * Carga de uma competencia inteira, em UMA transacao, numa unica conexao.
 * Roda com o papel `jobs`. Se qualquer codigo sobrepuser vigencia existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01) -- que e o comportamento
 * desejado: meia carga e pior que nenhuma.
 */
export async function loadCid10Competencia(
  db: TransactionalDb,
  input: {
    competencia: string;
    vigenciaFrom: string;
    vigenciaTo: string | null;
    rows: ReadonlyArray<{ codigo: string; descricao: string; capitulo: number | null }>;
  },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.rows) {
      await client.query(
        `INSERT INTO ref.cid10_term (codigo, descricao, capitulo, vigencia, competencia)
         VALUES ($1, $2, $3, daterange($4::date, $5::date, '[)'), $6)`,
        [r.codigo, r.descricao, r.capitulo, input.vigenciaFrom, input.vigenciaTo, input.competencia],
      );
    }
    await client.query('COMMIT');
    return input.rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

> `packages/catalogs` é L1 e pode importar `@cadencia/kernel`, que é L0: setas só descem (§2.2 regra 1). É exatamente o import que `authn` e `authz`, por serem irmãos do kernel, não podem fazer.

- [ ] **Passo 5: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/catalogs/src/cid10.int.test.ts
```

Esperado: `aplicada: 0019_ref_cid10.sql` e PASSA, 6 testes verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0019_ref_cid10.sql packages/catalogs/src/cid10.ts \
        packages/catalogs/src/cid10.int.test.ts
git commit -m "feat(catalogs): date-versioned CID-10 with event-date lookup"
```

---

### Task 39B: `catalogs` — TUSS versionada por data (tabela da ANS)

**Por que esta tarefa existe (§8 Fase 0, §3.9, §10 item 11).** A Fase 0 exige CID-10 **e TUSS** já versionadas por data. O item 211 do Componente Organizacional do TISS diz que vale a terminologia vigente **na data do atendimento**: uma guia de 2025 reapresentada em 2026 tem que carregar o termo de 2025. A ANS publica competência nova a cada dois meses (~97 mil termos), e o mesmo código muda de descrição. Carregar sem `daterange` + `EXCLUDE` significa sobrescrever o passado — e o lote volta glosado meses depois, sem explicação.

**Arquivos:**
- Criar: `packages/db/migrations/0020_ref_tuss.sql`
- Criar: `packages/catalogs/src/tuss.ts`
- Teste: `packages/catalogs/src/tuss.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/catalogs/src/tuss.int.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { loadTussCompetencia, resolveTussAt } from './tuss';

// Tabela 22 = "Procedimentos e eventos em saude" da ANS. Tabela 20 = diarias.
const TAB_PROCEDIMENTOS = 22;
const TAB_DIARIAS = 20;

beforeAll(async () => {
  await jobsPool().query(
    `DELETE FROM ref.tuss_term WHERE codigo IN ('10101012','10101047')`,
  );
  await loadTussCompetencia(jobsPool(), {
    competencia: '202401',
    vigenciaFrom: '2024-01-01',
    vigenciaTo: '2026-01-01',
    rows: [{
      tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
      termo: 'Consulta em consultorio (no horario normal ou preestabelecido)',
      acao: 'inclusao',
    }],
  });
  await loadTussCompetencia(jobsPool(), {
    competencia: '202601',
    vigenciaFrom: '2026-01-01',
    vigenciaTo: null,
    rows: [
      { tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
        termo: 'Consulta em consultorio', acao: 'alteracao' },
      { tabela: TAB_PROCEDIMENTOS, codigo: '10101047',
        termo: 'Teleconsulta em consultorio', acao: 'inclusao' },
    ],
  });
});

describe('TUSS versionada por data', () => {
  it('GUIA DE 2025 REAPRESENTADA EM 2026 USA O TERMO DE 2025', async () => {
    const guia2025 = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-06-10');
    const guiaHoje = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2026-06-10');
    expect(guia2025.ok).toBe(true);
    expect(guiaHoje.ok).toBe(true);
    if (!guia2025.ok || !guiaHoje.ok) return;
    expect(guia2025.value.display)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(guiaHoje.value.display).toBe('Consulta em consultorio');
    expect(guia2025.value.terminologyVersion).toBe('202401');
    expect(guiaHoje.value.terminologyVersion).toBe('202601');
  });

  it('codigo criado na competencia de 2026 nao e inventado para atendimento de 2025', async () => {
    const r = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101047', '2025-06-10');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('codigo_inexistente_na_data');
  });

  it('o limite superior e exclusivo: 2026-01-01 ja e a competencia nova', async () => {
    const vespera = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-12-31');
    const virada = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2026-01-01');
    expect(vespera.ok && vespera.value.terminologyVersion).toBe('202401');
    expect(virada.ok && virada.value.terminologyVersion).toBe('202601');
  });

  it('recarregar competencia sobre vigencia existente e impossivel: o banco recusa', async () => {
    await expect(
      loadTussCompetencia(jobsPool(), {
        competencia: '202503',
        vigenciaFrom: '2025-01-01',   // invade a faixa 2024-2026 do mesmo codigo
        vigenciaTo: '2027-01-01',
        rows: [{ tabela: TAB_PROCEDIMENTOS, codigo: '10101012',
                 termo: 'Consulta (carga errada)', acao: 'alteracao' }],
      }),
    ).rejects.toMatchObject({ code: '23P01' });   // exclusion_violation
  });

  it('o mesmo codigo em tabelas diferentes da ANS nao se confunde', async () => {
    await loadTussCompetencia(jobsPool(), {
      competencia: '202401', vigenciaFrom: '2024-01-01', vigenciaTo: null,
      rows: [{ tabela: TAB_DIARIAS, codigo: '10101012',
               termo: 'Diaria de apartamento', acao: 'inclusao' }],
    });
    const proc = await resolveTussAt(appPool(), TAB_PROCEDIMENTOS, '10101012', '2025-06-10');
    const diaria = await resolveTussAt(appPool(), TAB_DIARIAS, '10101012', '2025-06-10');
    expect(proc.ok && proc.value.display)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(diaria.ok && diaria.value.display).toBe('Diaria de apartamento');
  });

  it('a funcao SQL ref.tuss_at devolve o mesmo termo que a funcao TS', async () => {
    const { rows } = await appPool().query(
      `SELECT termo, competencia FROM ref.tuss_at($1::smallint, $2, $3::date)`,
      [TAB_PROCEDIMENTOS, '10101012', '2025-06-10'],
    );
    expect(rows[0].termo)
      .toBe('Consulta em consultorio (no horario normal ou preestabelecido)');
    expect(rows[0].competencia).toBe('202401');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/catalogs/src/tuss.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./tuss" from "packages/catalogs/src/tuss.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Criar a migration**

Rodar: `pnpm db:new ref_tuss` — cria `packages/db/migrations/0020_ref_tuss.sql`. Preencher com exatamente:

```sql
-- 0020_ref_tuss.sql
-- Terminologia TUSS GLOBAL, versionada por data (§3.9, §8 Fase 0, §10 item 11).
-- Sem RLS e sem tenant_id: 200 mil linhas x N clinicas seria absurdo, e a tabela
-- da ANS e a mesma para todo mundo. O EXCLUDE exige btree_gist (instalada na
-- 0002) para o operador `=` participar ao lado do `&&` do daterange.
CREATE TABLE ref.tuss_term (
  tabela      smallint NOT NULL,
  codigo      varchar(10) NOT NULL,
  termo       text NOT NULL,
  vigencia    daterange NOT NULL,
  competencia char(6) NOT NULL,     -- AAAAMM da publicacao da ANS
  acao        text NOT NULL,        -- inclusao / alteracao / exclusao, como vem da ANS
  PRIMARY KEY (tabela, codigo, vigencia),
  -- Impossivel carregar competencia da ANS que sobreponha vigencias do mesmo codigo.
  EXCLUDE USING gist (tabela WITH =, codigo WITH =, vigencia WITH &&)
);
ALTER TABLE ref.tuss_term OWNER TO app_owner;
COMMENT ON TABLE ref.tuss_term IS 'global-reference';

CREATE INDEX ix_tuss_busca ON ref.tuss_term USING gin (termo gin_trgm_ops);

-- Lookup PELA DATA DO EVENTO: nao existe versao sem parametro de data.
CREATE FUNCTION ref.tuss_at(p_tabela smallint, p_codigo varchar, p_data date)
RETURNS ref.tuss_term LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM ref.tuss_term
   WHERE tabela = p_tabela AND codigo = p_codigo AND vigencia @> p_data $$;
ALTER FUNCTION ref.tuss_at(smallint, varchar, date) OWNER TO app_owner;

GRANT USAGE   ON SCHEMA ref TO app_rw;
GRANT SELECT  ON ref.tuss_term TO app_rw;
GRANT EXECUTE ON FUNCTION ref.tuss_at(smallint, varchar, date) TO app_rw;
-- Carga bimestral e job, nunca caminho de requisicao.
GRANT USAGE ON SCHEMA ref TO jobs;
GRANT SELECT, INSERT, DELETE ON ref.tuss_term TO jobs;
```

- [ ] **Passo 4: Implementar o módulo**

Criar `packages/catalogs/src/tuss.ts`:

```ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { Queryable, TransactionalDb } from './cid10';

export interface ResolvedTussTerm {
  system: 'TUSS';
  tabela: number;
  code: string;
  display: string;
  terminologyVersion: string;   // competencia da publicacao da ANS consultada
}

export type TussFailure = 'codigo_inexistente_na_data';

/**
 * Resolve o codigo TUSS PELA DATA DO EVENTO. `eventDate` e obrigatorio, no
 * formato AAAA-MM-DD: e a `occurred_date` do atendimento, ja no fuso da clinica.
 * Item 211 do Componente Organizacional: vale a terminologia vigente na data do
 * atendimento, nao a da execucao do faturamento.
 */
export async function resolveTussAt(
  db: Queryable, tabela: number, codigo: string, eventDate: string,
): Promise<Result<ResolvedTussTerm, TussFailure>> {
  const { rows } = await db.query(
    `SELECT tabela, codigo, termo, competencia
       FROM ref.tuss_term
      WHERE tabela = $1::smallint AND codigo = $2 AND vigencia @> $3::date`,
    [tabela, codigo, eventDate],
  );
  const row = rows[0];
  if (!row) return err('codigo_inexistente_na_data');
  return ok({
    system: 'TUSS',
    tabela: Number(row.tabela),
    code: row.codigo as string,
    display: row.termo as string,
    terminologyVersion: row.competencia as string,
  });
}

/**
 * Carga de uma competencia inteira da ANS, em UMA transacao, numa unica conexao,
 * com o papel `jobs`. Se qualquer codigo sobrepuser vigencia existente, o
 * EXCLUDE derruba a carga inteira (SQLSTATE 23P01): meia carga e pior que nenhuma.
 */
export async function loadTussCompetencia(
  db: TransactionalDb,
  input: {
    competencia: string;
    vigenciaFrom: string;
    vigenciaTo: string | null;
    rows: ReadonlyArray<{ tabela: number; codigo: string; termo: string; acao: string }>;
  },
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const r of input.rows) {
      await client.query(
        `INSERT INTO ref.tuss_term (tabela, codigo, termo, vigencia, competencia, acao)
         VALUES ($1::smallint, $2, $3, daterange($4::date, $5::date, '[)'), $6, $7)`,
        [r.tabela, r.codigo, r.termo, input.vigenciaFrom, input.vigenciaTo,
         input.competencia, r.acao],
      );
    }
    await client.query('COMMIT');
    return input.rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Passo 5: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/catalogs/src/tuss.int.test.ts
```

Esperado: `aplicada: 0020_ref_tuss.sql` e PASSA, 6 testes verdes.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/migrations/0020_ref_tuss.sql packages/catalogs/src/tuss.ts \
        packages/catalogs/src/tuss.int.test.ts
git commit -m "feat(catalogs): date-versioned TUSS with event-date lookup"
```

---

### Task 40: `display_snapshot` gravado no valor e o invariante de CI contra relógio

**Duas metades do mesmo princípio.** O valor órfão sobrevive, o significado não: gravar só `J45` faz o prontuário de 2027, impresso em 2035, mostrar a descrição de 2035. Por isso toda escrita de código carrega quatro colunas juntas — `value_ref_source`, `value_ref_code`, `display_snapshot` e `terminology_version`. E o invariante de CI existe porque a disciplina sozinha não segura: basta um `JOIN` de terminologia resolvido pelo relógio de quem executa para o snapshot voltar a ser calculado com a data errada.

**Arquivos:**
- Criar: `packages/catalogs/src/snapshot.ts`
- Teste: `packages/catalogs/src/snapshot.int.test.ts`
- Criar: `tools/terminology-clock.ts`
- Criar: `tools/check-terminology-clock.ts`
- Teste: `tools/terminology-clock.test.ts`
- Modificar: `package.json` (raiz) — bloco `scripts`

- [ ] **Passo 1: Escrever o teste do snapshot que falha**

Criar `packages/catalogs/src/snapshot.int.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { appPool, jobsPool } from '@cadencia/db';
import { loadCid10Competencia, resolveCid10At } from './cid10';
import { toTermSnapshot } from './snapshot';

beforeAll(async () => {
  await jobsPool().query(`DELETE FROM ref.cid10_term WHERE codigo = 'E11'`);
  await loadCid10Competencia(jobsPool(), {
    competencia: '200801', vigenciaFrom: '2008-01-01', vigenciaTo: '2025-01-01',
    rows: [{ codigo: 'E11', descricao: 'Diabetes mellitus nao-insulino-dependente', capitulo: 4 }],
  });
});

describe('display_snapshot', () => {
  it('grava as quatro colunas juntas: sistema, codigo, descricao e competencia', async () => {
    const r = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(toTermSnapshot(r.value)).toEqual({
      value_ref_source: 'CID10',
      value_ref_code: 'E11',
      display_snapshot: 'Diabetes mellitus nao-insulino-dependente',
      terminology_version: '200801',
    });
  });

  it('MUDAR A TERMINOLOGIA DEPOIS NAO REESCREVE O PASSADO: 2024 reaberto em 2026 da o mesmo snapshot', async () => {
    const antes = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    if (!antes.ok) throw new Error('cenario invalido: E11 deveria existir em 2024');
    const gravado = toTermSnapshot(antes.value);

    await loadCid10Competencia(jobsPool(), {
      competencia: '202501', vigenciaFrom: '2025-01-01', vigenciaTo: null,
      rows: [{ codigo: 'E11', descricao: 'Diabetes mellitus tipo 2', capitulo: 4 }],
    });

    // A carga nova vale para o atendimento novo...
    const atendimentoNovo = await resolveCid10At(appPool(), 'E11', '2026-08-03');
    expect(atendimentoNovo.ok).toBe(true);
    if (!atendimentoNovo.ok) return;
    expect(toTermSnapshot(atendimentoNovo.value)).toEqual({
      value_ref_source: 'CID10',
      value_ref_code: 'E11',
      display_snapshot: 'Diabetes mellitus tipo 2',
      terminology_version: '202501',
    });

    // ...e o atendimento de 2024, resolvido DEPOIS da carga, devolve byte a byte
    // o mesmo snapshot de antes. E isto que a impressao de 2035 tem que mostrar.
    const reaberto = await resolveCid10At(appPool(), 'E11', '2024-08-03');
    expect(reaberto.ok).toBe(true);
    if (!reaberto.ok) return;
    expect(toTermSnapshot(reaberto.value)).toEqual(gravado);
    expect(reaberto.value.display).toBe('Diabetes mellitus nao-insulino-dependente');
    expect(reaberto.value.terminologyVersion).toBe('200801');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/catalogs/src/snapshot.int.test.ts`
Esperado: FALHA com `Failed to resolve import "./snapshot" from "packages/catalogs/src/snapshot.int.test.ts". Does the file exist?`

- [ ] **Passo 3: Implementar o snapshot**

Criar `packages/catalogs/src/snapshot.ts`:

```ts
import type { ResolvedTerm } from './cid10';

/**
 * As quatro colunas que TODA gravacao de codigo carrega, em
 * clin.encounter_field_value e nas tabelas de primeira classe (§3.5, §3.6):
 * o valor orfao sobrevive, o significado nao. Gravar so o codigo faz o
 * prontuario de 2027, impresso em 2035, mostrar a descricao de 2035.
 */
export interface TermSnapshot {
  value_ref_source: 'CID10';
  value_ref_code: string;
  display_snapshot: string;
  terminology_version: string;
}

export function toTermSnapshot(resolved: ResolvedTerm): TermSnapshot {
  return {
    value_ref_source: resolved.system,
    value_ref_code: resolved.code,
    display_snapshot: resolved.display,
    terminology_version: resolved.terminologyVersion,
  };
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/catalogs/src/snapshot.int.test.ts`
Esperado: PASSA — 2 testes verdes.

- [ ] **Passo 5: Escrever o teste do invariante de CI que falha**

Criar `tools/terminology-clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectTerminologyFiles, findClockUsages, TERMINOLOGY_GLOBS } from './terminology-clock';

describe('invariante: sem relogio em codigo de terminologia', () => {
  it('acusa o token de data corrente em SQL de terminologia', () => {
    const achados = findClockUsages([{
      path: 'packages/db/migrations/9999_ruim_ref.sql',
      content: `CREATE FUNCTION ref.cid10_hoje(p_codigo varchar)\n`
             + `RETURNS ref.cid10_term LANGUAGE sql AS $$\n`
             + `  SELECT * FROM ref.cid10_term WHERE codigo = p_codigo AND vigencia @> ${'current'}_date $$;\n`,
    }]);
    expect(achados).toHaveLength(1);
    expect(achados[0]?.token).toBe('current_date');
    expect(achados[0]?.line).toBe(3);
  });

  it('acusa now() e new Date() em codigo TypeScript de terminologia', () => {
    const achados = findClockUsages([
      { path: 'packages/catalogs/src/ruim.ts', content: `const hoje = new Date();\n` },
      { path: 'packages/catalogs/src/ruim2.ts', content: `-- x\nSELECT now();\n` },
    ]);
    expect(achados.map((a) => a.token).sort()).toEqual(['new Date(', 'now(']);
  });

  it('nao acusa clock_timestamp(), que e a fonte de tempo legitima do banco', () => {
    expect(findClockUsages([{
      path: 'packages/db/migrations/0019_ref_cid10.sql',
      content: `created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()\n`,
    }])).toHaveLength(0);
  });

  it('nao acusa a data recebida por parametro, que e o caminho correto', () => {
    expect(findClockUsages([{
      path: 'packages/catalogs/src/cid10.ts',
      content: `WHERE codigo = $1 AND vigencia @> $2::date\n`,
    }])).toHaveLength(0);
  });

  it('a arvore real do repositorio esta limpa', () => {
    const arquivos = collectTerminologyFiles();
    // Se der zero, o glob esta errado e o invariante nao esta olhando para nada.
    expect(TERMINOLOGY_GLOBS.length).toBeGreaterThan(0);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(findClockUsages(arquivos)).toEqual([]);
  });
});
```

Rodar: `pnpm test tools/terminology-clock.test.ts`
Esperado: FALHA com `Failed to resolve import "./terminology-clock" from "tools/terminology-clock.test.ts". Does the file exist?`

- [ ] **Passo 6: Implementar o verificador**

Criar `tools/terminology-clock.ts`:

```ts
/**
 * Invariante de CI (§3.13 item 8, §3.9): terminologia se resolve pela DATA DO
 * EVENTO. Nenhuma leitura de relogio pode aparecer em codigo de terminologia --
 * nem no TypeScript de `catalogs`, nem no SQL das migrations de `ref`/`tiss`.
 *
 * clock_timestamp() continua permitido: e a fonte de tempo de created_at, que
 * registra QUANDO a linha foi gravada, nao a competencia consultada.
 *
 * O verificador NAO distingue codigo de comentario, de proposito: mencionar o
 * token em prosa dentro de packages/catalogs/** ou de migration de ref/tiss
 * tambem reprova. Escreva "o relogio de quem executa", nunca o token literal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TERMINOLOGY_GLOBS: RegExp[] = [
  /^packages\/catalogs\/src\/.*\.ts$/,
  /^packages\/db\/migrations\/.*(ref|tiss|cid10|tuss).*\.sql$/,
];

const TOKENS: { token: string; re: RegExp }[] = [
  { token: 'current_date', re: /\bcurrent_date\b/i },
  { token: 'current_timestamp', re: /\bcurrent_timestamp\b/i },
  { token: 'now(', re: /(^|[^_a-z])now\s*\(/i },
  { token: 'Date.now(', re: /\bDate\s*\.\s*now\s*\(/ },
  { token: 'new Date(', re: /\bnew\s+Date\s*\(/ },
];

export interface ClockUsage { path: string; line: number; token: string }

export function findClockUsages(
  files: ReadonlyArray<{ path: string; content: string }>,
): ClockUsage[] {
  const achados: ClockUsage[] = [];
  for (const f of files) {
    const linhas = f.content.split(/\r?\n/);
    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i] ?? '';
      for (const t of TOKENS) {
        if (t.re.test(linha)) achados.push({ path: f.path, line: i + 1, token: t.token });
      }
    }
  }
  return achados;
}

/** Varre a arvore a partir do diretorio corrente (o vitest roda na raiz). */
export function collectTerminologyFiles(
  raiz: string = process.cwd(),
): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const visitar = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.next', 'coverage'].includes(nome)) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { visitar(p); continue; }
      const rel = p.slice(raiz.length + 1).split('\\').join('/');
      if (rel.endsWith('.test.ts')) continue;
      if (TERMINOLOGY_GLOBS.some((re) => re.test(rel))) {
        out.push({ path: rel, content: readFileSync(p, 'utf8') });
      }
    }
  };
  visitar(raiz);
  return out;
}
```

Criar `tools/check-terminology-clock.ts`:

```ts
import { collectTerminologyFiles, findClockUsages } from './terminology-clock';

const achados = findClockUsages(collectTerminologyFiles());
if (achados.length > 0) {
  for (const a of achados) {
    console.error(`${a.path}:${a.line}  uso de relogio em terminologia: ${a.token}`);
  }
  console.error(
    '\nTerminologia se resolve pela data do evento (occurred_date), nunca pela data de hoje.',
  );
  process.exit(1);
}
console.log('ok: nenhum uso de relogio em codigo de terminologia');
```

- [ ] **Passo 7: Registrar o comando no `package.json` da raiz**

Modificar `package.json` (raiz), no bloco `"scripts"`, acrescentando a linha:

```json
    "lint:terminology-clock": "tsx tools/check-terminology-clock.ts",
```

> `prepush` continua sendo `pnpm lint:session-guc && pnpm test:iso`. Este lint entra no CI, não no gate de pré-push: ele varre a árvore inteira e não é sobre isolamento entre clínicas.

- [ ] **Passo 8: Rodar e confirmar que passa**

Rodar:

```bash
pnpm test tools/terminology-clock.test.ts
pnpm lint:terminology-clock
```

Esperado: o vitest PASSA — 5 testes verdes; o comando imprime `ok: nenhum uso de relogio em codigo de terminologia` e sai com código 0.

- [ ] **Passo 9: Rodar a suíte inteira e confirmar que nada regrediu**

Rodar:

```bash
pnpm typecheck
pnpm test
pnpm test:int
pnpm test:iso
```

Esperado: PASSA nos quatro.

- [ ] **Passo 10: Commitar**

```bash
git add packages/catalogs/src/snapshot.ts packages/catalogs/src/snapshot.int.test.ts \
        tools/terminology-clock.ts tools/check-terminology-clock.ts \
        tools/terminology-clock.test.ts package.json
git commit -m "feat(catalogs): term display snapshot and CI invariant against clock use in terminology"
```

---

### Comandos que passaram a existir nesta parte

Estes três não existiam ao final da Task 27 e agora existem — os demais itens daquela tabela (`pnpm dev`, `pnpm arch:check`, `pnpm test:perf`, `pnpm restore:drill`, `pnpm audit:export`) continuam fora do escopo destas tarefas:

| Comando | Task | O que faz |
|---|---|---|
| `pnpm authz:seed` | 38 | Regenera `ref.action` e `packages/authz/actions.lock.json` a partir de `packages/authz/src/actions.ts` |
| `pnpm authz:check` | 38 | Falha se o lock estiver desatualizado — invariante de CI |
| `pnpm lint:terminology-clock` | 40 | Reprova leitura de relógio em `packages/catalogs/**` e nas migrations de `ref`/`tiss` |

---

## Parte VI — Pipeline de CI e ensaio de restauração

> **Contexto para quem executa.** Esta parte entrega os **10 invariantes da §3.13 como código executável**, o comando `pnpm arch:check`, o workflow do GitHub Actions e o ensaio mensal de restauração. Nada aqui tem tela, e nada aqui é opcional: um vazamento entre clínicas é incidente P0 com notificação à ANPD em três dias úteis, e o único controle que o pega antes da produção é uma verificação mecânica que roda a cada merge.
>
> **A regra que decide o desenho todo: os invariantes descobrem o schema no catálogo do PostgreSQL** (`pg_class`, `pg_policy`, `pg_constraint`, `pg_attribute`, `pg_roles`, `pg_index`, `pg_inherits`), nunca numa lista mantida à mão. Uma lista à mão envelhece na primeira migration escrita com pressa, e o invariante que só conhece as tabelas de ontem aprova a tabela de hoje — que é exatamente a tabela nova, a que ninguém revisou.
>
> **Onde o código mora e por quê.** Os checks ficam em `packages/db/src/invariants/`, como **código de produção**, e não em arquivo de teste. O motivo é concreto: o mesmo runner precisa rodar contra o banco restaurado pelo ensaio da Task 48, contra o *staging* e contra a produção — lugares onde não há Vitest instalado nem repositório de teste. Os testes ficam ao lado, em `*.int.test.ts`, e rodam com `pnpm test:int` contra o PostgreSQL local (o `include` do `vitest.int.config.ts` já cobre `packages/*/src/**/*.int.test.ts`).
>
> **Três invariantes já têm prova parcial no plano, e aqui elas são unificadas, não recriadas:**
> - **Invariante 3** já existe na **Task 5** (`packages/db/src/roles-invariants.int.test.ts`): `api` sem posse, `jobs` único com `BYPASSRLS`. A Task 43 **não recria** aquele teste — ela transforma a mesma regra em função do runner único, para que ela também rode onde o Vitest nunca roda.
> - **Invariante 2** tem uma varredura de catálogo no teste T3/T4 da **Task 13**, restrita à suíte `test:iso`.
> - **Invariante 5** tem uma varredura equivalente no fim da **Task 12**.
>
> **Três refinamentos mecânicos que a §3.13 exige mas o PostgreSQL não permite exprimir ao pé da letra.** Declarados aqui para o engenheiro não descobrir sozinho no meio da Task 41:
>
> 1. **View e matview não têm RLS.** `relrowsecurity` é sempre falso nelas. O invariante 1 vira quatro ramos: tabela/partição exige `tenant_id` + RLS habilitada + forçada + ≥1 policy; **view** exige `security_invoker = true` (senão ela roda com os privilégios do dono e a RLS de quem chama é ignorada — é o mesmo vazamento, por outra porta); **matview** em `app clin fin tiss audit` é violação por definição, porque matview mora em `rpt` e é exposta por view `security_barrier` (§3.8); **foreign table** também, porque RLS não se aplica a ela.
> 2. **Partição não herda policy.** `CREATE TABLE ... PARTITION OF` não copia `relrowsecurity`, `relforcerowsecurity` nem `pg_policy`. Quem consultar a partição diretamente escapa. A Task 26 resolveu isso à mão para `audit.event` (`audit.ensure_partitions`); a Task 41 generaliza com `app.secure_partition(regclass)`, e o invariante 1 é justamente quem pega o dia em que alguém esquecer de chamá-la.
> 3. **Marcas de exceção só por `COMMENT ON` em migration** (revisada com CODEOWNERS), nunca por `Set` editável em arquivo de teste. São três: `'global-reference'` (relação fora do regime multi-tenant — já usada em `id."user"` na migration 0004), `'tenant-root'` (a única relação cujo discriminador é `id` e não `tenant_id` — `app.tenant`, já marcada na migration 0003) e, para índice, `'tenant-scoped-by-parent'`. A Task 46 acrescenta a quarta, `'clock-derived-date'`, para o único caso legítimo de derivar `date` do relógio.
>
> **Numeração de migration.** As Tasks 28 a 31 ocupam `0011` a `0014` e as Tasks 32 a 40 ocupam `0015` a `0020`. Esta parte cria duas: `0021_secure_partition.sql` (Task 41) e `0022_clock_derived_date_marks.sql` (Task 46). Como o `pnpm db:new` numera a partir da maior existente, os nomes saem sozinhos — os passos abaixo dizem qual arquivo esperar.

---

### Task 41: Harness de conformidade e invariante 1 — RLS habilitada, forçada e com policy

**Por que este é o primeiro.** É o item 1 da §3.13 e o único que, sozinho, transforma "isolamento" de disciplina de código em propriedade estrutural. Tabela sem `FORCE ROW LEVEL SECURITY` deixa o dono escapar da policy; tabela sem policy nenhuma com RLS habilitada devolve zero linhas para todo mundo (falha silenciosa que só aparece na clínica); tabela sem `tenant_id` não tem sequer o que filtrar.

**Arquivos:**
- Criar: `packages/db/src/queryable.ts`
- Criar: `packages/db/src/invariants/catalog.ts`
- Criar: `packages/db/src/invariants/inv01-rls.ts`
- Criar: `packages/db/migrations/0021_secure_partition.sql`
- Teste: `packages/db/src/invariants/inv01-rls.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/invariants/inv01-rls.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { readRelations, rlsViolations } from './inv01-rls';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 1 — isolamento e propriedade estrutural, nao disciplina de codigo', () => {
  it('toda relacao de app/clin/fin/tiss/audit tem discriminador de tenant, RLS habilitada, forcada e ao menos uma policy', async () => {
    const relacoes = await readRelations(catalogPool());
    // Se a descoberta vier vazia, o teste passaria sem verificar coisa nenhuma.
    expect(relacoes.length).toBeGreaterThan(0);
    expect(rlsViolations(relacoes)).toEqual([]);
  });

  it('reprova a tabela nova criada sem RLS — a migration escrita com pressa na sexta', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE clin.__violacao (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('clin.__violacao: RLS nao habilitada');
    expect(violacoes).toContain('clin.__violacao: RLS nao forcada — o dono da tabela escapa da policy');
    expect(violacoes).toContain('clin.__violacao: nenhuma policy');
  });

  it('reprova a tabela multi-tenant sem coluna tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE fin.__sem_tenant (id uuid NOT NULL)');
      await c.query('ALTER TABLE fin.__sem_tenant ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE fin.__sem_tenant FORCE ROW LEVEL SECURITY');
      await c.query('CREATE POLICY p ON fin.__sem_tenant AS PERMISSIVE FOR ALL TO app_rw USING (true)');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('fin.__sem_tenant: sem coluna tenant_id');
  });

  it("aceita a excecao declarada por COMMENT ON TABLE ... IS 'global-reference' e so por ela", async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__tabela_global (code text PRIMARY KEY)');
      await c.query("COMMENT ON TABLE app.__tabela_global IS 'global-reference'");
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes.filter((v) => v.startsWith('app.__tabela_global'))).toEqual([]);
  });

  it('app.tenant e a raiz do regime: o discriminador dela e id, e a marca vem da migration 0003', async () => {
    const relacoes = await readRelations(catalogPool());
    const tenant = relacoes.find((r) => r.schema === 'app' && r.relation === 'tenant');
    expect(tenant, 'app.tenant nao existe: a migration 0003 nao foi aplicada').toBeDefined();
    // Sem a marca, o invariante acusaria "sem coluna tenant_id" e a tentacao seria
    // marca-la como 'global-reference' — o que a tiraria da matriz CRUD do invariante 10
    // justamente na tabela que define a fronteira entre clinicas.
    expect(tenant?.comment).toBe('tenant-root');
    expect(tenant?.hasDiscriminator).toBe(true);
  });

  it('reprova view sem security_invoker — a view do dono ignora a RLS de quem chama', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE VIEW clin.__v_paciente AS SELECT id FROM clin.patient');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain(
      'clin.__v_paciente: view sem security_invoker=true — executa com os privilegios do dono e ignora a RLS de quem chama',
    );
  });

  it('reprova matview em schema multi-tenant — matview nao suporta RLS e pertence a rpt', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE MATERIALIZED VIEW clin.__mv AS SELECT 1 AS n');
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain(
      'clin.__mv: matview em schema multi-tenant — matview nao suporta RLS; ela mora em rpt e e exposta por view security_barrier',
    );
  });

  it('reprova particao que nao recebeu as policies do pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__particionada (
        tenant_id uuid NOT NULL, id uuid NOT NULL, dia date NOT NULL
      ) PARTITION BY RANGE (dia)`);
      await c.query('ALTER TABLE clin.__particionada ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__particionada FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__particionada AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      await c.query(`CREATE TABLE clin.__particionada_2026 PARTITION OF clin.__particionada
        FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes).toContain('clin.__particionada_2026: RLS nao habilitada');
  });

  it('app.secure_partition faz a particao herdar RLS forcada e as policies do pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__particionada (
        tenant_id uuid NOT NULL, id uuid NOT NULL, dia date NOT NULL
      ) PARTITION BY RANGE (dia)`);
      await c.query('ALTER TABLE clin.__particionada ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__particionada FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__particionada AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      await c.query(`CREATE TABLE clin.__particionada_2026 PARTITION OF clin.__particionada
        FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      await c.query("SELECT app.secure_partition('clin.__particionada_2026'::regclass)");
      return rlsViolations(await readRelations(c));
    });
    expect(violacoes.filter((v) => v.startsWith('clin.__particionada'))).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv01-rls.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./catalog"`.

- [ ] **Passo 3: Criar o contrato de conexão, em fonte única**

Criar `packages/db/src/queryable.ts`:

```ts
import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Contrato minimo de execucao de SQL. `Pool`, `PoolClient` e `Client` do `pg` o
 * satisfazem — e e por isso que todo check roda tanto no pool quanto dentro de uma
 * transacao revertida, sem duas versoes do mesmo codigo.
 *
 * Fonte UNICA: o harness de conformidade, o runner dos invariantes e o verificador
 * de restauracao (Task 48) usam este tipo. Duas declaracoes com o mesmo nome e
 * assinaturas diferentes seriam compatibilidade estrutural acidental que ninguem
 * mantem sincronizada.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}
```

- [ ] **Passo 4: Criar o harness de catálogo**

Criar `packages/db/src/invariants/catalog.ts`:

```ts
import { Client, Pool, type PoolClient } from 'pg';

export type { Queryable } from '../queryable';

/**
 * Os cinco schemas sujeitos ao regime multi-tenant (§3.13 item 1).
 * `ref`, `id`, `rpt` e `pgboss` ficam de fora por construcao: referencia global,
 * identidade global, relatorio (exposto so por view) e fila de jobs.
 */
export const TENANT_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit'] as const;

let pool: Pool | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `variavel de ambiente ausente: ${name} — rode \`cp .env.example .env\`, \`pnpm db:up\` e \`pnpm db:migrate\``,
    );
  }
  return value;
}

/**
 * Conexao administrativa: enxerga o catalogo inteiro e ignora RLS de proposito.
 * Um invariante que rodasse sob RLS veria o schema pela fresta e aprovaria o que
 * nao consegue enxergar.
 */
export function catalogPool(): Pool {
  pool ??= new Pool({
    connectionString: requireEnv('DATABASE_URL_ADMIN'),
    max: 4,
    application_name: 'cadencia-invariants',
  });
  return pool;
}

export async function closeCatalogPool(): Promise<void> {
  const atual = pool;
  pool = undefined;
  await atual?.end();
}

/**
 * Conexao como o papel `api` — o mesmo papel de runtime, com os mesmos privilegios
 * e a mesma RLS. Usada pela matriz CRUD do invariante 10 (Task 45).
 */
export async function apiClient(): Promise<Client> {
  const client = new Client({
    connectionString: requireEnv('DATABASE_URL'),
    application_name: 'cadencia-invariants-api',
  });
  await client.connect();
  return client;
}

/**
 * Executa `fn` numa transacao SEMPRE revertida. DDL no PostgreSQL e transacional,
 * entao a violacao proposital nasce e morre dentro do teste, sem sujar o banco de
 * desenvolvimento nem o do CI.
 */
export async function inRollbackTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await catalogPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
```

- [ ] **Passo 5: Rodar e confirmar que a falha mudou**

Rodar: `pnpm test:int packages/db/src/invariants/inv01-rls.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv01-rls"`.

- [ ] **Passo 6: Implementar o check do invariante 1**

Criar `packages/db/src/invariants/inv01-rls.ts`:

```ts
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface RelationRls {
  schema: string;
  relation: string;
  relkind: string;
  comment: string | null;
  hasDiscriminator: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: number;
  securityInvoker: boolean;
}

const SQL = `
SELECT n.nspname                          AS schema,
       c.relname                          AS relation,
       c.relkind::text                    AS relkind,
       obj_description(c.oid, 'pg_class') AS comment,
       EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND a.attname = CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root'
                                 THEN 'id' ELSE 'tenant_id' END
       )                                  AS has_discriminator,
       c.relrowsecurity                   AS rls_enabled,
       c.relforcerowsecurity              AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies,
       EXISTS (
         SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) AS o(opt)
          WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on')
       )                                  AS security_invoker
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'm', 'v', 'f')
 ORDER BY 1, 2`;

export async function readRelations(db: Queryable): Promise<RelationRls[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    relkind: string;
    comment: string | null;
    has_discriminator: boolean;
    rls_enabled: boolean;
    rls_forced: boolean;
    policies: number;
    security_invoker: boolean;
  }>(SQL, [[...TENANT_SCHEMAS]]);

  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    relkind: r.relkind,
    comment: r.comment,
    hasDiscriminator: r.has_discriminator,
    rlsEnabled: r.rls_enabled,
    rlsForced: r.rls_forced,
    policies: r.policies,
    securityInvoker: r.security_invoker,
  }));
}

export function rlsViolations(relations: readonly RelationRls[]): string[] {
  const out: string[] = [];

  for (const rel of relations) {
    const nome = `${rel.schema}.${rel.relation}`;
    if (rel.comment === 'global-reference') continue;

    if (rel.relkind === 'm') {
      out.push(
        `${nome}: matview em schema multi-tenant — matview nao suporta RLS; ela mora em rpt e e exposta por view security_barrier`,
      );
      continue;
    }
    if (rel.relkind === 'f') {
      out.push(`${nome}: foreign table em schema multi-tenant — RLS nao se aplica a tabela estrangeira`);
      continue;
    }
    if (rel.relkind === 'v') {
      if (!rel.securityInvoker) {
        out.push(
          `${nome}: view sem security_invoker=true — executa com os privilegios do dono e ignora a RLS de quem chama`,
        );
      }
      continue;
    }

    if (!rel.hasDiscriminator) out.push(`${nome}: sem coluna tenant_id`);
    if (!rel.rlsEnabled) out.push(`${nome}: RLS nao habilitada`);
    if (!rel.rlsForced) out.push(`${nome}: RLS nao forcada — o dono da tabela escapa da policy`);
    if (rel.policies === 0) out.push(`${nome}: nenhuma policy`);
  }

  return out;
}
```

- [ ] **Passo 7: Rodar e confirmar que falha só no último teste**

Rodar: `pnpm test:int packages/db/src/invariants/inv01-rls.int.test.ts`

Esperado: FALHA apenas em `app.secure_partition faz a particao herdar RLS forcada e as policies do pai`, com `function app.secure_partition(regclass) does not exist` (SQLSTATE `42883`). Os outros oito passam — inclusive o `reprova particao que nao recebeu as policies do pai`, que é o buraco que a migration do passo seguinte fecha.

- [ ] **Passo 8: Escrever a migration que faz partição herdar RLS**

Rodar: `pnpm db:new secure_partition` — como as Tasks 28 a 40 já ocuparam `0011` a `0020`, o comando cria `packages/db/migrations/0021_secure_partition.sql`. Preencher com exatamente:

```sql
-- 0021_secure_partition.sql
-- Particao NAO herda relrowsecurity, relforcerowsecurity nem pg_policy do pai.
-- Quem consultar a particao diretamente escapa da policy. A Task 26 resolveu isso
-- a mao para audit.event (audit.ensure_partitions); esta funcao generaliza a regra
-- para qualquer particao futura, e o invariante 1 pega quem esquecer de chama-la.

CREATE FUNCTION app.secure_partition(p_partition regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_parent regclass;
  v_pol    record;
BEGIN
  SELECT inhparent INTO v_parent FROM pg_inherits WHERE inhrelid = p_partition;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION '% nao e particao de ninguem', p_partition USING ERRCODE = '42809';
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_partition::text);
  EXECUTE format('ALTER TABLE %s FORCE  ROW LEVEL SECURITY', p_partition::text);

  FOR v_pol IN
    SELECT p.polname,
           p.polpermissive,
           p.polcmd,
           pg_get_expr(p.polqual,      p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
           CASE WHEN 0 = ANY (p.polroles) THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(r.rolname), ', ')
                        FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END AS roles
      FROM pg_policy p
     WHERE p.polrelid = v_parent
       AND NOT EXISTS (SELECT 1 FROM pg_policy q
                        WHERE q.polrelid = p_partition AND q.polname = p.polname)
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %s AS %s FOR %s TO %s %s %s',
      v_pol.polname,
      p_partition::text,
      CASE WHEN v_pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      CASE v_pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
      v_pol.roles,
      CASE WHEN v_pol.using_expr IS NULL THEN '' ELSE 'USING (' || v_pol.using_expr || ')' END,
      CASE WHEN v_pol.check_expr IS NULL THEN '' ELSE 'WITH CHECK (' || v_pol.check_expr || ')' END);
  END LOOP;
END $$;

ALTER FUNCTION app.secure_partition(regclass) OWNER TO app_owner;
REVOKE ALL ON FUNCTION app.secure_partition(regclass) FROM PUBLIC;

-- Rede de seguranca para as particoes que ja existem. As de audit.event ja vieram
-- em conformidade pela audit.ensure_partitions da 0009: aqui o laco e no-op nelas
-- (ENABLE/FORCE sao idempotentes e o laco de policy pula as que ja existem).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS rel
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relispartition
              AND n.nspname IN ('app', 'clin', 'fin', 'tiss', 'audit')
  LOOP
    PERFORM app.secure_partition(r.rel);
  END LOOP;
END $$;
```

- [ ] **Passo 9: Aplicar a migration e confirmar que passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/db/src/invariants/inv01-rls.int.test.ts
```

Esperado: PASSA, 9 testes.

Se o primeiro teste falhar apontando uma relação **real** do schema (e não uma `__violacao`), a migration daquela relação é que está errada. As três correções possíveis, nesta ordem: (a) acrescentar `ENABLE`/`FORCE ROW LEVEL SECURITY` e a policy na migration que criou a relação; (b) se a relação for global, fora do regime multi-tenant, declarar `COMMENT ON TABLE ... IS 'global-reference'` na mesma migration; (c) se a relação for a raiz do tenant — e só `app.tenant` é —, a marca correta é `'tenant-root'`, que a migration 0003 já grava. Nunca resolver editando a lista do teste: não existe lista.

- [ ] **Passo 10: Commitar**

```bash
git add packages/db/src/queryable.ts packages/db/src/invariants/catalog.ts \
        packages/db/src/invariants/inv01-rls.ts \
        packages/db/src/invariants/inv01-rls.int.test.ts \
        packages/db/migrations/0021_secure_partition.sql
git commit -m "test(db): assert RLS is enabled, forced and policied on every multi-tenant relation"
```

---

### Task 42: Invariante 2 — FK composta com `tenant_id` e nenhuma coluna `*_id` órfã

**Por que a regra é esta.** O par `(tenant_id, patient_id)` só existe se o paciente for **deste** tenant: referência cruzada vira erro `23503` na escrita, não linha invisível na leitura. A regra é mecânica e não tem lista: **se a relação referenciada tem coluna `tenant_id`, a FK precisa incluir `tenant_id` e ter duas colunas ou mais.** FK para relação sem `tenant_id` (`app.tenant`, `id."user"`, `ref.*`) fica isenta porque a FK composta é impossível ali.

A segunda metade — nenhuma coluna `*_id` órfã — pega o caso oposto: a coluna que *parece* referência e não é. O `schema` `audit` fica de fora dela por decisão: a trilha registra tentativa **sem** contexto válido (`tenant_id` é nullable) e sobre entidade que pode nem existir mais; FK ali faria a trilha recusar exatamente o evento que o auditor procura.

A Task 13 já provou essa regra dentro da suíte `test:iso`, com uma varredura escrita à mão dentro do arquivo de teste. Aqui ela vira função do runner, ganha o segundo critério (coluna órfã) e passa a rodar contra qualquer banco.

**Arquivos:**
- Criar: `packages/db/src/invariants/inv02-fk.ts`
- Teste: `packages/db/src/invariants/inv02-fk.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/invariants/inv02-fk.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { fkViolations, orphanIdColumns, readForeignKeys } from './inv02-fk';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 2 — a FK composta e o que transforma bug de aplicacao em 23503', () => {
  it('toda FK para relacao multi-tenant inclui tenant_id e tem duas colunas ou mais', async () => {
    const fks = await readForeignKeys(catalogPool());
    expect(fks.length).toBeGreaterThan(0);
    expect(fkViolations(fks)).toEqual([]);
  });

  it('reprova a FK de coluna unica para tabela multi-tenant — o caminho pelo qual o paciente de outra clinica entra no atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__consulta (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_paciente FOREIGN KEY (patient_id) REFERENCES clin.patient (id))`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes).toContain(
      'clin.__consulta.fk_paciente: FK de coluna unica (patient_id) para clin.patient, que e multi-tenant — precisa ser composta com tenant_id',
    );
  });

  it('reprova a FK composta que nao inclui tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__consulta (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL, kind text NOT NULL,
        PRIMARY KEY (id))`);
      await c.query('CREATE UNIQUE INDEX ux__pid_kind ON clin.patient_identifier (patient_id, kind)');
      await c.query(`ALTER TABLE clin.__consulta ADD CONSTRAINT fk_ident
        FOREIGN KEY (patient_id, kind) REFERENCES clin.patient_identifier (patient_id, kind)`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes).toContain(
      'clin.__consulta.fk_ident: FK (patient_id, kind) para clin.patient_identifier nao inclui tenant_id',
    );
  });

  it('aceita FK de coluna unica para relacao global, onde a FK composta e impossivel', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE app.__unidade (
        tenant_id uuid NOT NULL REFERENCES app.tenant (id), id uuid NOT NULL, PRIMARY KEY (id))`);
      return fkViolations(await readForeignKeys(c));
    });
    expect(violacoes.filter((v) => v.startsWith('app.__unidade'))).toEqual([]);
  });

  it('nenhuma coluna *_id que aponte para uma tabela conhecida fica sem FK', async () => {
    expect(await orphanIdColumns(catalogPool())).toEqual([]);
  });

  it('reprova a coluna *_id sem FK — a fresta por onde entra o id de outro tenant', async () => {
    const orfas = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE fin.__lancamento (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL, PRIMARY KEY (id))`);
      return orphanIdColumns(c);
    });
    expect(orfas).toContain(
      'fin.__lancamento.patient_id: coluna *_id sem FK, com alvo conhecido em clin.patient',
    );
  });

  it('nao reclama de coluna *_id que nao corresponde a tabela nenhuma, como head_version_id', async () => {
    const orfas = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__cache (
        tenant_id uuid NOT NULL, id uuid NOT NULL, head_version_id uuid, PRIMARY KEY (id))`);
      return orphanIdColumns(c);
    });
    expect(orfas.filter((o) => o.includes('__cache'))).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv02-fk.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv02-fk"`.

- [ ] **Passo 3: Implementar o check**

Criar `packages/db/src/invariants/inv02-fk.ts`:

```ts
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface ForeignKey {
  schema: string;
  relation: string;
  constraintName: string;
  columns: string[];
  refSchema: string;
  refRelation: string;
  refHasTenantId: boolean;
}

const FK_SQL = `
SELECT n.nspname   AS schema,
       c.relname   AS relation,
       con.conname AS constraint_name,
       (SELECT array_agg(a.attname ORDER BY k.ord)
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
       rn.nspname AS ref_schema,
       rc.relname AS ref_relation,
       EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id'
                  AND a.attnum > 0 AND NOT a.attisdropped) AS ref_has_tenant_id
  FROM pg_constraint con
  JOIN pg_class c      ON c.oid  = con.conrelid
  JOIN pg_namespace n  ON n.oid  = c.relnamespace
  JOIN pg_class rc     ON rc.oid = con.confrelid
  JOIN pg_namespace rn ON rn.oid = rc.relnamespace
 WHERE con.contype = 'f'
   AND n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition          -- particao repete a FK do pai
 ORDER BY 1, 2, 3`;

/**
 * `audit` fica de fora da varredura de coluna orfa: a trilha registra tentativa sem
 * contexto e entidade que pode ja nao existir. FK ali faria a trilha recusar
 * justamente o evento que o auditor procura.
 */
const ORPHAN_SCOPE = ['app', 'clin', 'fin', 'tiss'];

const ORPHAN_SQL = `
WITH conhecidas AS (
  SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname IN ('app', 'clin', 'fin', 'tiss', 'audit', 'ref', 'id')
)
SELECT n.nspname AS schema,
       c.relname AS relation,
       a.attname AS column_name,
       (SELECT string_agg(k.nspname || '.' || k.relname, ', ' ORDER BY k.nspname)
          FROM conhecidas k WHERE k.relname = left(a.attname, length(a.attname) - 3)) AS targets
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND a.attnum > 0 AND NOT a.attisdropped
   AND a.attname LIKE '%\\_id'
   AND a.attname <> 'tenant_id'
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM conhecidas k WHERE k.relname = left(a.attname, length(a.attname) - 3))
   AND NOT EXISTS (SELECT 1 FROM pg_constraint con
                    WHERE con.conrelid = c.oid AND con.contype = 'f'
                      AND a.attnum = ANY (con.conkey))
 ORDER BY 1, 2, 3`;

export async function readForeignKeys(db: Queryable): Promise<ForeignKey[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    constraint_name: string;
    columns: string[] | null;
    ref_schema: string;
    ref_relation: string;
    ref_has_tenant_id: boolean;
  }>(FK_SQL, [[...TENANT_SCHEMAS]]);

  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    constraintName: r.constraint_name,
    columns: r.columns ?? [],
    refSchema: r.ref_schema,
    refRelation: r.ref_relation,
    refHasTenantId: r.ref_has_tenant_id,
  }));
}

export function fkViolations(fks: readonly ForeignKey[]): string[] {
  const out: string[] = [];

  for (const fk of fks) {
    // Alvo global (app.tenant, id."user", ref.*): FK composta e impossivel, e e isenta.
    if (!fk.refHasTenantId) continue;

    const onde = `${fk.schema}.${fk.relation}.${fk.constraintName}`;
    const alvo = `${fk.refSchema}.${fk.refRelation}`;
    const cols = fk.columns.join(', ');

    if (fk.columns.length < 2) {
      out.push(
        `${onde}: FK de coluna unica (${cols}) para ${alvo}, que e multi-tenant — precisa ser composta com tenant_id`,
      );
    } else if (!fk.columns.includes('tenant_id')) {
      out.push(`${onde}: FK (${cols}) para ${alvo} nao inclui tenant_id`);
    }
  }

  return out;
}

export async function orphanIdColumns(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{
    schema: string;
    relation: string;
    column_name: string;
    targets: string | null;
  }>(ORPHAN_SQL, [ORPHAN_SCOPE]);

  return rows.map(
    (r) => `${r.schema}.${r.relation}.${r.column_name}: coluna *_id sem FK, com alvo conhecido em ${r.targets}`,
  );
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv02-fk.int.test.ts`

Esperado: PASSA, 7 testes.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/src/invariants/inv02-fk.ts packages/db/src/invariants/inv02-fk.int.test.ts
git commit -m "test(db): assert every multi-tenant foreign key is composite and no *_id column is orphan"
```

---

### Task 43: Invariantes 3 e 6 — papéis do banco e GRANTs proibidos

**O invariante 3 já existe: ele é a Task 5.** `packages/db/src/roles-invariants.int.test.ts` afirma, desde lá, que `api` não é dona de relação e que `jobs` é o único papel não-superusuário com `BYPASSRLS`. **Esta tarefa não recria aquele teste** — ela transforma a mesma regra em `roleViolations()`, uma função do runner único, pela razão que dá nome à Task 46: o runner precisa rodar contra o *staging*, contra a produção e contra o banco restaurado pelo ensaio da Task 48, onde não há Vitest. A Task 5 continua exatamente como está.

**Por que os invariantes 3 e 6 andam juntos.** As duas regras respondem à mesma pergunta: *quem consegue fazer o quê, independentemente de policy*. `api` dona de relação consegue `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` e `DROP POLICY` — a RLS inteira vira decoração. E `GRANT INSERT` direto em `audit.event` permite forjar evento sem passar por `audit.log`, que é o único lugar que carimba `actor_kind`, `outcome`, `request_id` e a whitelist de `meta`.

**Detalhe que derruba a primeira execução se ninguém avisar:** o superusuário do cluster (`postgres` no container local, o usuário mestre no RDS) tem `rolbypassrls = true` por construção do `initdb`. Ele não é papel de aplicação. Por isso o check tem um conjunto fechado — os nove papéis da §3.1 — e afirma, separadamente, que nenhum deles é superusuário. É a mesma correção que a Task 5 já fez com `AND NOT rolsuper`.

**Arquivos:**
- Criar: `packages/db/src/invariants/inv03-roles.ts`
- Teste: `packages/db/src/invariants/inv03-roles.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/invariants/inv03-roles.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { APP_ROLES, forbiddenGrantViolations, readRoles, roleViolations } from './inv03-roles';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 3 — o papel de login da aplicacao nao pode desligar o proprio isolamento', () => {
  it('api nao e superuser, nao tem BYPASSRLS, nao cria banco nem papel e nao herda privilegio', async () => {
    const papeis = await readRoles(catalogPool());
    const api = papeis.find((r) => r.name === 'api');
    expect(api, 'papel api nao existe: a migration 0001 nao rodou').toBeDefined();
    expect(api?.superuser).toBe(false);
    expect(api?.bypassRls).toBe(false);
    expect(api?.createDb).toBe(false);
    expect(api?.createRole).toBe(false);
    expect(api?.inherit).toBe(false);
  });

  it('api tem row_security=on fixado no proprio papel', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.find((r) => r.name === 'api')?.config).toContain('row_security=on');
  });

  it('jobs e o unico papel de aplicacao com BYPASSRLS — sem ele o selo e o detector de drift rodariam vendo zero linhas', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.filter((r) => APP_ROLES.has(r.name) && r.bypassRls).map((r) => r.name)).toEqual(['jobs']);
  });

  it('nenhum papel de aplicacao e superuser — superuser vence REVOKE, RLS e trigger', async () => {
    const papeis = await readRoles(catalogPool());
    expect(papeis.filter((r) => APP_ROLES.has(r.name) && r.superuser).map((r) => r.name)).toEqual([]);
  });

  it('api nao e dona de nenhuma relacao nem de nenhum schema', async () => {
    expect(await roleViolations(catalogPool())).toEqual([]);
  });

  it('reprova api dona de tabela', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__minha (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await c.query('ALTER TABLE app.__minha OWNER TO api');
      return roleViolations(c);
    });
    expect(violacoes).toContain(
      'api e dona de app.__minha — dono desliga RLS e derruba policy, o isolamento inteiro vira decoracao',
    );
  });

  it('reprova um segundo papel de aplicacao com BYPASSRLS', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('ALTER ROLE support BYPASSRLS');
      return roleViolations(c);
    });
    expect(violacoes).toContain('mais de um papel com BYPASSRLS: jobs, support — so jobs pode ter');
  });
});

describe('invariante 6 — a trilha nao aceita escrita direta e os relatorios nao vazam pelo rpt', () => {
  it('ninguem alem do dono tem INSERT, UPDATE, DELETE ou TRUNCATE em audit.event nem nas particoes dela', async () => {
    expect(await forbiddenGrantViolations(catalogPool())).toEqual([]);
  });

  it('reprova GRANT INSERT direto em audit.event — evento forjado sem passar por audit.log', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('GRANT INSERT ON audit.event TO app_rw');
      return forbiddenGrantViolations(c);
    });
    expect(violacoes).toContain('audit.event: GRANT INSERT para app_rw — a trilha so se escreve por audit.log');
  });

  it('reprova GRANT INSERT numa PARTICAO da trilha — a porta dos fundos que o GRANT no pai nao mostra', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      const { rows } = await c.query<{ nome: string }>(
        `SELECT c.relname AS nome
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'audit.event'::regclass
          ORDER BY 1 LIMIT 1`,
      );
      const particao = rows[0]?.nome;
      expect(particao, 'audit.event nao tem particao: a migration 0008 nao rodou').toBeDefined();
      await c.query(`GRANT INSERT ON audit.${particao} TO app_rw`);
      return forbiddenGrantViolations(c);
    });
    expect(violacoes.some((v) => v.includes('GRANT INSERT para app_rw — a trilha so se escreve por audit.log'))).toBe(
      true,
    );
  });

  it('reprova qualquer GRANT em rpt.* para app_rw — matview nao suporta RLS', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE rpt.__mv_atendimentos (tenant_id uuid NOT NULL, total int NOT NULL)');
      await c.query('GRANT SELECT ON rpt.__mv_atendimentos TO app_rw');
      return forbiddenGrantViolations(c);
    });
    expect(violacoes).toContain(
      'rpt.__mv_atendimentos: GRANT SELECT para app_rw — rpt e exposto so por view security_barrier',
    );
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv03-roles.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv03-roles"`.

- [ ] **Passo 3: Implementar o check**

Criar `packages/db/src/invariants/inv03-roles.ts`:

```ts
import type { Queryable } from '../queryable';

export interface RoleRow {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
  createDb: boolean;
  createRole: boolean;
  canLogin: boolean;
  inherit: boolean;
  config: string[];
}

/**
 * Os nove papeis da §3.1 — os unicos sujeitos ao invariante 3. O superusuario do
 * cluster (o `postgres` do compose, o mestre do RDS) tem `rolbypassrls = true` por
 * construcao do initdb e nao e papel de aplicacao. Por isso o check varre este
 * conjunto fechado e, separadamente, afirma que nenhum deles e superuser.
 */
export const APP_ROLES: ReadonlySet<string> = new Set([
  'app_owner',
  'app_rw',
  'clin_writer',
  'audit_owner',
  'rpt_owner',
  'app_support',
  'api',
  'support',
  'jobs',
]);

const ROLES_SQL = `
SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls,
       rolcreatedb AS create_db, rolcreaterole AS create_role,
       rolcanlogin AS can_login, rolinherit AS inherit,
       coalesce(rolconfig, '{}'::text[]) AS config
  FROM pg_roles
 WHERE rolname NOT LIKE 'pg\\_%'
 ORDER BY rolname`;

const OWNED_SQL = `
SELECT n.nspname || '.' || c.relname AS object
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r     ON r.oid = c.relowner
 WHERE r.rolname = 'api'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
 UNION ALL
SELECT 'schema ' || n.nspname
  FROM pg_namespace n
  JOIN pg_roles r ON r.oid = n.nspowner
 WHERE r.rolname = 'api'
 ORDER BY 1`;

/** audit.event E as particoes dela: GRANT na particao e a porta dos fundos. */
const AUDIT_GRANTS_SQL = `
WITH trilha AS (
  SELECT c.oid, n.nspname || '.' || c.relname AS object, c.relowner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'audit' AND c.relname = 'event'
   UNION ALL
  SELECT c.oid, n.nspname || '.' || c.relname, c.relowner
    FROM pg_inherits i
    JOIN pg_class c     ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE i.inhparent = 'audit.event'::regclass
)
SELECT t.object,
       coalesce(g.rolname, 'PUBLIC') AS grantee,
       a.privilege_type              AS privilege
  FROM trilha t
  CROSS JOIN LATERAL aclexplode(coalesce(
    (SELECT c.relacl FROM pg_class c WHERE c.oid = t.oid),
    acldefault('r', t.relowner))) a
  LEFT JOIN pg_roles g     ON g.oid = a.grantee
  JOIN pg_roles proprietario ON proprietario.oid = t.relowner
 WHERE a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3`;

const RPT_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS object,
       coalesce(g.rolname, 'PUBLIC') AS grantee,
       a.privilege_type              AS privilege
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
 WHERE n.nspname = 'rpt'
   AND coalesce(g.rolname, 'PUBLIC') IN ('app_rw', 'api', 'PUBLIC')
 ORDER BY 1, 2, 3`;

export async function readRoles(db: Queryable): Promise<RoleRow[]> {
  const { rows } = await db.query<{
    name: string;
    superuser: boolean;
    bypass_rls: boolean;
    create_db: boolean;
    create_role: boolean;
    can_login: boolean;
    inherit: boolean;
    config: string[];
  }>(ROLES_SQL);

  return rows.map((r) => ({
    name: r.name,
    superuser: r.superuser,
    bypassRls: r.bypass_rls,
    createDb: r.create_db,
    createRole: r.create_role,
    canLogin: r.can_login,
    inherit: r.inherit,
    config: r.config,
  }));
}

export async function roleViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const papeis = (await readRoles(db)).filter((r) => APP_ROLES.has(r.name));

  const bypass = papeis.filter((r) => r.bypassRls).map((r) => r.name);
  if (bypass.length !== 1 || bypass[0] !== 'jobs') {
    out.push(`mais de um papel com BYPASSRLS: ${bypass.join(', ')} — so jobs pode ter`);
  }

  const supers = papeis.filter((r) => r.superuser).map((r) => r.name);
  if (supers.length > 0) {
    out.push(`papel de aplicacao com SUPERUSER: ${supers.join(', ')} — superuser vence REVOKE e RLS`);
  }

  const api = papeis.find((r) => r.name === 'api');
  if (!api) {
    out.push('papel api nao existe');
  } else {
    if (api.superuser) out.push('api e superuser');
    if (api.bypassRls) out.push('api tem BYPASSRLS');
    if (api.createDb) out.push('api tem CREATEDB');
    if (api.createRole) out.push('api tem CREATEROLE');
    if (api.inherit) out.push('api tem INHERIT — deve ser NOINHERIT e usar SET LOCAL ROLE app_rw');
    if (!api.config.includes('row_security=on')) out.push('api sem row_security=on no papel');
  }

  const { rows } = await db.query<{ object: string }>(OWNED_SQL);
  for (const row of rows) {
    out.push(
      `api e dona de ${row.object} — dono desliga RLS e derruba policy, o isolamento inteiro vira decoracao`,
    );
  }

  return out;
}

export async function forbiddenGrantViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];

  const trilha = await db.query<{ object: string; grantee: string; privilege: string }>(AUDIT_GRANTS_SQL);
  for (const row of trilha.rows) {
    out.push(`${row.object}: GRANT ${row.privilege} para ${row.grantee} — a trilha so se escreve por audit.log`);
  }

  const rpt = await db.query<{ object: string; grantee: string; privilege: string }>(RPT_GRANTS_SQL);
  for (const row of rpt.rows) {
    out.push(
      `${row.object}: GRANT ${row.privilege} para ${row.grantee} — rpt e exposto so por view security_barrier`,
    );
  }

  return out;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv03-roles.int.test.ts`

Esperado: PASSA, 11 testes.

- [ ] **Passo 5: Confirmar que a Task 5 continua verde**

Rodar: `pnpm test:int packages/db/src/roles-invariants.int.test.ts`

Esperado: PASSA, 5 testes. As duas verificações convivem de propósito: a da Task 5 roda na suíte, a desta task roda no runner que aponta para qualquer banco.

- [ ] **Passo 6: Commitar**

```bash
git add packages/db/src/invariants/inv03-roles.ts packages/db/src/invariants/inv03-roles.int.test.ts
git commit -m "test(db): assert api owns nothing, jobs is the only BYPASSRLS role and the audit trail has no direct grants"
```

---

### Task 44: Invariantes 4 e 5 — append-only clínico e policy RESTRICTIVE

**As duas regras, sem lista manual.** (4) Toda tabela em `clin.*` com coluna `version_id` é append-only: `app_rw` não tem `UPDATE` nem `DELETE`, e `clin_writer` só pode `UPDATE` da coluna `live` — que é bit de índice, não registro clínico. (5) Toda tabela em `clin.*` com `patient_id` ou `version_id` tem ao menos uma policy `RESTRICTIVE`; sem isso o compartilhamento é contornável escolhendo outra tabela, e sai queixa, CID e sinais vitais dos pacientes de outro profissional.

**O que já existe e o que muda.** A Task 12 criou as duas policies `RESTRICTIVE` da Fase 0 (`clin.patient_identifier` e `clin.record_share`) e provou a regra 5 com uma varredura dentro da suíte `test:iso`. Nenhuma migration nova é necessária aqui: o check nasce verde contra o schema real, e o que ele passa a garantir é que a **próxima** tabela clínica não nasça sem a camada restritiva.

**Sobre o invariante 4 nascer sem nenhuma linha para verificar.** Na Fase 0 ainda não existe tabela em `clin.*` com `version_id` — ela chega com `clin.encounter_version` na Fase 1. Um check que varre zero linhas passa por vácuo, e é por isso que os quatro testes de violação abaixo não são enfeite: são eles que provam que o check funciona antes de existir a primeira tabela versionada.

**Arquivos:**
- Criar: `packages/db/src/invariants/inv04-append-only.ts`
- Teste: `packages/db/src/invariants/inv04-append-only.int.test.ts`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `packages/db/src/invariants/inv04-append-only.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { appendOnlyViolations, clinicalScopeRelations, restrictivePolicyViolations } from './inv04-append-only';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 4 — imutabilidade clinica por REVOKE, nao por convencao', () => {
  it('nenhuma tabela de clin com version_id e atualizavel ou apagavel por app_rw', async () => {
    expect(await appendOnlyViolations(catalogPool())).toEqual([]);
  });

  it('reprova UPDATE concedido a app_rw em tabela versionada', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT SELECT, UPDATE ON clin.__diagnostico TO app_rw');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain('clin.__diagnostico: app_rw tem UPDATE — tabela com version_id e append-only');
  });

  it('reprova DELETE concedido a app_rw em tabela versionada', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT DELETE ON clin.__diagnostico TO app_rw');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain('clin.__diagnostico: app_rw tem DELETE — tabela com version_id e append-only');
  });

  it('reprova clin_writer com UPDATE da tabela inteira em vez de so da coluna live', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        code text NOT NULL, live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT INSERT, UPDATE ON clin.__diagnostico TO clin_writer');
      return appendOnlyViolations(c);
    });
    expect(violacoes).toContain(
      'clin.__diagnostico: clin_writer tem UPDATE da tabela inteira — so UPDATE (live) e permitido',
    );
  });

  it('aceita o unico UPDATE legitimo: clin_writer sobre a coluna live', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__diagnostico (
        tenant_id uuid NOT NULL, id uuid NOT NULL, version_id uuid NOT NULL,
        code text NOT NULL, live boolean NOT NULL DEFAULT true)`);
      await c.query('GRANT SELECT ON clin.__diagnostico TO app_rw');
      await c.query('GRANT INSERT, UPDATE (live) ON clin.__diagnostico TO clin_writer');
      return appendOnlyViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__diagnostico'))).toEqual([]);
  });
});

describe('invariante 5 — sem policy RESTRICTIVE o compartilhamento e contornavel trocando de tabela', () => {
  it('a varredura enxerga as duas tabelas clinicas da Fase 0 — nao passa por vacuo', async () => {
    expect(await clinicalScopeRelations(catalogPool())).toEqual([
      'clin.patient_identifier',
      'clin.record_share',
    ]);
  });

  it('toda tabela de clin com patient_id ou version_id tem ao menos uma policy RESTRICTIVE', async () => {
    expect(await restrictivePolicyViolations(catalogPool())).toEqual([]);
  });

  it('reprova tabela clinica com so policy PERMISSIVE', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__observacao (
        tenant_id uuid NOT NULL, id uuid NOT NULL, patient_id uuid NOT NULL)`);
      await c.query('ALTER TABLE clin.__observacao ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE clin.__observacao FORCE ROW LEVEL SECURITY');
      await c.query(
        'CREATE POLICY tenant_isolation ON clin.__observacao AS PERMISSIVE FOR ALL TO app_rw USING (tenant_id = app.current_tenant_id())',
      );
      return restrictivePolicyViolations(c);
    });
    expect(violacoes).toContain('clin.__observacao: nenhuma policy RESTRICTIVE');
  });

  it('clin.patient continua de fora: ela e cadastro, nao prontuario (§10 item 18)', async () => {
    expect(await clinicalScopeRelations(catalogPool())).not.toContain('clin.patient');
  });
});
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv04-append-only.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv04-append-only"`.

- [ ] **Passo 3: Implementar o check**

Criar `packages/db/src/invariants/inv04-append-only.ts`:

```ts
import type { Queryable } from '../queryable';

const APPEND_ONLY_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       has_table_privilege('app_rw', c.oid, 'UPDATE')      AS rw_update,
       has_table_privilege('app_rw', c.oid, 'DELETE')      AS rw_delete,
       has_table_privilege('clin_writer', c.oid, 'UPDATE') AS writer_table_update,
       coalesce((SELECT array_agg(a.attname ORDER BY a.attname)
                   FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                    AND has_column_privilege('clin_writer', c.oid, a.attname, 'UPDATE')),
                '{}'::name[]) AS writer_update_columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'clin'
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'version_id'
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1`;

const CLINICAL_SCOPE_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       (SELECT count(*) FROM pg_policy p
         WHERE p.polrelid = c.oid AND NOT p.polpermissive)::int AS restrictive_policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'clin'
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname IN ('patient_id', 'version_id')
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1`;

export async function appendOnlyViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const { rows } = await db.query<{
    relation: string;
    rw_update: boolean;
    rw_delete: boolean;
    writer_table_update: boolean;
    writer_update_columns: string[];
  }>(APPEND_ONLY_SQL);

  for (const row of rows) {
    if (row.rw_update) out.push(`${row.relation}: app_rw tem UPDATE — tabela com version_id e append-only`);
    if (row.rw_delete) out.push(`${row.relation}: app_rw tem DELETE — tabela com version_id e append-only`);

    if (row.writer_table_update) {
      out.push(`${row.relation}: clin_writer tem UPDATE da tabela inteira — so UPDATE (live) e permitido`);
      continue; // com GRANT de tabela, has_column_privilege devolve todas as colunas
    }

    const extras = row.writer_update_columns.filter((col) => col !== 'live');
    if (extras.length > 0) {
      out.push(`${row.relation}: clin_writer tem UPDATE das colunas ${extras.join(', ')} — so live e permitido`);
    }
  }

  return out;
}

/** As relacoes que o invariante 5 varre — exportada para o teste provar que a varredura nao e vazia. */
export async function clinicalScopeRelations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ relation: string }>(CLINICAL_SCOPE_SQL);
  return rows.map((r) => r.relation);
}

export async function restrictivePolicyViolations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ relation: string; restrictive_policies: number }>(CLINICAL_SCOPE_SQL);
  return rows.filter((r) => r.restrictive_policies === 0).map((r) => `${r.relation}: nenhuma policy RESTRICTIVE`);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv04-append-only.int.test.ts`

Esperado: PASSA, 9 testes.

Se `a varredura enxerga as duas tabelas clinicas da Fase 0` falhar com uma lista maior, é porque uma task posterior criou tabela clínica nova — a correção é conferir que ela tem policy `RESTRICTIVE` e acrescentar o nome à expectativa, nunca afrouxar o check.

- [ ] **Passo 5: Commitar**

```bash
git add packages/db/src/invariants/inv04-append-only.ts \
        packages/db/src/invariants/inv04-append-only.int.test.ts
git commit -m "test(db): assert clinical tables with version_id are append-only and carry a restrictive policy"
```

---

### Task 45: Invariantes 7 e 10 — privilégios afirmados tabela a tabela e matriz CRUD cruzada

**Por que privilégio se afirma tabela a tabela.** `ALTER DEFAULT PRIVILEGES` não substitui a asserção: tabela nova com policy correta e **sem GRANT** dá 500 na primeira recepcionista às 8h, e o alarme de rollback por taxa global de erro **não dispara**, porque uma tela quebrada em cem não move a taxa. O arquivo `packages/db/privileges.json` não é lista de tabelas mantida à mão: a descoberta vem do catálogo, e o check reprova tanto a relação **descoberta e não declarada** quanto a entrada **declarada e inexistente**. O que o arquivo faz é obrigar toda mudança de privilégio a passar por revisão de código.

**Por que a matriz aceita duas formas de sucesso.** Tentar ler dado do tenant B com contexto do tenant A pode terminar em `rowCount = 0` (a policy filtrou) ou em `42501` (não há privilégio nenhum). As duas são corretas e significam coisas diferentes — o relatório distingue, senão a suíte comemora "isolado" quando na verdade a tabela é ilegível para todo mundo, inclusive para quem deveria ler. E a matriz usa **coluna sabidamente presente**: o `UPDATE` escreve `tenant_id = tenant_id` (ou `id = id` na raiz), garantido pelo invariante 1. `updated_at` não existe em metade das tabelas, e o teste que erra o nome da coluna falha por `42703` e é lido como "isolamento OK".

**Sobre a conexão do papel `api`.** A matriz usa `DATABASE_URL` — o mesmo papel de runtime. No compose local a autenticação é `trust` e a URL não tem senha; no CI o workflow da Task 48 define uma com `ALTER ROLE api LOGIN PASSWORD`. Como `api` é `NOINHERIT` (§3.1), cada célula executa `SET ROLE app_rw` dentro da transação — sem isso não há privilégio nenhum e a matriz mediria permissão, não isolamento.

**Arquivos:**
- Criar: `packages/db/src/invariants/fixtures.ts`
- Criar: `packages/db/src/invariants/inv07-privileges.ts`
- Criar: `packages/db/src/invariants/write-privileges.ts`
- Criar: `packages/db/src/invariants/inv10-crud-matrix.ts`
- Criar: `packages/db/privileges.json`
- Modificar: `package.json` (raiz) — bloco `scripts`
- Teste: `packages/db/src/invariants/inv07-privileges.int.test.ts`
- Teste: `packages/db/src/invariants/inv10-crud-matrix.int.test.ts`

- [ ] **Passo 1: Escrever o teste do invariante 7**

Criar `packages/db/src/invariants/inv07-privileges.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { diffDeclaredGrants, readDeclaredGrants, readEffectiveGrants } from './inv07-privileges';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 7 — privilegio e afirmado tabela a tabela, nao herdado de default privileges', () => {
  it('os privilegios do banco sao exatamente os declarados em packages/db/privileges.json', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    expect(Object.keys(atual).length).toBeGreaterThan(0);
    expect(diffDeclaredGrants(atual, readDeclaredGrants())).toEqual([]);
  });

  it('reprova a tabela nova sem declaracao — e ela que da 500 na primeira recepcionista as 8h', async () => {
    const diff = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__nova (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await c.query('GRANT SELECT ON app.__nova TO app_rw');
      return diffDeclaredGrants(await readEffectiveGrants(c), readDeclaredGrants());
    });
    expect(diff).toContain('app.__nova: relacao existe no banco e nao esta declarada em packages/db/privileges.json');
  });

  it('reprova a tabela declarada cujo GRANT a migration esqueceu', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    const comExtra = { ...readDeclaredGrants(), 'app.tenant': { table: { app_rw: ['SELECT', 'INSERT'] } } };
    expect(diffDeclaredGrants(atual, comExtra).some((d) => d.startsWith('app.tenant: privilegios divergem'))).toBe(
      true,
    );
  });

  it('reprova declaracao orfa, de tabela que ja nao existe', async () => {
    const atual = await readEffectiveGrants(catalogPool());
    const comFantasma = { ...readDeclaredGrants(), 'clin.tabela_que_nao_existe': { table: { app_rw: ['SELECT'] } } };
    expect(diffDeclaredGrants(atual, comFantasma)).toContain(
      'clin.tabela_que_nao_existe: declarada em packages/db/privileges.json e inexistente no banco',
    );
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv07-privileges.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv07-privileges"`.

- [ ] **Passo 3: Implementar o check do invariante 7**

Criar `packages/db/src/invariants/inv07-privileges.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

/** packages/db/privileges.json — resolvido pelo modulo, nao pelo cwd de quem chama. */
export const PRIVILEGES_FILE = fileURLToPath(new URL('../../privileges.json', import.meta.url));

export interface RelationGrants {
  table: Record<string, string[]>;
  columns?: Record<string, Record<string, string[]>>;
}

export type GrantMap = Record<string, RelationGrants>;

/** Privilegio do dono e consequencia da posse, nao GRANT: fica de fora da declaracao. */
const TABLE_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       a.privilege_type               AS privilege
  FROM pg_class c
  JOIN pg_namespace n     ON n.oid = c.relnamespace
  JOIN pg_roles proprietario ON proprietario.oid = c.relowner
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles g    ON g.oid = a.grantee
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND NOT c.relispartition
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3`;

const COLUMN_GRANTS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation,
       coalesce(g.rolname, 'PUBLIC')  AS grantee,
       att.attname                    AS column_name,
       a.privilege_type               AS privilege
  FROM pg_attribute att
  JOIN pg_class c         ON c.oid = att.attrelid
  JOIN pg_namespace n     ON n.oid = c.relnamespace
  JOIN pg_roles proprietario ON proprietario.oid = c.relowner
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  LEFT JOIN pg_roles g    ON g.oid = a.grantee
 WHERE n.nspname = ANY ($1::text[])
   AND att.attnum > 0 AND NOT att.attisdropped
   AND att.attacl IS NOT NULL
   AND NOT c.relispartition
   AND coalesce(g.rolname, 'PUBLIC') <> proprietario.rolname
 ORDER BY 1, 2, 3, 4`;

/**
 * Relacoes existentes, inclusive as SEM nenhum GRANT — que sao o caso perigoso.
 * Particao fica de fora: o nome dela muda todo mes (event_202608, event_202609) e
 * o arquivo declarado viraria ruido mensal em vez de revisao.
 */
const RELATIONS_SQL = `
SELECT n.nspname || '.' || c.relname AS relation
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND NOT c.relispartition
 ORDER BY 1`;

export async function readEffectiveGrants(db: Queryable): Promise<GrantMap> {
  const mapa: GrantMap = {};

  const relacoes = await db.query<{ relation: string }>(RELATIONS_SQL, [[...TENANT_SCHEMAS]]);
  for (const row of relacoes.rows) {
    mapa[row.relation] = { table: {} };
  }

  const tabela = await db.query<{ relation: string; grantee: string; privilege: string }>(TABLE_GRANTS_SQL, [
    [...TENANT_SCHEMAS],
  ]);
  for (const row of tabela.rows) {
    const entrada = (mapa[row.relation] ??= { table: {} });
    (entrada.table[row.grantee] ??= []).push(row.privilege);
  }

  const coluna = await db.query<{
    relation: string;
    grantee: string;
    column_name: string;
    privilege: string;
  }>(COLUMN_GRANTS_SQL, [[...TENANT_SCHEMAS]]);
  for (const row of coluna.rows) {
    const entrada = (mapa[row.relation] ??= { table: {} });
    const colunas = (entrada.columns ??= {});
    const porPapel = (colunas[row.grantee] ??= {});
    (porPapel[row.column_name] ??= []).push(row.privilege);
  }

  return sortDeep(mapa);
}

/** Ordem estavel: o diff tem que mostrar mudanca de privilegio, nunca mudanca de ordem. */
function sortDeep(mapa: GrantMap): GrantMap {
  const out: GrantMap = {};
  for (const relacao of Object.keys(mapa).sort()) {
    const entrada = mapa[relacao]!;
    const table: Record<string, string[]> = {};
    for (const papel of Object.keys(entrada.table).sort()) {
      table[papel] = [...entrada.table[papel]!].sort();
    }
    const resultado: RelationGrants = { table };
    if (entrada.columns) {
      const columns: Record<string, Record<string, string[]>> = {};
      for (const papel of Object.keys(entrada.columns).sort()) {
        const porColuna: Record<string, string[]> = {};
        for (const coluna of Object.keys(entrada.columns[papel]!).sort()) {
          porColuna[coluna] = [...entrada.columns[papel]![coluna]!].sort();
        }
        columns[papel] = porColuna;
      }
      resultado.columns = columns;
    }
    out[relacao] = resultado;
  }
  return out;
}

export function readDeclaredGrants(): GrantMap {
  if (!existsSync(PRIVILEGES_FILE)) {
    throw new Error(
      `${PRIVILEGES_FILE} nao existe: rode \`pnpm db:privileges\` e revise o arquivo gerado antes de commitar`,
    );
  }
  return JSON.parse(readFileSync(PRIVILEGES_FILE, 'utf8')) as GrantMap;
}

export function writeDeclaredGrants(atual: GrantMap): void {
  writeFileSync(PRIVILEGES_FILE, `${JSON.stringify(atual, null, 2)}\n`, 'utf8');
}

export function diffDeclaredGrants(atual: GrantMap, declarado: GrantMap): string[] {
  const out: string[] = [];

  for (const relacao of Object.keys(atual)) {
    const esperado = declarado[relacao];
    if (esperado === undefined) {
      out.push(`${relacao}: relacao existe no banco e nao esta declarada em packages/db/privileges.json`);
      continue;
    }
    const a = JSON.stringify(atual[relacao]);
    const d = JSON.stringify(sortDeep({ x: esperado }).x);
    if (a !== d) {
      out.push(`${relacao}: privilegios divergem — banco ${a} · declarado ${d}`);
    }
  }

  for (const relacao of Object.keys(declarado)) {
    if (!(relacao in atual)) {
      out.push(`${relacao}: declarada em packages/db/privileges.json e inexistente no banco`);
    }
  }

  return out.sort();
}
```

- [ ] **Passo 4: Escrever o gerador da declaração**

Criar `packages/db/src/invariants/write-privileges.ts`:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogPool, closeCatalogPool } from './catalog';
import { PRIVILEGES_FILE, readEffectiveGrants, writeDeclaredGrants } from './inv07-privileges';

/**
 * `pnpm db:privileges` — regrava packages/db/privileges.json a partir do catalogo.
 * O arquivo gerado e RASCUNHO: ele descreve o estado atual do banco. O que o
 * invariante 7 garante daqui em diante e que ninguem muda esse estado sem revisao.
 */
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const grants = await readEffectiveGrants(catalogPool());
writeDeclaredGrants(grants);
await closeCatalogPool();

console.log(`${PRIVILEGES_FILE}: ${Object.keys(grants).length} relacoes declaradas`);
```

Modificar `package.json` (raiz), bloco `"scripts"`, acrescentando a linha:

```json
    "db:privileges": "tsx packages/db/src/invariants/write-privileges.ts"
```

- [ ] **Passo 5: Gerar o arquivo e revisar tabela por tabela**

Rodar:

```bash
pnpm db:privileges
git add -N packages/db/privileges.json
git diff packages/db/privileges.json
```

Esperado: o comando imprime o caminho e a contagem de relações, e o `git diff` mostra o arquivo inteiro.

Ler o diff **tabela por tabela** e conferir contra as regras já decididas: `audit.event` só `{"app_rw":["SELECT"]}`; nada em `rpt`; nenhum `UPDATE`/`DELETE` para `app_rw` em tabela de `clin` com `version_id`. Onde o diff mostrar um GRANT que não deveria existir, a correção é na migration que o concedeu — nunca no JSON.

- [ ] **Passo 6: Rodar e confirmar que o invariante 7 passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv07-privileges.int.test.ts`

Esperado: PASSA, 4 testes.

- [ ] **Passo 7: Escrever as fixtures da matriz CRUD**

Criar `packages/db/src/invariants/fixtures.ts`:

```ts
import type { Queryable } from '../queryable';

/**
 * Dois tenants de sonda, com ids fixos e formato de UUIDv7 (versao 7, variante 10xx).
 * Sao literais de proposito: uma matriz de isolamento tem que ser reproduzivel byte
 * a byte. Todos os INSERT usam ON CONFLICT DO NOTHING — semear duas vezes e no-op.
 */
export const CRUD_TENANT_A = '01930000-0000-7000-8000-0000000ca001';
export const CRUD_TENANT_B = '01930000-0000-7000-8000-0000000ca002';
export const CRUD_CLINIC_A = '01930000-0000-7000-8000-0000000ca011';
export const CRUD_CLINIC_B = '01930000-0000-7000-8000-0000000ca012';
export const CRUD_PATIENT_A = '01930000-0000-7000-8000-0000000ca021';
export const CRUD_PATIENT_B = '01930000-0000-7000-8000-0000000ca022';

/** CNPJ alfanumerico da IN RFB 2.229/2024: 12 alfanumericos + 2 digitos. */
const CNPJ_A = '12ABC34501DE35';
const CNPJ_B = '98XYZ76509FG21';

/**
 * Semeia os dois tenants pela conexao administrativa, que ignora RLS de proposito.
 * As linhas COMMITAM: a conexao do papel `api` precisa enxerga-las para que o
 * "zero linhas" da matriz signifique "a policy filtrou", e nao "nao havia nada la".
 */
export async function seedTwoTenants(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
          VALUES ($1, 'sonda-crud-a', 'Clinica Vila Nova Ltda', $3),
                 ($2, 'sonda-crud-b', 'Clinica Rio Branco Ltda', $4)
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CNPJ_A, CNPJ_B],
  );

  await db.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
          VALUES ($1, $3, 'Unidade Vila Nova',  'America/Sao_Paulo'),
                 ($2, $4, 'Unidade Rio Branco', 'America/Rio_Branco')
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CRUD_CLINIC_A, CRUD_CLINIC_B],
  );

  await db.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name)
          VALUES ($1, $3, 'Maria Souza Lima'),
                 ($2, $4, 'Joao Pereira da Silva')
     ON CONFLICT (id) DO NOTHING`,
    [CRUD_TENANT_A, CRUD_TENANT_B, CRUD_PATIENT_A, CRUD_PATIENT_B],
  );
}
```

- [ ] **Passo 8: Escrever o teste da matriz CRUD**

Criar `packages/db/src/invariants/inv10-crud-matrix.int.test.ts`:

```ts
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiClient, catalogPool, closeCatalogPool } from './catalog';
import { CRUD_TENANT_A, CRUD_TENANT_B, seedTwoTenants } from './fixtures';
import { readCrudTargets, runCrudMatrix } from './inv10-crud-matrix';

let api: Client;

beforeAll(async () => {
  await seedTwoTenants(catalogPool());
  api = await apiClient();
});

afterAll(async () => {
  await api?.end();
  await closeCatalogPool();
});

describe('invariante 10 — matriz CRUD cruzada, com as tabelas descobertas do catalogo', () => {
  it('nenhuma tabela multi-tenant devolve ou escreve linha do outro tenant', async () => {
    const alvos = await readCrudTargets(catalogPool());
    expect(alvos.length).toBeGreaterThan(0);

    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
    const vazadas = celulas.filter((c) => c.outcome === 'VAZOU');
    expect(vazadas.map((c) => `${c.relation} ${c.operation}: ${c.detail}`)).toEqual([]);
  });

  it('a matriz nao e vaga: as tabelas semeadas tem linha do tenant B e ainda assim devolvem zero', async () => {
    const alvos = await readCrudTargets(catalogPool());
    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
    const semeadas = celulas.filter((c) => c.operation === 'SELECT' && c.seeded);

    expect(semeadas.map((c) => c.relation).sort()).toEqual(['app.clinic', 'app.tenant', 'clin.patient']);
    for (const celula of semeadas) {
      expect(celula.outcome, `${celula.relation}: ${celula.detail}`).toBe('zero_linhas');
    }
  });

  it('o relatorio distingue zero linhas de privilegio negado', async () => {
    const alvos = await readCrudTargets(catalogPool());
    const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);

    expect(celulas.every((c) => c.outcome === 'zero_linhas' || c.outcome === 'privilegio_negado')).toBe(true);
    // app_rw tem SELECT e nada mais em audit.event: UPDATE tem de ser privilegio negado.
    expect(celulas.find((c) => c.relation === 'audit.event' && c.operation === 'UPDATE')?.outcome).toBe(
      'privilegio_negado',
    );
  });

  it('pega a tabela que vaza — RLS desligada e GRANT aberto', async () => {
    const admin = catalogPool();
    try {
      // Esta tabela precisa COMMITAR: a conexao do papel api nao enxerga DDL de
      // uma transacao aberta em outra conexao. O DROP no finally e o que a limpa.
      await admin.query('CREATE TABLE clin.__vazamento (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON clin.__vazamento TO app_rw');
      await admin.query('INSERT INTO clin.__vazamento (tenant_id, id) VALUES ($1, gen_random_uuid())', [
        CRUD_TENANT_B,
      ]);

      const alvos = (await readCrudTargets(admin)).filter((t) => t.relation === '__vazamento');
      expect(alvos).toHaveLength(1);

      const celulas = await runCrudMatrix(api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
      expect(celulas.find((c) => c.operation === 'SELECT')?.outcome).toBe('VAZOU');
    } finally {
      await admin.query('DROP TABLE IF EXISTS clin.__vazamento');
    }
  });
});
```

- [ ] **Passo 9: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv10-crud-matrix.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv10-crud-matrix"`.

- [ ] **Passo 10: Implementar a matriz**

Criar `packages/db/src/invariants/inv10-crud-matrix.ts`:

```ts
import type { Client } from 'pg';
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

export interface CrudTarget {
  schema: string;
  relation: string;
  /** Coluna sabidamente presente, garantida pelo invariante 1. Nunca updated_at. */
  discriminator: string;
  seeded: boolean;
}

export type CrudOutcome = 'zero_linhas' | 'privilegio_negado' | 'VAZOU';

export interface CrudCell {
  relation: string;
  operation: 'SELECT' | 'UPDATE' | 'DELETE';
  outcome: CrudOutcome;
  seeded: boolean;
  detail: string;
}

/** As tres relacoes que a fixture semeia com linha dos DOIS tenants. */
const SEEDED = new Set(['app.tenant', 'app.clinic', 'clin.patient']);

const TARGETS_SQL = `
SELECT n.nspname AS schema,
       c.relname AS relation,
       CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root' THEN 'id' ELSE 'tenant_id' END AS discriminator
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname = CASE WHEN obj_description(c.oid, 'pg_class') = 'tenant-root'
                             THEN 'id' ELSE 'tenant_id' END)
 ORDER BY 1, 2`;

export async function readCrudTargets(db: Queryable): Promise<CrudTarget[]> {
  const { rows } = await db.query<{ schema: string; relation: string; discriminator: string }>(TARGETS_SQL, [
    [...TENANT_SCHEMAS],
  ]);
  return rows.map((r) => ({
    schema: r.schema,
    relation: r.relation,
    discriminator: r.discriminator,
    seeded: SEEDED.has(`${r.schema}.${r.relation}`),
  }));
}

function quoted(target: CrudTarget): string {
  return `"${target.schema}"."${target.relation}"`;
}

async function runCell(
  api: Client,
  target: CrudTarget,
  operation: CrudCell['operation'],
  tenantA: string,
  tenantB: string,
): Promise<CrudCell> {
  const relation = `${target.schema}.${target.relation}`;
  const disc = `"${target.discriminator}"`;
  const sql =
    operation === 'SELECT'
      ? `SELECT 1 FROM ${quoted(target)} WHERE ${disc} = $1`
      : operation === 'UPDATE'
        ? `UPDATE ${quoted(target)} SET ${disc} = ${disc} WHERE ${disc} = $1`
        : `DELETE FROM ${quoted(target)} WHERE ${disc} = $1`;

  await api.query('BEGIN');
  try {
    // `api` e NOINHERIT: sem SET ROLE nao ha privilegio de app_rw nem policy aplicavel.
    await api.query('SET ROLE app_rw');
    // Ator de sistema: dispensa linha em app.membership e ainda satisfaz app.is_member().
    await api.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', '', TRUE),
              set_config('app.clinic_id', '', TRUE),
              set_config('app.actor_kind', 'system', TRUE),
              set_config('app.request_id', '', TRUE)`,
      [tenantA],
    );

    const resultado = await api.query(sql, [tenantB]);
    const linhas = resultado.rowCount ?? 0;
    return {
      relation,
      operation,
      seeded: target.seeded,
      outcome: linhas === 0 ? 'zero_linhas' : 'VAZOU',
      detail: linhas === 0 ? 'zero linhas com contexto do tenant A' : `${linhas} linha(s) do tenant B alcancadas`,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42501') {
      return {
        relation,
        operation,
        seeded: target.seeded,
        outcome: 'privilegio_negado',
        detail: 'privilegio ausente (42501)',
      };
    }
    throw new Error(`${relation} ${operation} falhou com ${code}: ${(error as Error).message}`);
  } finally {
    await api.query('ROLLBACK').catch(() => undefined);
    await api.query('RESET ROLE').catch(() => undefined);
  }
}

export async function runCrudMatrix(
  api: Client,
  targets: readonly CrudTarget[],
  tenantA: string,
  tenantB: string,
): Promise<CrudCell[]> {
  const celulas: CrudCell[] = [];
  for (const target of targets) {
    for (const operation of ['SELECT', 'UPDATE', 'DELETE'] as const) {
      celulas.push(await runCell(api, target, operation, tenantA, tenantB));
    }
  }
  return celulas;
}

/** Só as células que reprovam — é o que o runner da Task 46 publica. */
export function crudViolations(cells: readonly CrudCell[]): string[] {
  return cells
    .filter((c) => c.outcome === 'VAZOU')
    .map((c) => `${c.relation} ${c.operation}: ${c.detail}`);
}
```

- [ ] **Passo 11: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv10-crud-matrix.int.test.ts`

Esperado: PASSA, 4 testes.

- [ ] **Passo 12: Reconciliar o invariante 7 com as linhas semeadas e commitar**

Rodar: `pnpm test:int packages/db/src/invariants/inv07-privileges.int.test.ts`

Esperado: PASSA, 4 testes — a fixture só insere **linhas**, e o invariante 7 fala de **privilégios**; nenhum dos dois interfere no outro.

```bash
git add packages/db/src/invariants/fixtures.ts packages/db/src/invariants/inv07-privileges.ts \
        packages/db/src/invariants/write-privileges.ts packages/db/src/invariants/inv10-crud-matrix.ts \
        packages/db/src/invariants/inv07-privileges.int.test.ts \
        packages/db/src/invariants/inv10-crud-matrix.int.test.ts \
        packages/db/privileges.json package.json
git commit -m "test(db): assert per-table grants against a declared file and run the cross-tenant CRUD matrix"
```

---

### Task 46: Invariantes 8 e 9 — lint de DDL, trilha viva e o runner único `pnpm db:invariants`

**As cinco proibições do invariante 8, e por que cada uma existe.** `cnpj` numérico perde o CNPJ alfanumérico da IN RFB 2.229/2024 e o erro aparece com o cliente na linha. `now()`/`current_date` em `tiss` faz o lookup de TUSS usar a terminologia de hoje em vez da vigente na data do atendimento — o lote volta rejeitado meses depois. `::date` sobre `timestamptz` fora de `app.local_date()` derruba a data do atendimento em Rio Branco. `'atendimento'` em `app.consent_type` deixaria alguém escrever o código que bloqueia atendimento esperando aceite, contra o art. 11 II f. E índice que não começa por `tenant_id` faz a recepcionista de uma clínica pagar o crescimento da base de todas as outras.

**O lint vai pegar um caso real do próprio repositório, e isso é o esperado.** `audit.ensure_partitions` (migration 0009) deriva os limites de partição de `now()` com `::date`. É legítimo — limite de partição é decisão de armazenamento, não data de evento clínico — e a marca de exceção `'clock-derived-date'`, gravada em migration, é como se declara isso. Não existe allowlist em arquivo de teste.

**Invariante 9: a trilha tem de estar viva, não só existir.** Uma trilha que existe e não recebe evento nenhum é pior que nenhuma trilha: ela dá a impressão de controle. O check reprova banco com `audit.event` vazio, e o teste prova a reprovação truncando a trilha dentro de uma transação revertida — `TRUNCATE` é transacional e não dispara o trigger `no_mutate`, que é `FOR EACH ROW`.

**E o runner único.** Ao fim desta task os dez invariantes existem como função. `pnpm db:invariants` roda todos contra qualquer banco, sem Vitest, sem repositório de teste montado — é o que o CI executa como job próprio e o que o ensaio de restauração da Task 48 aponta para o banco restaurado. O invariante 3, que nasceu na Task 5 como teste, entra aqui pela mesma porta que os outros nove.

**Arquivos:**
- Criar: `packages/db/src/invariants/inv08-ddl-lint.ts`
- Criar: `packages/db/src/invariants/inv09-audit-alive.ts`
- Criar: `packages/db/src/invariants/index.ts`
- Criar: `packages/db/src/invariants-cli.ts`
- Criar: `packages/db/migrations/0022_clock_derived_date_marks.sql`
- Modificar: `packages/db/src/index.ts`
- Modificar: `package.json` (raiz) — bloco `scripts`
- Teste: `packages/db/src/invariants/inv08-ddl-lint.int.test.ts`
- Teste: `packages/db/src/invariants/inv09-audit-alive.int.test.ts`
- Teste: `packages/db/src/invariants/run-invariants.int.test.ts`

- [ ] **Passo 1: Escrever o teste do lint de DDL**

Criar `packages/db/src/invariants/inv08-ddl-lint.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { ddlLintViolations } from './inv08-ddl-lint';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 8 — os cinco erros que so aparecem meses depois', () => {
  it('o schema atual nao viola nenhuma das cinco proibicoes', async () => {
    expect(await ddlLintViolations(catalogPool())).toEqual([]);
  });

  it('reprova coluna cnpj numerica — CNPJ e alfanumerico desde 01/07/2026', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE app.__fornecedor (tenant_id uuid NOT NULL, id uuid NOT NULL, cnpj bigint)');
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'app.__fornecedor.cnpj e bigint — CNPJ e alfanumerico (^[A-Z0-9]{12}[0-9]{2}$), varchar(14)',
    );
  });

  it('reprova relogio dentro do schema tiss — vale a terminologia da data do atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION tiss.__procedimento_vigente() RETURNS date
                     LANGUAGE sql STABLE AS $fn$ SELECT current_date $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain('tiss.__procedimento_vigente (function): le o relogio dentro do schema tiss');
  });

  it('reprova cast para date fora de app.local_date — e o que faz a guia sair com a data errada em Rio Branco', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION clin.__dia_do_atendimento(p_at timestamptz) RETURNS date
                     LANGUAGE sql IMMUTABLE AS $fn$ SELECT p_at::date $fn$`);
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'clin.__dia_do_atendimento (function): cast para date fora de app.local_date() — use a coluna occurred_date',
    );
  });

  it('aceita a excecao declarada por COMMENT ON FUNCTION quando o limite vem do relogio, nao do evento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE FUNCTION clin.__proxima_particao() RETURNS date
                     LANGUAGE sql VOLATILE AS $fn$ SELECT (date_trunc('month', now()) + interval '1 month')::date $fn$`);
      await c.query("COMMENT ON FUNCTION clin.__proxima_particao() IS 'clock-derived-date'");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__proxima_particao'))).toEqual([]);
  });

  it('nao reclama de literal com sufixo ::date, que nao e derivacao de timestamptz', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query(`CREATE TABLE clin.__periodo (
        tenant_id uuid NOT NULL, id uuid NOT NULL, inicio date NOT NULL,
        CONSTRAINT ck_inicio CHECK (inicio >= '2020-01-01'::date))`);
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('__periodo'))).toEqual([]);
  });

  it('reprova o valor atendimento em app.consent_type — bloquear atendimento esperando aceite contraria o art. 11 II f', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      // DDL e transacional: o tipo nasce e morre dentro desta transacao.
      await c.query('DROP TYPE IF EXISTS app.consent_type');
      await c.query("CREATE TYPE app.consent_type AS ENUM ('marketing','pesquisa','compartilhamento','atendimento')");
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      "app.consent_type contem o valor 'atendimento' — a base legal da assistencia e o art. 11 II f, nao consentimento",
    );
  });

  it('aceita app.consent_type sem o valor atendimento', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('DROP TYPE IF EXISTS app.consent_type');
      await c.query("CREATE TYPE app.consent_type AS ENUM ('marketing','pesquisa','compartilhamento')");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('consent_type'))).toEqual([]);
  });

  it('reprova indice de tabela multi-tenant que nao comeca por tenant_id', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE INDEX ix__patient_created ON clin.patient (created_at)');
      return ddlLintViolations(c);
    });
    expect(violacoes).toContain(
      'clin.patient / ix__patient_created: indice de tabela multi-tenant nao comeca por tenant_id (primeira coluna: created_at)',
    );
  });

  it('aceita a excecao declarada por COMMENT ON INDEX quando a linha ja esta escopada pelo pai', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      await c.query('CREATE INDEX ix__patient_created ON clin.patient (created_at)');
      await c.query("COMMENT ON INDEX clin.ix__patient_created IS 'tenant-scoped-by-parent'");
      return ddlLintViolations(c);
    });
    expect(violacoes.filter((v) => v.includes('ix__patient_created'))).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv08-ddl-lint.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv08-ddl-lint"`.

- [ ] **Passo 3: Implementar o lint**

Criar `packages/db/src/invariants/inv08-ddl-lint.ts`:

```ts
import { TENANT_SCHEMAS } from './catalog';
import type { Queryable } from '../queryable';

/**
 * Toda expressao PERSISTIDA no banco, de todas as origens onde um erro de DDL se
 * esconde: corpo de funcao, DEFAULT de coluna, CHECK/EXCLUDE, definicao de view e
 * de indice. O `comment` carrega a marca de excecao, quando ela existir.
 */
const EXPRESSIONS_SQL = `
SELECT 'function' AS source_kind, n.nspname AS schema, p.proname AS object_name,
       p.prosrc AS definition, obj_description(p.oid, 'pg_proc') AS comment
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = ANY ($1::text[])
UNION ALL
SELECT 'default', n.nspname, c.relname || '.' || a.attname,
       pg_get_expr(d.adbin, d.adrelid), NULL
  FROM pg_attrdef d
  JOIN pg_class c     ON c.oid = d.adrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
 WHERE n.nspname = ANY ($1::text[])
UNION ALL
SELECT 'constraint', n.nspname, con.conname,
       pg_get_constraintdef(con.oid), obj_description(con.oid, 'pg_constraint')
  FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = ANY ($1::text[]) AND con.contype IN ('c', 'x')
UNION ALL
SELECT 'view', n.nspname, c.relname, pg_get_viewdef(c.oid), obj_description(c.oid, 'pg_class')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[]) AND c.relkind IN ('v', 'm')
UNION ALL
SELECT 'index', n.nspname, i.relname, pg_get_indexdef(i.oid), obj_description(i.oid, 'pg_class')
  FROM pg_index x
  JOIN pg_class i     ON i.oid = x.indexrelid
  JOIN pg_class c     ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])`;

const CNPJ_SQL = `
SELECT n.nspname AS schema, c.relname AS relation, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type_name
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND a.attnum > 0 AND NOT a.attisdropped
   AND a.attname LIKE '%cnpj%'
   AND a.atttypid IN ('numeric'::regtype, 'bigint'::regtype, 'integer'::regtype,
                      'smallint'::regtype, 'double precision'::regtype, 'real'::regtype)
 ORDER BY 1, 2, 3`;

const CONSENT_SQL = `
SELECT e.enumlabel AS label
  FROM pg_enum e
  JOIN pg_type t      ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'app' AND t.typname = 'consent_type'`;

const INDEX_SQL = `
SELECT n.nspname AS schema,
       c.relname AS relation,
       i.relname AS index_name,
       x.indisprimary AS is_primary,
       x.indisunique  AS is_unique,
       obj_description(i.oid, 'pg_class') AS comment,
       coalesce((SELECT a.attname FROM pg_attribute a
                  WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]),
                '(expressao)') AS first_column
  FROM pg_index x
  JOIN pg_class i     ON i.oid = x.indexrelid
  JOIN pg_class c     ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = ANY ($1::text[])
   AND NOT c.relispartition
   AND coalesce(obj_description(c.oid, 'pg_class'), '') <> 'global-reference'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                  AND a.attnum > 0 AND NOT a.attisdropped)
 ORDER BY 1, 2, 3`;

/** Literal de texto vira '' antes do teste: '2020-01-01'::date e valor, nao derivacao. */
function stripLiterals(definition: string): string {
  return definition.replace(/'[^']*'/g, "''").replace(/''\s*::\s*date\b/gi, "''");
}

const CLOCK_RE = /\b(now\s*\(\s*\)|current_date|current_timestamp|localtimestamp)\b/i;
const DATE_CAST_RE = /(::\s*date\b|\bas\s+date\s*\))/i;

export async function ddlLintViolations(db: Queryable): Promise<string[]> {
  const out: string[] = [];
  const schemas = [...TENANT_SCHEMAS];

  const cnpj = await db.query<{ schema: string; relation: string; column_name: string; type_name: string }>(
    CNPJ_SQL,
    [schemas],
  );
  for (const row of cnpj.rows) {
    out.push(
      `${row.schema}.${row.relation}.${row.column_name} e ${row.type_name} — CNPJ e alfanumerico (^[A-Z0-9]{12}[0-9]{2}$), varchar(14)`,
    );
  }

  const expressoes = await db.query<{
    source_kind: string;
    schema: string;
    object_name: string;
    definition: string | null;
    comment: string | null;
  }>(EXPRESSIONS_SQL, [schemas]);

  for (const row of expressoes.rows) {
    const corpo = stripLiterals(row.definition ?? '');
    const rotulo = `${row.schema}.${row.object_name} (${row.source_kind})`;

    if (row.schema === 'tiss' && CLOCK_RE.test(corpo)) {
      out.push(`${rotulo}: le o relogio dentro do schema tiss`);
    }

    const eLocalDate = row.schema === 'app' && row.object_name === 'local_date';
    const marcada = row.comment === 'clock-derived-date';
    if (!eLocalDate && !marcada && DATE_CAST_RE.test(corpo)) {
      out.push(`${rotulo}: cast para date fora de app.local_date() — use a coluna occurred_date`);
    }
  }

  const consent = await db.query<{ label: string }>(CONSENT_SQL);
  for (const row of consent.rows) {
    if (row.label === 'atendimento') {
      out.push(
        "app.consent_type contem o valor 'atendimento' — a base legal da assistencia e o art. 11 II f, nao consentimento",
      );
    }
  }

  const indices = await db.query<{
    schema: string;
    relation: string;
    index_name: string;
    is_primary: boolean;
    is_unique: boolean;
    comment: string | null;
    first_column: string;
  }>(INDEX_SQL, [schemas]);

  for (const row of indices.rows) {
    if (row.is_primary || row.is_unique) continue; // chave global de UUIDv7, por decisao
    if (row.comment === 'tenant-scoped-by-parent') continue;
    if (row.first_column === 'tenant_id') continue;
    out.push(
      `${row.schema}.${row.relation} / ${row.index_name}: indice de tabela multi-tenant nao comeca por tenant_id (primeira coluna: ${row.first_column})`,
    );
  }

  return out;
}
```

- [ ] **Passo 4: Rodar e ver o lint pegar o primeiro caso real**

Rodar: `pnpm test:int packages/db/src/invariants/inv08-ddl-lint.int.test.ts`

Esperado: FALHA no primeiro teste, com `audit.ensure_partitions (function): cast para date fora de app.local_date() — use a coluna occurred_date`. Isto é o invariante funcionando: a função da migration 0009 deriva limite de partição de `now()` com `::date`. É legítimo, e o passo seguinte declara a exceção da única forma aceita — em migration.

- [ ] **Passo 5: Escrever a migration que declara a exceção**

Rodar: `pnpm db:new clock_derived_date_marks` — cria `packages/db/migrations/0022_clock_derived_date_marks.sql`. Preencher com exatamente:

```sql
-- 0022_clock_derived_date_marks.sql
-- Invariante 8 (§3.13): nenhum `::date` sobre timestamptz fora de app.local_date().
-- audit.ensure_partitions deriva LIMITE DE PARTICAO do relogio — decisao de
-- armazenamento, nao data de evento clinico. A excecao e declarada aqui, em migration
-- revisada com CODEOWNERS, e nunca numa allowlist dentro de arquivo de teste.
--
-- Quem for escrever funcao nova com esta marca, leia antes: se o `date` derivado
-- aparece em guia, prontuario, recibo ou relatorio, a marca esta errada e a resposta
-- e app.local_date(timestamptz, text) com o fuso da UNIDADE.
COMMENT ON FUNCTION audit.ensure_partitions(int) IS 'clock-derived-date';
```

- [ ] **Passo 6: Aplicar a migration e confirmar que o lint passa**

Rodar:

```bash
pnpm db:migrate
pnpm test:int packages/db/src/invariants/inv08-ddl-lint.int.test.ts
```

Esperado: PASSA, 10 testes.

- [ ] **Passo 7: Escrever o teste do invariante 9**

Criar `packages/db/src/invariants/inv09-audit-alive.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { CRUD_PATIENT_A, CRUD_TENANT_A } from './fixtures';
import { auditAliveViolations } from './inv09-audit-alive';

afterAll(async () => {
  await closeCatalogPool();
});

describe('invariante 9 — a trilha tem de estar viva, nao so existir', () => {
  it('audit.log executado de verdade insere linha em audit.event', async () => {
    const pool = catalogPool();
    const antes = await pool.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');

    // UMA conexao do comeco ao fim: o contexto e transacional (TRUE) e o INSERT
    // precisa commitar para o check enxergar o evento. Pool.query nao garante a
    // mesma conexao entre chamadas, e audit.log rodaria sem tenant nenhum.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', $1, TRUE),
                set_config('app.user_id', '', TRUE),
                set_config('app.actor_kind', 'system', TRUE),
                set_config('app.request_id', '', TRUE)`,
        [CRUD_TENANT_A],
      );
      await client.query('SELECT audit.log($1, $2, $3, $4::uuid, $5, $6::jsonb)', [
        'CONFORMANCE_PROBE',
        'clin',
        'patient',
        CRUD_PATIENT_A,
        'sucesso',
        '{}',
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const depois = await pool.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');
    expect(Number(depois.rows[0]!.total)).toBe(Number(antes.rows[0]!.total) + 1);
  });

  it('o evento gravado carrega tipo, desfecho e referencia — e nenhum conteudo clinico', async () => {
    const { rows } = await catalogPool().query<{
      event_type: string;
      outcome: string;
      entity_schema: string;
      entity_table: string;
      entity_id: string;
      meta: string;
    }>(
      `SELECT event_type, outcome, entity_schema, entity_table, entity_id::text, meta::text AS meta
         FROM audit.event WHERE event_type = 'CONFORMANCE_PROBE'
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({
      event_type: 'CONFORMANCE_PROBE',
      outcome: 'sucesso',
      entity_schema: 'clin',
      entity_table: 'patient',
      entity_id: CRUD_PATIENT_A,
      meta: '{}',
    });
  });

  it('a trilha atual nao esta vazia', async () => {
    expect(await auditAliveViolations(catalogPool())).toEqual([]);
  });

  it('reprova trilha vazia — banco com a tabela e sem evento nao prova nada em auditoria', async () => {
    const violacoes = await inRollbackTx(async (c) => {
      // TRUNCATE e transacional e nao dispara o trigger no_mutate, que e FOR EACH ROW:
      // a trilha some so dentro desta transacao, que sempre e revertida.
      await c.query('TRUNCATE audit.event');
      return auditAliveViolations(c);
    });
    expect(violacoes).toEqual(['audit.event vazio — a trilha existe e ninguem escreve nela']);
  });

  it('reprova trilha parada ha mais tempo que o orcamento', async () => {
    const violacoes = await auditAliveViolations(catalogPool(), { maxLagMinutes: -1 });
    expect(violacoes.some((v) => v.startsWith('audit.event parado ha'))).toBe(true);
  });
});
```

- [ ] **Passo 8: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/invariants/inv09-audit-alive.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./inv09-audit-alive"`.

- [ ] **Passo 9: Implementar o check da trilha viva**

Criar `packages/db/src/invariants/inv09-audit-alive.ts`:

```ts
import type { Queryable } from '../queryable';

export interface AuditAliveOptions {
  /** Defasagem maxima aceita entre agora e o evento mais recente. Ausente = sem limite. */
  maxLagMinutes?: number;
}

async function relationExists(db: Queryable, relation: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>('SELECT to_regclass($1) IS NOT NULL AS existe', [relation]);
  return rows[0]?.existe === true;
}

/**
 * A trilha nao pode so existir: uma tabela audit.event vazia da impressao de controle
 * e nao prova nada em auditoria. Num banco recem-migrado o check reprova de proposito —
 * a resposta certa e exercitar audit.log, nao afrouxar o invariante.
 */
export async function auditAliveViolations(db: Queryable, opts: AuditAliveOptions = {}): Promise<string[]> {
  if (!(await relationExists(db, 'audit.event'))) {
    return ['audit.event nao existe — a trilha nao e opcional'];
  }

  const { rows } = await db.query<{ total: string; lag_minutes: string | null }>(
    `SELECT count(*)::text AS total,
            round(extract(epoch FROM (now() - max(occurred_at))) / 60)::text AS lag_minutes
       FROM audit.event`,
  );
  const total = Number(rows[0]?.total ?? '0');
  if (total === 0) {
    return ['audit.event vazio — a trilha existe e ninguem escreve nela'];
  }

  const limite = opts.maxLagMinutes;
  const atraso = rows[0]?.lag_minutes;
  if (limite !== undefined && atraso !== null && atraso !== undefined && Number(atraso) > limite) {
    return [`audit.event parado ha ${Number(atraso)} min (orcamento: ${limite} min)`];
  }

  return [];
}
```

- [ ] **Passo 10: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/invariants/inv09-audit-alive.int.test.ts`

Esperado: PASSA, 5 testes.

- [ ] **Passo 11: Escrever o teste do runner único**

Criar `packages/db/src/invariants/run-invariants.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './catalog';
import { CRUD_TENANT_A } from './fixtures';
import { runAllInvariants } from './index';

beforeAll(async () => {
  // O invariante 9 exige trilha com evento. Um `pnpm db:migrate` recem-rodado ainda
  // nao tem nenhum, e o runner reprovaria por um motivo que nao e o deste teste.
  const client = await catalogPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, TRUE),
              set_config('app.user_id', '', TRUE),
              set_config('app.actor_kind', 'system', TRUE)`,
      [CRUD_TENANT_A],
    );
    await client.query('SELECT audit.log($1, $2, $3, NULL, $4, $5::jsonb)', [
      'INVARIANTS_RUNNER_PROBE',
      'audit',
      'event',
      'sucesso',
      '{}',
    ]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await closeCatalogPool();
});

describe('runner unico dos 10 invariantes', () => {
  it('roda os dez, na ordem da §3.13, e o banco atual nao reprova em nenhum', async () => {
    const resultados = await runAllInvariants(catalogPool());
    expect(resultados.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const reprovados = resultados.filter((r) => r.violations.length > 0);
    expect(reprovados.map((r) => `#${r.number} ${r.name}: ${r.violations.join(' · ')}`)).toEqual([]);
  });

  it('pula a matriz CRUD quando nao recebe conexao do papel api, e diz que pulou', async () => {
    const resultados = await runAllInvariants(catalogPool());
    const matriz = resultados.find((r) => r.number === 10);
    expect(matriz?.skipped).toBe(true);
    expect(matriz?.detail).toContain('conexao do papel api');
  });

  it('reprova junto com o invariante que reprova — uma tabela sem RLS derruba o runner inteiro', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query('CREATE TABLE clin.__sem_rls (tenant_id uuid NOT NULL, id uuid NOT NULL)');
      return runAllInvariants(c);
    });
    const rls = resultados.find((r) => r.number === 1);
    expect(rls?.violations).toContain('clin.__sem_rls: RLS nao habilitada');
  });
});
```

- [ ] **Passo 12: Implementar o runner e o comando**

Criar `packages/db/src/invariants/index.ts`:

```ts
import type { Client } from 'pg';
import { readRelations, rlsViolations } from './inv01-rls';
import { fkViolations, orphanIdColumns, readForeignKeys } from './inv02-fk';
import { forbiddenGrantViolations, roleViolations } from './inv03-roles';
import { appendOnlyViolations, restrictivePolicyViolations } from './inv04-append-only';
import { diffDeclaredGrants, readDeclaredGrants, readEffectiveGrants } from './inv07-privileges';
import { ddlLintViolations } from './inv08-ddl-lint';
import { auditAliveViolations } from './inv09-audit-alive';
import { crudViolations, readCrudTargets, runCrudMatrix } from './inv10-crud-matrix';
import { CRUD_TENANT_A, CRUD_TENANT_B, seedTwoTenants } from './fixtures';
import type { Queryable } from '../queryable';

export interface InvariantResult {
  number: number;
  name: string;
  skipped: boolean;
  detail: string;
  violations: string[];
}

export interface RunInvariantsOptions {
  /**
   * Conexao do papel `api`. Sem ela o invariante 10 e PULADO: a matriz cruzada
   * semeia dois tenants de sonda, e semear nao e coisa que se faz em producao sem
   * quem executa ter pedido.
   */
  api?: Client;
  /** Defasagem maxima da trilha, em minutos (invariante 9). */
  auditMaxLagMinutes?: number;
}

function ok(number: number, name: string, violations: string[]): InvariantResult {
  return {
    number,
    name,
    skipped: false,
    detail: violations.length === 0 ? 'sem violacao' : `${violations.length} violacao(oes)`,
    violations,
  };
}

/**
 * Os 10 invariantes da §3.13 contra QUALQUER banco: o local, o do CI, o staging e o
 * restaurado pelo ensaio da Task 48. Os nove primeiros so leem catalogo — nenhum
 * deles escreve linha nenhuma.
 */
export async function runAllInvariants(
  db: Queryable,
  opts: RunInvariantsOptions = {},
): Promise<InvariantResult[]> {
  const resultados: InvariantResult[] = [];

  resultados.push(ok(1, 'RLS habilitada, forcada e com policy', rlsViolations(await readRelations(db))));
  resultados.push(
    ok(2, 'FK composta e nenhuma coluna *_id orfa', [
      ...fkViolations(await readForeignKeys(db)),
      ...(await orphanIdColumns(db)),
    ]),
  );
  resultados.push(ok(3, 'api sem posse, jobs unico com BYPASSRLS', await roleViolations(db)));
  resultados.push(ok(4, 'append-only clinico', await appendOnlyViolations(db)));
  resultados.push(ok(5, 'policy RESTRICTIVE no nucleo clinico', await restrictivePolicyViolations(db)));
  resultados.push(ok(6, 'nenhum GRANT direto na trilha nem em rpt', await forbiddenGrantViolations(db)));
  resultados.push(
    ok(7, 'privilegios afirmados tabela a tabela', diffDeclaredGrants(await readEffectiveGrants(db), readDeclaredGrants())),
  );
  resultados.push(ok(8, 'lint de DDL', await ddlLintViolations(db)));
  resultados.push(
    ok(
      9,
      'trilha viva',
      await auditAliveViolations(
        db,
        opts.auditMaxLagMinutes === undefined ? {} : { maxLagMinutes: opts.auditMaxLagMinutes },
      ),
    ),
  );

  if (!opts.api) {
    resultados.push({
      number: 10,
      name: 'matriz CRUD cruzada',
      skipped: true,
      detail: 'pulado: exige conexao do papel api (rode com --with-crud)',
      violations: [],
    });
    return resultados;
  }

  await seedTwoTenants(db);
  const alvos = await readCrudTargets(db);
  const celulas = await runCrudMatrix(opts.api, alvos, CRUD_TENANT_A, CRUD_TENANT_B);
  const violacoes = crudViolations(celulas);
  resultados.push({
    number: 10,
    name: 'matriz CRUD cruzada',
    skipped: false,
    detail: `${celulas.length} celulas em ${alvos.length} relacoes`,
    violations: violacoes,
  });

  return resultados;
}
```

Criar `packages/db/src/invariants-cli.ts`:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiClient, catalogPool, closeCatalogPool } from './invariants/catalog';
import { runAllInvariants } from './invariants/index';

/**
 * pnpm db:invariants              — os 9 invariantes de catalogo, so leitura
 * pnpm db:invariants --with-crud  — mais a matriz CRUD cruzada (semeia dois tenants de sonda)
 */
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const comCrud = process.argv.includes('--with-crud');
const api = comCrud ? await apiClient() : undefined;

try {
  const resultados = await runAllInvariants(catalogPool(), api ? { api } : {});

  for (const r of resultados) {
    const rotulo = r.skipped ? 'PULADO' : r.violations.length === 0 ? 'OK' : 'REPROVA';
    console.log(`#${String(r.number).padStart(2, '0')} ${rotulo.padEnd(7)} ${r.name} — ${r.detail}`);
    for (const v of r.violations) {
      console.error(`        ${v}`);
    }
  }

  const reprovados = resultados.filter((r) => r.violations.length > 0);
  if (reprovados.length > 0) {
    console.error(
      `\n${reprovados.length} invariante(s) reprovado(s). Nenhum deles se conserta editando o teste: ` +
        'a correcao e na migration que criou a relacao, o GRANT ou a policy.',
    );
    process.exitCode = 1;
  } else {
    console.log('\ntodos os invariantes da §3.13 verdes');
  }
} finally {
  await api?.end();
  await closeCatalogPool();
}
```

Modificar `package.json` (raiz), bloco `"scripts"`, acrescentando a linha:

```json
    "db:invariants": "tsx packages/db/src/invariants-cli.ts"
```

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, closePools } from './pool';
export { withTenantTx, preambleParams, type Actor, type TxClient } from './tx';
export type { Queryable } from './queryable';
export { runAllInvariants, type InvariantResult, type RunInvariantsOptions } from './invariants/index';
```

- [ ] **Passo 13: Rodar o runner e a suíte**

Rodar:

```bash
pnpm test:int packages/db/src/invariants/run-invariants.int.test.ts
pnpm db:invariants
```

Esperado: os testes passam (3 testes) e o comando imprime dez linhas — `#01` a `#09` com `OK` e `#10 PULADO`, terminando com `todos os invariantes da §3.13 verdes` e código de saída 0.

- [ ] **Passo 14: Rodar o runner com a matriz e confirmar o exit code**

Rodar: `pnpm db:invariants --with-crud`

Esperado: as dez linhas com `OK`, agora com `#10 OK  matriz CRUD cruzada — N celulas em M relacoes`.

- [ ] **Passo 15: Commitar**

```bash
git add packages/db/src/invariants/inv08-ddl-lint.ts packages/db/src/invariants/inv09-audit-alive.ts \
        packages/db/src/invariants/index.ts packages/db/src/invariants-cli.ts \
        packages/db/src/invariants/inv08-ddl-lint.int.test.ts \
        packages/db/src/invariants/inv09-audit-alive.int.test.ts \
        packages/db/src/invariants/run-invariants.int.test.ts \
        packages/db/migrations/0022_clock_derived_date_marks.sql \
        packages/db/src/index.ts package.json
git commit -m "feat(db): lint DDL, assert the audit trail is alive and expose all ten invariants in a single runner"
```

---

### Task 47: `pnpm arch:check` — setas só descem, irmão nunca importa irmão, sem ciclo

**A sub-ordem dentro de L0, que o grafo da §2.2 não desenha, e que este plano já decidiu.** L0 tem três faixas, e a diferença entre elas é o que a Task 3 do plano já afirmou em prosa: **`packages/db` não importa `packages/kernel`** — são irmãos, e a §2.2 não abre exceção. A ordem é:

- **base**: `kernel`, `events` — não importam pacote nenhum. `events` carrega contrato, sem comportamento.
- **infraestrutura**: `db`, `audit` — **também não importam pacote nenhum, nem o kernel**. É por isso que a Fase 0 constrói o banco *antes* do kernel, e é por isso que `withTenantTx` relança o erro cru do PostgreSQL em vez de traduzir para erro de domínio: a tradução é responsabilidade de L3.
- **serviços de L0**: `authn`, `authz`, `storage`, `jobs`, `outbox`, `integrations` — podem importar base e infraestrutura, nunca uns aos outros.

Dentro de cada faixa a proibição é absoluta, **inclusive pelo `index.ts`** — permitir importar o barril do irmão para pegar um tipo é o caminho pelo qual o ciclo volta em seis meses.

**Por que o teste cria o arquivo alvo também.** Um teste de violação que importa um módulo inexistente dispara a regra `sem-import-nao-resolvido`, e não a regra de camada que ele afirma verificar. Passaria verde com a configuração de camadas inteira quebrada. Por isso cada caso cria **os dois** arquivos e afirma explicitamente que a saída **não** contém `sem-import-nao-resolvido`.

**Arquivos:**
- Criar: `.dependency-cruiser.cjs`
- Criar: `tools/arch/arch-check.test.ts`
- Modificar: `package.json` (raiz) — blocos `scripts` e `devDependencies`

- [ ] **Passo 1: Instalar o dependency-cruiser**

```bash
pnpm add -D -w dependency-cruiser
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `tools/arch/arch-check.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STUB = 'export const nada = null;\n';
const TIMEOUT = 120_000;

function archCheck(): { code: number; output: string } {
  try {
    const output = execFileSync('pnpm', ['arch:check'], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * Cria TODOS os arquivos de uma vez: o importador e o alvo. Sem o alvo, o import nao
 * resolve e o depcruise reprova por `sem-import-nao-resolvido` — o teste passaria sem
 * nunca exercitar a regra de camada, que e o que ele existe para verificar.
 */
function withTempFiles(arquivos: ReadonlyArray<readonly [string, string]>, fn: () => void): void {
  for (const [caminho, conteudo] of arquivos) {
    mkdirSync(join(caminho, '..'), { recursive: true });
    writeFileSync(caminho, conteudo, 'utf8');
  }
  try {
    fn();
  } finally {
    for (const [caminho] of arquivos) rmSync(caminho, { force: true });
  }
}

describe('arch:check — o grafo de modulos e verificado, nao combinado', () => {
  it(
    'o repositorio atual respeita as camadas',
    () => {
      const { code, output } = archCheck();
      expect(output).not.toMatch(/error/i);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'reprova import ascendente: L0 nao conhece L1',
    () => {
      withTempFiles(
        [
          [join(process.cwd(), 'packages/patients/src/__arch_target__.ts'), STUB],
          [
            join(process.cwd(), 'packages/authn/src/__arch_violation__.ts'),
            "import { nada } from '../../patients/src/__arch_target__';\nexport const x = nada;\n",
          ],
        ],
        () => {
          const { code, output } = archCheck();
          expect(code).not.toBe(0);
          expect(output).not.toMatch(/sem-import-nao-resolvido/);
          expect(output).toMatch(/setas-so-descem/);
        },
      );
    },
    TIMEOUT,
  );

  it(
    'reprova import entre irmaos, mesmo passando pelo index.ts — e por ai que o ciclo volta',
    () => {
      withTempFiles(
        [
          [join(process.cwd(), 'packages/authz/src/__arch_target__.ts'), STUB],
          [
            join(process.cwd(), 'packages/authn/src/__arch_violation__.ts'),
            "import { nada } from '../../authz/src/__arch_target__';\nexport const x = nada;\n",
          ],
        ],
        () => {
          const { code, output } = archCheck();
          expect(code).not.toBe(0);
          expect(output).not.toMatch(/sem-import-nao-resolvido/);
          expect(output).toMatch(/irmao-nao-importa-irmao/);
        },
      );
    },
    TIMEOUT,
  );

  it(
    'reprova packages/db importando packages/kernel — irmaos em L0, sem excecao',
    () => {
      withTempFiles(
        [
          [join(process.cwd(), 'packages/kernel/src/__arch_target__.ts'), STUB],
          [
            join(process.cwd(), 'packages/db/src/__arch_violation__.ts'),
            "import { nada } from '../../kernel/src/__arch_target__';\nexport const x = nada;\n",
          ],
        ],
        () => {
          const { code, output } = archCheck();
          expect(code).not.toBe(0);
          expect(output).not.toMatch(/sem-import-nao-resolvido/);
          expect(output).toMatch(/db-e-audit-nao-importam-irmao/);
        },
      );
    },
    TIMEOUT,
  );

  it(
    'reprova import horizontal em L2, onde o grafo tem zero arestas por decisao',
    () => {
      withTempFiles(
        [
          [join(process.cwd(), 'packages/emr/src/__arch_target__.ts'), STUB],
          [
            join(process.cwd(), 'packages/billing/src/__arch_violation__.ts'),
            "import { nada } from '../../emr/src/__arch_target__';\nexport const x = nada;\n",
          ],
        ],
        () => {
          const { code, output } = archCheck();
          expect(code).not.toBe(0);
          expect(output).not.toMatch(/sem-import-nao-resolvido/);
          expect(output).toMatch(/irmao-nao-importa-irmao/);
        },
      );
    },
    TIMEOUT,
  );

  it(
    'reprova web importando db — web nao recebe DATABASE_URL por task role',
    () => {
      withTempFiles(
        [
          [join(process.cwd(), 'packages/db/src/__arch_target__.ts'), STUB],
          [
            join(process.cwd(), 'apps/web/src/__arch_violation__.ts'),
            "import { nada } from '../../../packages/db/src/__arch_target__';\nexport const x = nada;\n",
          ],
        ],
        () => {
          const { code, output } = archCheck();
          expect(code).not.toBe(0);
          expect(output).not.toMatch(/sem-import-nao-resolvido/);
          expect(output).toMatch(/web-nao-fala-com-banco/);
        },
      );
    },
    TIMEOUT,
  );
});
```

- [ ] **Passo 3: Rodar e confirmar que falha**

Rodar: `pnpm test tools/arch/arch-check.test.ts`

Esperado: FALHA com `ERR_PNPM_NO_SCRIPT  Missing script: arch:check` na saída capturada de todos os casos.

- [ ] **Passo 4: Escrever a configuração completa**

Criar `.dependency-cruiser.cjs`:

```js
/**
 * Grafo de modulos do Cadencia (§2.2). Tres regras mecanicas:
 *   1. Setas so descem — nenhum import ascendente.
 *   2. Irmao nunca importa irmao, nem pelo index.ts. Sem excecao.
 *   3. Composicao entre irmaos e responsabilidade de L3.
 *
 * L0 tem tres faixas, e a diferenca entre elas ja esta escrita no plano da Fase 0:
 *   base   = kernel, events            -> nao importam pacote nenhum
 *   infra  = db, audit                 -> TAMBEM nao importam pacote nenhum, nem o kernel
 *   serv   = authn, authz, storage, jobs, outbox, integrations -> importam base e infra
 *
 * `packages/db` importar `packages/kernel` e violacao: sao irmaos em L0, e e por isso
 * que a Fase 0 constroi o banco antes do kernel e que withTenantTx relanca o erro cru
 * do PostgreSQL em vez de traduzir para erro de dominio.
 */
const BASE = 'kernel|events';
const INFRA = 'db|audit';
const SERV = 'authn|authz|storage|jobs|outbox|integrations';
const L1 = 'identity|tenancy|people|patients|catalogs';
const L2 =
  'scheduling|emr|documents|prescriptions|billing|payments|tiss|messaging|inventory|reports|export|retention';
const L3 = 'web|api|worker';

/** Proibe irmao importar irmao usando a retrorreferencia $1 do grupo casado em `from`. */
function siblings(nome, grupo) {
  return {
    name: `irmao-nao-importa-irmao-${nome}`,
    severity: 'error',
    comment:
      'Irmao nunca importa irmao — nem o index.ts. Composicao entre irmaos e responsabilidade de L3.',
    from: { path: `^packages/(${grupo})/` },
    to: { path: `^packages/(${grupo})/`, pathNot: '^packages/$1/' },
  };
}

/** Proibe import ascendente de uma faixa para outra. */
function upward(nome, de, para) {
  return {
    name: `setas-so-descem-${nome}`,
    severity: 'error',
    comment: 'Import ascendente: a camada de baixo nao pode conhecer a de cima.',
    from: { path: `^packages/(${de})/` },
    to: { path: `^packages/(${para})/` },
  };
}

module.exports = {
  forbidden: [
    {
      name: 'sem-ciclo',
      severity: 'error',
      comment: 'Ciclo de dependencia: o grafo de modulos e um DAG estrito.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sem-import-nao-resolvido',
      severity: 'error',
      comment: 'Import que nao resolve para arquivo nem para pacote instalado.',
      from: {},
      to: { couldNotResolve: true },
    },

    {
      name: 'folha-nao-importa-pacote',
      severity: 'error',
      comment: 'kernel e events sao folhas do grafo: zero dependencia de pacote do repositorio.',
      from: { path: `^packages/(${BASE})/` },
      to: { path: '^packages/', pathNot: '^packages/$1/' },
    },
    {
      name: 'db-e-audit-nao-importam-irmao',
      severity: 'error',
      comment:
        'db e audit nao importam pacote nenhum, nem o kernel: sao irmaos em L0 e a §2.2 nao abre excecao. ' +
        'Result, uuidv7 e a traducao de erro entram na borda, em L3.',
      from: { path: `^packages/(${INFRA})/` },
      to: { path: '^packages/', pathNot: '^packages/$1/' },
    },

    siblings('L0', SERV),
    siblings('L1', L1),
    siblings('L2', L2),
    {
      name: 'irmao-nao-importa-irmao-L3',
      severity: 'error',
      comment: 'web, api e worker sao processos separados: falam por HTTP, nao por import.',
      from: { path: `^apps/(${L3})/` },
      to: { path: `^apps/(${L3})/`, pathNot: '^apps/$1/' },
    },

    upward('L0-para-L1-L2', `${BASE}|${INFRA}|${SERV}`, `${L1}|${L2}`),
    upward('L1-para-L2', L1, L2),
    {
      name: 'setas-so-descem-nada-importa-apps',
      severity: 'error',
      comment: 'Nenhum pacote importa app: L3 e o topo e so ele compoe.',
      from: { path: '^packages/' },
      to: { path: `^apps/(${L3})/` },
    },

    {
      name: 'web-nao-fala-com-banco',
      severity: 'error',
      comment: 'So api e worker abrem conexao: web nao recebe DATABASE_URL por task role (§2.1).',
      from: { path: '^apps/web/' },
      to: { path: '^packages/(db|jobs|outbox)/' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.next|\\.turbo)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
```

- [ ] **Passo 5: Registrar o comando**

Modificar `package.json` (raiz), bloco `"scripts"`, acrescentando a linha:

```json
    "arch:check": "depcruise --config .dependency-cruiser.cjs --output-type err-long packages apps"
```

- [ ] **Passo 6: Rodar e confirmar que passa**

Rodar: `pnpm arch:check`

Esperado: nenhuma violação e código de saída 0.

Rodar: `pnpm test tools/arch/arch-check.test.ts`

Esperado: PASSA, 6 testes. Os arquivos de violação nascem e morrem dentro de cada caso (`finally` com `rmSync`); os diretórios `packages/*/src` e `apps/*/src` já existem desde a Task 1.

- [ ] **Passo 7: Fazer o `prepush` rodar o `arch:check`**

A Definição de pronto registra, textualmente, que `prepush` nasceu como `pnpm lint:session-guc && pnpm test:iso` **porque `arch:check` ainda não existia**. Agora existe, e ele é o mais barato dos três — roda em segundos e pega a classe de erro mais cara de desfazer.

Modificar `package.json` (raiz), bloco `"scripts"`, substituindo a linha do `prepush` por:

```json
    "prepush": "pnpm arch:check && pnpm lint:session-guc && pnpm test:iso"
```

Rodar: `pnpm prepush`

Esperado: os três terminam com código 0, nesta ordem: grafo de módulos, lint do GUC de sessão, suíte de isolamento.

- [ ] **Passo 8: Commitar**

```bash
git add .dependency-cruiser.cjs tools/arch/arch-check.test.ts package.json pnpm-lock.yaml
git commit -m "build: enforce the module DAG with dependency-cruiser and wire arch:check into prepush"
```

---

### Task 48: `verify-restore`, `pnpm restore:drill` e o workflow do GitHub Actions

**Por que o ensaio é inegociável.** Perder prontuário é evento de extinção do negócio: a guarda é de 20 anos por lei (Lei 13.787/2018, art. 6 §5), o acervo é append-only e não existe versão de papel para reconstituir. E **backup nunca testado não é backup — é um arquivo com nome de backup**. O ensaio restaura o snapshot **em VPC isolada** (nunca ao lado da produção, onde um erro de endpoint escreve no banco vivo), roda `verify-restore` **e o runner dos dez invariantes** contra a instância restaurada, mede o tempo até a primeira consulta boa e destrói a instância. Mensal; trimestral só a partir do segundo provedor, senão a cópia externa nunca foi testada.

**Por que o ensaio roda os invariantes também.** Restauração que devolve os bytes mas perde `FORCE ROW LEVEL SECURITY`, ou volta com um GRANT que não estava lá, é restauração que só se descobre errada no dia em que ela for usada de verdade — que é, por definição, o pior dia possível.

**Arquivos:**
- Criar: `packages/db/src/verify-restore.ts`
- Criar: `scripts/restore-drill.ts`
- Criar: `.github/workflows/ci.yml`
- Criar: `.github/workflows/agendado.yml`
- Modificar: `packages/db/src/index.ts`
- Modificar: `tsconfig.json` (campo `include`)
- Modificar: `package.json` (raiz) — blocos `scripts` e `devDependencies`
- Teste: `packages/db/src/verify-restore.int.test.ts`

- [ ] **Passo 1: Escrever o teste do verificador**

Criar `packages/db/src/verify-restore.int.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { catalogPool, closeCatalogPool, inRollbackTx } from './invariants/catalog';
import { verifyRestore } from './verify-restore';
import type { CheckResult } from './verify-restore';

const TENANT = '01930000-0000-7000-8000-0000000ce001';

afterAll(async () => {
  await closeCatalogPool();
});

function check(resultados: readonly CheckResult[], nome: string): CheckResult {
  const achado = resultados.find((r) => r.name === nome);
  expect(achado, `check ${nome} nao foi executado`).toBeDefined();
  return achado!;
}

describe('verify-restore — restauracao so vale se for verificada', () => {
  it('confirma que os oito schemas do desenho vieram inteiros', async () => {
    const resultados = await verifyRestore(catalogPool());
    const schemas = check(resultados, 'schemas-presentes');
    expect(schemas.ok).toBe(true);
    expect(schemas.skipped).toBe(false);
  });

  it('aprova quando a trilha tem evento — e o estado esperado de um banco restaurado de verdade', async () => {
    const resultados = await verifyRestore(catalogPool());
    const trilha = check(resultados, 'trilha-nao-vazia');
    expect(trilha.skipped).toBe(false);
    expect(trilha.ok).toBe(true);
    expect(trilha.detail).toMatch(/^[1-9]\d* evento\(s\) em audit\.event$/);
  });

  it('reprova trilha vazia — banco restaurado sem trilha nao prova nada em auditoria', async () => {
    const resultados = await inRollbackTx(async (c) => {
      // TRUNCATE e transacional e nao dispara o trigger de linha `no_mutate`:
      // a trilha some so dentro desta transacao, que sempre e revertida.
      await c.query('TRUNCATE audit.event');
      return verifyRestore(c);
    });
    const trilha = check(resultados, 'trilha-nao-vazia');
    expect(trilha.skipped).toBe(false);
    expect(trilha.ok).toBe(false);
    expect(trilha.detail).toBe('0 evento(s) em audit.event');
  });

  it('aprova cadeia de selo encadeada corretamente', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query(
        `INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id, row_count,
                                 chain_hash, prev_chain_hash, snapshot_xmin)
              VALUES ($1, DATE '2026-08-01', 1, 10, 10, '\\x01'::bytea, NULL,          1),
                     ($1, DATE '2026-08-02', 11, 20, 10, '\\x02'::bytea, '\\x01'::bytea, 2)`,
        [TENANT],
      );
      return verifyRestore(c);
    });
    expect(check(resultados, 'cadeia-de-selo').ok).toBe(true);
  });

  it('reprova cadeia de selo rompida — e a unica prova de que a trilha nao foi adulterada', async () => {
    const resultados = await inRollbackTx(async (c) => {
      await c.query(
        `INSERT INTO audit.seal (tenant_id, seal_date, first_id, last_id,row_count,
                                 chain_hash, prev_chain_hash, snapshot_xmin)
              VALUES ($1, DATE '2026-08-01', 1, 10, 10, '\\x01'::bytea, NULL,          1),
                     ($1, DATE '2026-08-02', 11, 20, 10, '\\x02'::bytea, '\\xff'::bytea, 2)`,
        [TENANT],
      );
      return verifyRestore(c);
    });
    const cadeia = check(resultados, 'cadeia-de-selo');
    expect(cadeia.ok).toBe(false);
    expect(cadeia.detail).toContain('2026-08-02');
  });

  it('pula em silencio o que ainda nao existe nesta fase, e diz que pulou', async () => {
    const resultados = await verifyRestore(catalogPool());
    const versoes = check(resultados, 'cadeia-de-versao-clinica');
    expect(versoes.skipped).toBe(true);
    expect(versoes.detail).toContain('clin.encounter_version');
  });
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

Rodar: `pnpm test:int packages/db/src/verify-restore.int.test.ts`

Esperado: FALHA com `Failed to resolve import "./verify-restore"`.

- [ ] **Passo 3: Implementar o verificador**

Criar `packages/db/src/verify-restore.ts`:

```ts
import type { Queryable } from './queryable';

export type { Queryable };

export interface CheckResult {
  name: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

export interface VerifyRestoreOptions {
  /** Orcamento de RPO em minutos. Ausente = nao mede defasagem (uso local). */
  rpoMinutes?: number;
}

/** Os oito schemas criados pela migration 0002. `pgboss` fica de fora: fila e reconstruivel. */
const REQUIRED_SCHEMAS = ['app', 'clin', 'fin', 'tiss', 'audit', 'ref', 'rpt', 'id'];

async function relationExists(db: Queryable, relation: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>('SELECT to_regclass($1) IS NOT NULL AS existe', [relation]);
  return rows[0]?.existe === true;
}

async function schemasPresent(db: Queryable): Promise<CheckResult> {
  const { rows } = await db.query<{ nspname: string }>(
    'SELECT nspname FROM pg_namespace WHERE nspname = ANY ($1::text[])',
    [REQUIRED_SCHEMAS],
  );
  const achados = new Set(rows.map((r) => r.nspname));
  const faltando = REQUIRED_SCHEMAS.filter((s) => !achados.has(s));
  return {
    name: 'schemas-presentes',
    ok: faltando.length === 0,
    skipped: false,
    detail: faltando.length === 0 ? `${REQUIRED_SCHEMAS.length} schemas presentes` : `faltando: ${faltando.join(', ')}`,
  };
}

async function trailNotEmpty(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'audit.event'))) {
    return { name: 'trilha-nao-vazia', ok: false, skipped: true, detail: 'audit.event ausente nesta fase' };
  }
  const { rows } = await db.query<{ total: string }>('SELECT count(*)::text AS total FROM audit.event');
  const total = Number(rows[0]?.total ?? '0');
  return {
    name: 'trilha-nao-vazia',
    ok: total > 0,
    skipped: false,
    detail: `${total} evento(s) em audit.event`,
  };
}

async function sealChain(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'audit.seal'))) {
    return { name: 'cadeia-de-selo', ok: true, skipped: true, detail: 'audit.seal ausente nesta fase' };
  }
  const { rows } = await db.query<{ tenant_id: string; seal_date: string }>(
    `SELECT s.tenant_id, to_char(s.seal_date, 'YYYY-MM-DD') AS seal_date
       FROM audit.seal s
       JOIN LATERAL (
         SELECT p.chain_hash FROM audit.seal p
          WHERE p.tenant_id = s.tenant_id AND p.seal_date < s.seal_date
          ORDER BY p.seal_date DESC LIMIT 1
       ) anterior ON true
      WHERE s.prev_chain_hash IS DISTINCT FROM anterior.chain_hash
      ORDER BY 1, 2`,
  );
  return {
    name: 'cadeia-de-selo',
    ok: rows.length === 0,
    skipped: false,
    detail:
      rows.length === 0
        ? 'cadeia de selo integra'
        : `cadeia rompida em: ${rows.map((r) => `${r.tenant_id}/${r.seal_date}`).join(', ')}`,
  };
}

async function clinicalVersionChain(db: Queryable): Promise<CheckResult> {
  if (!(await relationExists(db, 'clin.encounter_version'))) {
    return {
      name: 'cadeia-de-versao-clinica',
      ok: true,
      skipped: true,
      detail: 'clin.encounter_version ausente nesta fase',
    };
  }
  const { rows } = await db.query<{ id: string; version_no: number }>(
    `SELECT v.id, v.version_no
       FROM clin.encounter_version v
       JOIN clin.encounter_version p
         ON p.encounter_id = v.encounter_id AND p.version_no = v.version_no - 1
      WHERE v.prev_hash IS DISTINCT FROM p.content_hash
      ORDER BY 1`,
  );
  return {
    name: 'cadeia-de-versao-clinica',
    ok: rows.length === 0,
    skipped: false,
    detail:
      rows.length === 0
        ? 'cadeia de hash das versoes integra'
        : `elos rompidos: ${rows.map((r) => `${r.id}#${r.version_no}`).join(', ')}`,
  };
}

async function rpoWithinBudget(db: Queryable, rpoMinutes: number | undefined): Promise<CheckResult> {
  if (rpoMinutes === undefined) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'sem orcamento de RPO declarado' };
  }
  if (!(await relationExists(db, 'audit.event'))) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'audit.event ausente nesta fase' };
  }
  const { rows } = await db.query<{ lag_minutes: string | null }>(
    `SELECT round(extract(epoch FROM (now() - max(occurred_at))) / 60)::text AS lag_minutes FROM audit.event`,
  );
  const atraso = rows[0]?.lag_minutes;
  if (atraso === null || atraso === undefined) {
    return { name: 'rpo', ok: true, skipped: true, detail: 'nenhum evento para medir defasagem' };
  }
  const minutos = Number(atraso);
  return {
    name: 'rpo',
    ok: minutos <= rpoMinutes,
    skipped: false,
    detail: `evento mais recente tem ${minutos} min (orcamento: ${rpoMinutes} min)`,
  };
}

/**
 * Restauracao so vale se for verificada. Cada check diz tres coisas: passou, foi
 * pulado (o objeto ainda nao existe nesta fase) e por que — check pulado em silencio
 * e o modo de falha que faz um ensaio inteiro passar sem verificar nada.
 */
export async function verifyRestore(db: Queryable, opts: VerifyRestoreOptions = {}): Promise<CheckResult[]> {
  return [
    await schemasPresent(db),
    await trailNotEmpty(db),
    await sealChain(db),
    await clinicalVersionChain(db),
    await rpoWithinBudget(db, opts.rpoMinutes),
  ];
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

Rodar: `pnpm test:int packages/db/src/verify-restore.int.test.ts`

Esperado: PASSA, 6 testes.

- [ ] **Passo 5: Publicar no barril do pacote**

Substituir o conteúdo de `packages/db/src/index.ts` por:

```ts
export { runMigrations, type MigrateOptions, type MigrateResult } from './migrate';
export { businessPool, auditPool, closePools } from './pool';
export { withTenantTx, preambleParams, type Actor, type TxClient } from './tx';
export type { Queryable } from './queryable';
export { runAllInvariants, type InvariantResult, type RunInvariantsOptions } from './invariants/index';
export { verifyRestore, type CheckResult, type VerifyRestoreOptions } from './verify-restore';
```

Rodar: `pnpm typecheck`

Esperado: sem saída (zero erros de tipo).

- [ ] **Passo 6: Instalar o SDK e fazer o `typecheck` enxergar `scripts/`**

```bash
pnpm add -D -w @aws-sdk/client-rds
```

Modificar `tsconfig.json` (raiz), campo `include`, acrescentando `scripts/**/*.ts`:

```json
  "include": ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts", "apps/*/src/**/*.ts", "scripts/**/*.ts", "tools/**/*.ts", "*.config.ts"]
```

Sem essa linha, `pnpm typecheck` ignora em silêncio o script do passo seguinte — e um erro de tipo no orquestrador do ensaio só apareceria no dia 1 do mês, às 06:00 UTC, sem ninguém olhando.

- [ ] **Passo 7: Escrever o orquestrador do ensaio**

Criar `scripts/restore-drill.ts`:

```ts
/**
 * pnpm restore:drill — restaura o snapshot automatico mais recente numa VPC ISOLADA,
 * roda verify-restore e os 10 invariantes, grava o relatorio e destroi a instancia.
 *
 * A VPC isolada nao e zelo: restaurar ao lado da producao coloca um endpoint quase
 * identico ao lado do verdadeiro, e o erro de digitacao escreve no banco vivo.
 *
 * O relogio aqui MEDE (performance.now) e carimba um relatorio operacional. Nada
 * disto vira dado de dominio: o carimbo persistido vem sempre do PostgreSQL.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
  RestoreDBInstanceFromDBSnapshotCommand,
  waitUntilDBInstanceAvailable,
} from '@aws-sdk/client-rds';
import { Client } from 'pg';
import { runAllInvariants, type InvariantResult } from '../packages/db/src/invariants/index';
import { verifyRestore, type CheckResult } from '../packages/db/src/verify-restore';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

const REGION = process.env.AWS_REGION ?? 'sa-east-1';
const SOURCE_INSTANCE = requireEnv('DRILL_SOURCE_DB_INSTANCE');
const SUBNET_GROUP = requireEnv('DRILL_SUBNET_GROUP');
const SECURITY_GROUP = requireEnv('DRILL_SECURITY_GROUP');
const DB_USER = requireEnv('DRILL_DB_USER');
const DB_PASSWORD = requireEnv('DRILL_DB_PASSWORD');
const RTO_BUDGET_MINUTES = Number(process.env.DRILL_RTO_BUDGET_MINUTES ?? '120');
const RPO_BUDGET_MINUTES = Number(process.env.DRILL_RPO_BUDGET_MINUTES ?? '15');

const rds = new RDSClient({ region: REGION });
const stamp = new Date().toISOString().slice(0, 10);
const target = `cadencia-restore-drill-${stamp}`;

async function latestSnapshot(): Promise<string> {
  const { DBSnapshots = [] } = await rds.send(
    new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: SOURCE_INSTANCE, SnapshotType: 'automated' }),
  );
  const maisNovo = DBSnapshots.filter((s) => s.Status === 'available').sort(
    (a, b) => (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0),
  )[0];
  if (!maisNovo?.DBSnapshotIdentifier) {
    throw new Error(`nenhum snapshot disponivel para ${SOURCE_INSTANCE}`);
  }
  return maisNovo.DBSnapshotIdentifier;
}

async function restore(snapshotId: string): Promise<string> {
  await rds.send(
    new RestoreDBInstanceFromDBSnapshotCommand({
      DBInstanceIdentifier: target,
      DBSnapshotIdentifier: snapshotId,
      DBSubnetGroupName: SUBNET_GROUP,
      VpcSecurityGroupIds: [SECURITY_GROUP],
      PubliclyAccessible: false,
      MultiAZ: false,
      DeletionProtection: false,
      Tags: [
        { Key: 'cadencia:purpose', Value: 'restore-drill' },
        { Key: 'cadencia:ephemeral', Value: 'true' },
      ],
    }),
  );

  await waitUntilDBInstanceAvailable(
    { client: rds, maxWaitTime: RTO_BUDGET_MINUTES * 60 },
    { DBInstanceIdentifier: target },
  );

  const { DBInstances = [] } = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: target }));
  const endpoint = DBInstances[0]?.Endpoint;
  if (!endpoint?.Address) throw new Error('instancia restaurada sem endpoint');
  return `postgres://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${endpoint.Address}:${endpoint.Port ?? 5432}/cadencia`;
}

async function destroy(): Promise<void> {
  await rds
    .send(
      new DeleteDBInstanceCommand({
        DBInstanceIdentifier: target,
        SkipFinalSnapshot: true,
        DeleteAutomatedBackups: true,
      }),
    )
    .catch((error: Error) => console.error(`falha ao destruir ${target}: ${error.message}`));
}

async function main(): Promise<void> {
  const inicio = performance.now();
  let checks: CheckResult[] = [];
  let invariantes: InvariantResult[] = [];
  let erro: string | undefined;

  try {
    const snapshotId = await latestSnapshot();
    console.log(`snapshot: ${snapshotId} -> instancia ${target} (VPC isolada, sem acesso publico)`);
    const url = await restore(snapshotId);

    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      checks = await verifyRestore(client, { rpoMinutes: RPO_BUDGET_MINUTES });
      // Restauracao que devolve os bytes e perde FORCE ROW LEVEL SECURITY so se
      // descobre errada no dia em que o backup for usado de verdade.
      invariantes = await runAllInvariants(client, { auditMaxLagMinutes: RPO_BUDGET_MINUTES });
    } finally {
      await client.end();
    }
  } catch (e) {
    erro = (e as Error).message;
  } finally {
    await destroy();
  }

  const minutos = Math.round((performance.now() - inicio) / 60_000);
  const rtoOk = minutos <= RTO_BUDGET_MINUTES;
  const checksReprovados = checks.filter((c) => !c.ok && !c.skipped);
  const invariantesReprovados = invariantes.filter((i) => i.violations.length > 0);

  const relatorio = {
    executadoEm: new Date().toISOString(),
    instancia: target,
    rtoMinutos: minutos,
    rtoOrcamentoMinutos: RTO_BUDGET_MINUTES,
    rtoOk,
    erro: erro ?? null,
    checks,
    invariantes,
  };

  mkdirSync(join(process.cwd(), '.artifacts'), { recursive: true });
  writeFileSync(
    join(process.cwd(), '.artifacts', `restore-drill-${stamp}.json`),
    `${JSON.stringify(relatorio, null, 2)}\n`,
  );
  console.log(JSON.stringify(relatorio, null, 2));

  if (erro || !rtoOk || checksReprovados.length > 0 || invariantesReprovados.length > 0) {
    console.error(
      `ENSAIO REPROVADO — ${erro ?? ''} ${checksReprovados.map((c) => `${c.name}: ${c.detail}`).join(' · ')} ` +
        `${invariantesReprovados.map((i) => `#${i.number} ${i.name}`).join(' · ')}`.trim(),
    );
    process.exitCode = 1;
  } else {
    console.log(`ENSAIO APROVADO em ${minutos} min`);
  }
}

await main();
```

Modificar `package.json` (raiz), bloco `"scripts"`, acrescentando a linha:

```json
    "restore:drill": "tsx scripts/restore-drill.ts"
```

- [ ] **Passo 8: Provar que o script recusa rodar sem alvo declarado**

Rodar: `pnpm restore:drill`

Esperado: FALHA imediata com `variavel de ambiente obrigatoria ausente: DRILL_SOURCE_DB_INSTANCE`. O script recusa adivinhar a instância em vez de sair procurando — adivinhar, aqui, é apontar para produção.

Rodar: `pnpm typecheck`

Esperado: sem saída.

- [ ] **Passo 9: Escrever o workflow de CI**

Criar `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '24'
  PNPM_VERSION: '10'

jobs:
  estatico:
    name: tipos, unidade, lint estrutural e grafo de modulos
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      # `pnpm test` inclui tools/arch/arch-check.test.ts, que prova que a config
      # do dependency-cruiser realmente reprova cada violacao que ela promete pegar.
      - run: pnpm test
      - name: 'lint:session-guc — `SET app.` so em packages/db/src/tx.ts'
        run: pnpm lint:session-guc
      - name: 'arch:check — setas so descem, irmao nunca importa irmao, sem ciclo'
        run: pnpm arch:check

  integracao:
    name: integracao e os 10 invariantes contra PostgreSQL 18
    runs-on: ubuntu-latest
    timeout-minutes: 25
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: cadencia
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d cadencia"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: .env do CI
        run: |
          {
            echo "DATABASE_URL_ADMIN=postgres://postgres:postgres@localhost:5433/cadencia"
            echo "DATABASE_URL=postgres://api:api@localhost:5433/cadencia"
            echo "DATABASE_URL_JOBS=postgres://jobs:jobs@localhost:5433/cadencia"
          } > .env

      - name: cluster em UTC, como o compose local
        run: psql "postgres://postgres:postgres@localhost:5433/cadencia" -v ON_ERROR_STOP=1
             -c "ALTER DATABASE cadencia SET timezone TO 'UTC'"

      - name: db:migrate — as migrations reais, em ordem
        run: pnpm db:migrate

      - name: senha para os papeis de login
        # O compose local usa `trust` e a URL nao tem senha; o service container do
        # Actions exige senha. Os papeis nascem sem senha na migration 0001.
        run: psql "postgres://postgres:postgres@localhost:5433/cadencia" -v ON_ERROR_STOP=1
             -c "ALTER ROLE api LOGIN PASSWORD 'api'; ALTER ROLE jobs LOGIN PASSWORD 'jobs'"

      - name: 'test:int — integracao contra PostgreSQL real'
        run: pnpm test:int

      - name: 'db:invariants — o runner unico dos 10 invariantes da §3.13'
        run: pnpm db:invariants --with-crud

  isolamento:
    name: isolamento multi-tenant
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # test:iso sobe o proprio PostgreSQL 18 por Testcontainers e aplica as migrations
      # reais: o canario T7 exige um banco em estado conhecido byte a byte.
      - name: 'test:iso — a suite que existe desde antes da primeira tela'
        run: pnpm test:iso

  merge-gate:
    name: pronto para merge
    runs-on: ubuntu-latest
    needs: [estatico, integracao, isolamento]
    steps:
      - run: echo "estatico, integracao com os 10 invariantes e isolamento verdes"
```

Marcar `merge-gate` como *required status check* na proteção do branch `main`. É o único job que precisa ser exigido: ele só fica verde se os três anteriores ficarem.

- [ ] **Passo 10: Escrever o workflow agendado do ensaio**

Criar `.github/workflows/agendado.yml`:

```yaml
name: agendado

on:
  schedule:
    # Ensaio de restauracao no dia 1 de cada mes, 06:00 UTC (03:00 BRT).
    - cron: '0 6 1 * *'
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

env:
  NODE_VERSION: '24'
  PNPM_VERSION: '10'

jobs:
  restore-drill:
    name: ensaio de restauracao em VPC isolada
    runs-on: ubuntu-latest
    timeout-minutes: 180
    environment: restore-drill
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_RESTORE_DRILL_ROLE_ARN }}
          aws-region: sa-east-1
      - name: 'restore:drill'
        env:
          DRILL_SOURCE_DB_INSTANCE: ${{ secrets.DRILL_SOURCE_DB_INSTANCE }}
          DRILL_SUBNET_GROUP: ${{ secrets.DRILL_SUBNET_GROUP }}
          DRILL_SECURITY_GROUP: ${{ secrets.DRILL_SECURITY_GROUP }}
          DRILL_DB_USER: ${{ secrets.DRILL_DB_USER }}
          DRILL_DB_PASSWORD: ${{ secrets.DRILL_DB_PASSWORD }}
          DRILL_RTO_BUDGET_MINUTES: '120'
          DRILL_RPO_BUDGET_MINUTES: '15'
        run: pnpm restore:drill
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: restore-drill-report
          path: .artifacts/restore-drill-*.json
          retention-days: 400
```

O relatório fica retido por 400 dias porque ele **é** a evidência de que o backup foi testado — é o que se mostra ao auditor, e é o que responde "quando foi o último ensaio" sem depender da memória de ninguém.

- [ ] **Passo 11: Rodar a verificação final e commitar**

Rodar:

```bash
pnpm typecheck
pnpm test
pnpm test:int
pnpm test:iso
pnpm arch:check
pnpm db:invariants --with-crud
```

Esperado: os seis terminam com código 0. É exatamente a sequência que o `ci.yml` executa, distribuída em três jobs.

```bash
git add packages/db/src/verify-restore.ts packages/db/src/verify-restore.int.test.ts \
        packages/db/src/index.ts scripts/restore-drill.ts \
        .github/workflows/ci.yml .github/workflows/agendado.yml \
        tsconfig.json package.json pnpm-lock.yaml
git commit -m "ci: run invariants, iso suite and arch check on every merge and drill the restore monthly"
```

---

**Estado ao fim da Parte VI.** Os 10 invariantes da §3.13 rodam a cada merge contra um PostgreSQL 18 com as migrations reais, descobrindo o schema no catálogo — tabela nova entra na verificação sozinha, sem ninguém lembrar de cadastrá-la. Os mesmos dez rodam como um comando único, `pnpm db:invariants`, contra qualquer banco: o local, o do CI e o restaurado pelo ensaio. `pnpm arch:check` guarda o DAG de módulos e entrou no `prepush`, junto com `lint:session-guc` e `test:iso`. O ensaio de restauração roda todo dia 1, em VPC isolada, verifica schemas, trilha, cadeia de selo, RPO **e os invariantes**, e deixa relatório retido por 400 dias. Entregável visível: nenhum, como a Fase 0 prevê.

---

## Definição de pronto da Fase 0

A fase só está concluída quando **todos** os comandos abaixo passam verdes, em sequência, num clone limpo do repositório.

```bash
# 0. Ambiente
cp .env.example .env
pnpm install

# 1. Tipos
pnpm typecheck                  # zero erro, sem saida

# 2. Unidade (nada aqui toca em banco)
pnpm test                       # workspace, migration-files, session-guc,
                                # time-source, kernel inteiro, authz

# 3. Banco local e schema
pnpm db:up
pnpm db:migrate                 # aplica 0001..0022; segunda execucao imprime
                                # "nenhuma migration pendente"
pnpm authz:seed                 # regenera o catalogo de acoes a partir de actions.ts

# 4. Integracao contra PostgreSQL real
pnpm test:int                   # db, audit (4 canais), authn, authz, catalogs

# 5. Isolamento multi-tenant - o gate inegociavel da Fase 0
pnpm test:iso                   # 00-bootstrap .. 08-t6, com o canario T7 verde
                                # no teardown (nenhuma mensagem "T7 CANARIO REPROVADO")

# 6. Invariantes estruturais do banco (os 10 da secao 3.13)
pnpm db:invariants              # descobertos do catalogo, nunca lista manual
pnpm db:privileges              # privilegios afirmados tabela a tabela

# 7. Lint estrutural
pnpm lint:session-guc           # exit 0
pnpm lint:terminology-clock     # exit 0
pnpm arch:check                 # setas so descem, irmao nao importa irmao, sem ciclo

# 8. O gate de pre-push
pnpm prepush
```

### Fatos que precisam ser verdadeiros

Todos já cobertos por teste no plano; listados para conferência de revisão. Cada um é um teste que **prova que a proteção pega uma violação proposital** — proteção sem esse teste é decoração.

- [ ] `pnpm test:iso` reprova quando `app.is_member()` sai da policy de `clin.patient` (Task 18).
- [ ] `pnpm test:iso` reprova quando a FK de `clin.patient_identifier` deixa de incluir `tenant_id` (Task 13).
- [ ] `pnpm test:int` reprova quando os cinco `TRUE` do preâmbulo viram `FALSE` (Task 15).
- [ ] `pnpm test:int` reprova quando o `nullif` sai de `app.current_user_id()` (Task 6).
- [ ] `pnpm test:int` reprova quando outro papel além de `jobs` ganha `BYPASSRLS` (Task 5).
- [ ] `pnpm test:int` reprova quando a policy `writer` de `audit.event` é derrubada (Task 26).
- [ ] Um evento de acesso negado **sobrevive ao rollback** da transação de negócio que falhou (Task 29).
- [ ] 50 leituras do mesmo paciente na mesma janela de 5 minutos geram **1** evento, não 50 (Task 30).
- [ ] Um lote que começa 23h58 e commita 00h03 **não** entra num dia já selado (Task 31, `snapshot_xmin`).
- [ ] Sessão opaca revogada para de funcionar na requisição seguinte (Task 34).
- [ ] Ação sem entrada no catálogo é **negada por padrão** (Task 37).
- [ ] Atendimento de 2 anos atrás resolve o código pela vigência **daquela data** (Tasks 39 e 39B).
- [ ] `pnpm lint:session-guc` reprova quando aparece `SET app.` fora de `packages/db/src/tx.ts` (Task 17).
- [ ] `pnpm arch:check` reprova quando `packages/db` importa `packages/kernel` (Task 47).
- [ ] O canário T7 fica vermelho quando qualquer linha do tenant B muda (Task 18).
- [ ] `pnpm restore:drill` restaura em VPC isolada e o `verify-restore` confere schema, trilha e cadeia de selo (Task 48).
- [ ] Entregável visível: **nenhum**. Se existir uma tela, ela não deveria estar aqui.

### O que a Fase 0 deixa pronto para a Fase 1

Nenhuma tarefa da Fase 1 precisa mexer em migration de segurança, em policy ou no formato de persistência clínica. A Fase 1 escreve **tela e regra de negócio** sobre uma fundação que já garante, por construção:

| Garantia | Onde nasce |
|---|---|
| Isolamento entre clínicas é invariante do banco, não convenção de código | RLS `FORCE` + FK composta + `app.is_member()` |
| Registro clínico não pode ser apagado nem alterado silenciosamente | `REVOKE`, escrita por `SECURITY DEFINER`, versões com cadeia de hash |
| Toda ação relevante deixa rastro que resiste a rollback e a superusuário | Canais A e B, trigger `no_mutate`, selo diário em conta separada |
| Terminologia responde pela data do atendimento, não pela de hoje | `daterange` + `EXCLUDE USING gist` + `display_snapshot` |
| Documento assinado hoje continua verificável em 20 anos | Canonicalização JCS com `canonicalVersion` congelado |
| Regressão estrutural quebra o merge, não a produção | `db:invariants`, `db:privileges`, `arch:check`, `test:iso` no pre-push |

### Próximo plano

**Fase 1 — "O dia"** (10–14 semanas): Hoje, Agenda, Pacientes, o motor de prontuário, documentos com assinatura ICP-Brasil, exportação ECF.18 e prescrição via Memed. É a primeira fase com entregável visível, e a primeira vendável sozinha — uma clínica particular de 1 a 5 médicos substitui papel, planilha e agenda de parede.

Escrever esse plano é um ciclo próprio, a partir das seções 4, 5 e 6 do documento de design.
