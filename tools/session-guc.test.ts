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
