import { defineConfig } from 'vitest/config';

// Coverage thresholds per ADR-0001 §5.16: the engine packages hold >=90% lines.
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary'],
      thresholds: { lines: 90 },
    },
  },
});
