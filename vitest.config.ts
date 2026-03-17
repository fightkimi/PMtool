import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/agents/**', 'src/adapters/**', 'src/lib/**'],
      exclude: [
        'src/__tests__/**',
        'src/app/**',
        'src/workers/**',
        'src/adapters/types.ts',
        'src/agents/base/types.ts',
        'src/lib/db.ts',
        'src/lib/schema/**',
        '**/*.d.ts'
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 75,
        lines: 70
      }
    }
  }
});
