import { defineConfig } from 'vitest/config';

// Root-level projects config (ADR-0001 §5.2): lets `pnpm exec vitest` and the
// VS Code Vitest extension see every package's tests at once. Turborepo still
// runs `vitest run` per package for caching. Coverage thresholds are enforced
// per package starting in Phase 1 (ADR-0001 §5.16), when real logic exists.
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
