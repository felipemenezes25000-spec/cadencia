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
