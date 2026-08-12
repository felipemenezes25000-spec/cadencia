/**
 * Vitest config para testes de acessibilidade (axe-core).
 *
 * Uso:
 *   pnpm test:a11y              # roda todos os testes de a11y
 *   pnpm test src/**/*.a11y.test.tsx  # rodar subset
 *
 * Incluiaxe-core em todos os testes.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    /* Só roda testes de a11y */
    include: ['src/**/*.a11y.test.ts', 'src/**/*.a11y.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
});
