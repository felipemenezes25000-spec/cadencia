import { defineConfig } from 'vitest/config';
import { buildWorkspaceAlias } from './tools/test/workspace-alias';

export default defineConfig({
  resolve: { alias: buildWorkspaceAlias() },
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
