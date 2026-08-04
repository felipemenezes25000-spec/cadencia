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
