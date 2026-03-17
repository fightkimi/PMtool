import { afterEach, beforeEach, vi } from 'vitest';

const isIntegrationRun = process.argv.some((arg) => arg.includes('src/__tests__/integration/'));

if (!isIntegrationRun) {
  vi.mock('@/lib/db', () => ({
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});
