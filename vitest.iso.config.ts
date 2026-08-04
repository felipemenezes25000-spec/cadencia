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
