import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // Centenas de arquivos jsdom em paralelo saturam memoria/CPU e fazem testes
    // de axe estourarem o timeout sem falha funcional. Quatro workers mantem a
    // suite paralela, mas evita a tempestade de forks observada no Windows e CI.
    maxWorkers: 4,
  },
});
