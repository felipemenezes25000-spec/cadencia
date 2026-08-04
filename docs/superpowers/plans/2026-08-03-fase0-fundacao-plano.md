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
                                # time-source, kernel inteiro

# 3. Banco local e schema
pnpm db:up
pnpm db:migrate                 # aplica 0001..0010; segunda execucao imprime
                                # "nenhuma migration pendente"

# 4. Integracao contra PostgreSQL real
pnpm test:int                   # compose, migrate, roles, roles-invariants,
                                # transaction-context, pool, tx, audit (3 arquivos)

# 5. Isolamento multi-tenant — o gate inegociavel da Fase 0
pnpm test:iso                   # 00-bootstrap .. 08-t6, com o canario T7 verde
                                # no teardown (nenhuma mensagem "T7 CANARIO REPROVADO")

# 6. Lint estrutural
pnpm lint:session-guc           # exit 0

# 7. O gate de pre-push, que roda 6 e 5 juntos
pnpm prepush
```

Além dos comandos, estes fatos precisam ser verdadeiros — todos já cobertos por teste acima, listados aqui para conferência de revisão:

- [ ] `pnpm test:iso` reprova quando `app.is_member()` sai da policy de `clin.patient` (Task 18, Passo 3).
- [ ] `pnpm test:iso` reprova quando a FK de `clin.patient_identifier` deixa de incluir `tenant_id` (Task 13, Passo 3).
- [ ] `pnpm test:int` reprova quando os cinco `TRUE` do preâmbulo viram `FALSE` (Task 15, Passo 5).
- [ ] `pnpm test:int` reprova quando o `nullif` sai de `app.current_user_id()` (Task 6, Passo 7).
- [ ] `pnpm test:int` reprova quando outro papel além de `jobs` ganha `BYPASSRLS` (Task 5, Passo 3).
- [ ] `pnpm test:int` reprova quando a policy `writer` de `audit.event` é derrubada (Task 26, Passo 1).
- [ ] `pnpm lint:session-guc` reprova quando aparece `SET app.` fora de `packages/db/src/tx.ts` (Task 17, Passo 7).
- [ ] O canário T7 fica vermelho quando qualquer linha do tenant B muda (Task 18, Passo 7).
- [ ] Entregável visível: **nenhum**. Se existir uma tela, ela não deveria estar aqui.

### Comandos do Apêndice B que ainda não existem ao final destas 27 tarefas

Estes fazem parte da Fase 0 pela §8 e pertencem às faixas de tarefas que **não** chegaram no material de origem (ver a seção seguinte). Enquanto não existirem, nenhum passo deste plano os invoca — e é por isso que `prepush` está definido como `pnpm lint:session-guc && pnpm test:iso`, e não com `pnpm arch:check` na frente:

| Comando | Do que depende |
|---|---|
| `pnpm dev` | apps `web`/`api`/`worker` com providers fake |
| `pnpm authz:seed` | módulo `authz` (catálogo de ações com fonte única) |
| `pnpm arch:check` | pipeline de CI (dependency-cruiser: camadas, ciclos, imports entre irmãos) |
| `pnpm test:perf` | pipeline de CI (k6 + Lighthouse) |
| `pnpm restore:drill` | ensaio mensal de restauração em VPC isolada |
| `pnpm audit:export --tenant <id> --from ... --to ... --format xml` | exportação NGS1.07.08, que depende do restante do módulo `audit` |

---

## Estado do material de origem (leia antes de considerar o plano completo)

Este documento consolida **quatro** das seis faixas de tarefas revisadas. O que segue é factual e precisa ser resolvido antes de a Fase 0 ser dada como planejada:

1. **Chegou e está aqui, com todas as correções dos verificadores aplicadas:** scaffold + kernel (originalmente Tasks 1–8), papéis/harness/`db` (originalmente Tasks 9–15), tabelas núcleo + RLS + `test:iso` (originalmente Tasks 16–24) e as três primeiras tarefas da trilha de auditoria (originalmente Tasks 25–27).
2. **Chegou truncado:** a faixa da trilha de auditoria terminava na Task 31. O material foi cortado no meio da Task 28 (canal A — `audit.log`, `packages/audit/src/domain.ts`). As Tasks 28 a 31 — canal A (`audit.log`), canal B (`audit.log_security` + `SecurityAuditChannel` com buffer em disco), auditoria de leitura (`audit.log_read` + `audit.read_dedup`) e o selo diário (`audit.seal`, `audit.seal_run`, `audit.seal_day`, `audit.seal_watchdog`) — **não** puderam ser escritas sem inventar SQL e assinaturas. As migrations `0011` a `0014` estão reservadas para elas.
3. **Não chegou:** duas faixas inteiras, que pela §8 cobrem `authn` (sessão opaca, Argon2id, TOTP, SameSite+CSRF), `authz` (catálogo de ações com fonte única), `identity`/`tenancy`/`people`/`patients`/`catalogs` (CID-10 e TUSS já versionada por data), o pipeline com os 10 invariantes de CI e o `restore:drill`.

As 27 tarefas deste documento são executáveis de ponta a ponta e deixam o repositório verde nos sete comandos da definição de pronto acima. Elas **não** encerram a Fase 0: falta o que está nos itens 2 e 3.
