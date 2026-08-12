import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Um alias por pacote do workspace. O `paths` do tsconfig resolve o TIPO;
// isto resolve o MÓDULO em tempo de teste. Os dois precisam existir: sem este
// alias, o primeiro import de irmão quebra com "Failed to resolve import".
// Também gera aliases para subpath exports declarados em package.json
// (ex: "@cadencia/reports/test-support" → ".../src/test-support.ts").
export function buildWorkspaceAlias(): Record<string, string> {
  const entries: [string, string][] = [];
  const dirs = existsSync('packages') ? readdirSync('packages', { withFileTypes: true }) : [];

  // Subpath exports precisam vir ANTES do alias principal para que Vite
  // resolva "@cadencia/reports/test-support" antes de "@cadencia/reports"
  // (o alias é prefix-match; mais específico primeiro).
  const mainAliases: [string, string][] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const pkgName = `@cadencia/${dir.name}`;
    const pkgDir = resolve('packages', dir.name);

    // Subpath exports do package.json (inseridos primeiro)
    const pkgJsonPath = resolve(pkgDir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.exports && typeof pkgJson.exports === 'object') {
          for (const [subpath, target] of Object.entries(pkgJson.exports)) {
            if (subpath === '.') continue;
            if (typeof target === 'string') {
              const importPath = `${pkgName}/${subpath.replace(/^\.\//, '')}`;
              entries.push([importPath, resolve(pkgDir, target)]);
            }
          }
        }
      } catch { /* ignora erros de parse */ }
    }

    // Alias principal: @cadencia/<pkg> → packages/<pkg>/src/index.ts (depois)
    mainAliases.push([pkgName, resolve(pkgDir, 'src', 'index.ts')]);
  }

  entries.push(...mainAliases);

  return Object.fromEntries(entries);
}
