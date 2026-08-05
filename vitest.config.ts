import { defineConfig } from 'vitest/config';
import { buildWorkspaceAlias } from './tools/test/workspace-alias.ts';

export default defineConfig({
  resolve: { alias: buildWorkspaceAlias() },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts', '**/*.iso.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
  },
});
