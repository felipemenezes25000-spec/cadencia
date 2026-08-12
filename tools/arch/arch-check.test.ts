import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STUB = 'export const nada = null;\n';
const TIMEOUT = 120_000;

function archCheck(): { code: number; output: string } {
  try {
    // `shell` no Windows porque o executável é `pnpm.cmd`: sem ele o spawn falha com
    // ENOENT antes de rodar o depcruise, e o teste nunca veria a saída que afirma.
    const output = execFileSync('pnpm', ['arch:check'], {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/**
 * Cria TODOS os arquivos de uma vez: o importador e o alvo. Sem o alvo, o import não
 * resolve e o depcruise reprova por `sem-import-nao-resolvido` — o teste passaria sem
 * nunca exercitar a regra de camada, que é o que ele existe para verificar.
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
