import { defineConfig } from 'vitest/config';

// Package-local config: keeps per-package `vitest run` (Turborepo-cached)
// scoped to this package, and serves as the project entry for the root
// `projects` config. Package-specific test options go here.
export default defineConfig({
  test: {},
});
