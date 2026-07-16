---
"@kraken-e2e/config": minor
---

Kraken now loads a project `.env` (and `.env.local`) automatically before
evaluating `kraken.config.ts`, so credentials and per-environment values can
live in an untracked file instead of the config or the shell. Precedence is
real environment variables > `.env.local` > `.env` (the files only fill unset
keys), and the exported `loadEnvFiles(projectRoot)` helper is available for
programmatic use. Keep `.env` files out of version control.
