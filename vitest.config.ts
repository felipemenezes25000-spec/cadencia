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
