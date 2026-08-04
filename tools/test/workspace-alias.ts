import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Um alias por pacote do workspace. O `paths` do tsconfig resolve o TIPO;
// isto resolve o MODULO em tempo de teste. Os dois precisam existir: sem este
// alias, o primeiro import de irmao quebra com "Failed to resolve import".
export function buildWorkspaceAlias(): Record<string, string> {
  return Object.fromEntries(
    (existsSync('packages') ? readdirSync('packages', { withFileTypes: true }) : [])
      .filter((entry) => entry.isDirectory())
      .map((entry) => [`@cadencia/${entry.name}`, resolve('packages', entry.name, 'src', 'index.ts')]),
  );
}
