import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
});
