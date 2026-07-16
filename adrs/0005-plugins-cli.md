# ADR-0005: Driver Plugin / CLI Architecture

| | |
|---|---|
| **Status** | **Accepted** (2026-07-04) — implemented and live-validated (plugins install pre-gate caught a real design bug; deterministic run exit) |
| **Date** | 2026-07-04 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.10/D15 and §5.11 (ratified 2026-07-02) |
| **Relates to** | ADR-0001 §5.10 (drivers as project devDependencies), D15 (Kraken-owned plugins topic), §5.11 (renderer selection), ADR-0004 Appendix B (editor settings) |

## Context

ADR-0001 fixed the model: drivers are exact-pinned project devDependencies (the lockfile is the single version source), `kraken plugins:install` is a real Kraken-owned command, and `@oclif/plugin-plugins` is not shipped. This ADR records the implemented mechanics.

## Decisions

### D1 — `kraken plugins install <pkg>` pipeline

1. **Locate the project**: walk up for `kraken.config.*`, else accept a `package.json` root; outside any project → hard error hinting `kraken init` (never a silent global install).
2. **Install via the project's own package manager**, sniffed from the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm), always exact-pinned dev (`pnpm add -D -E`). Kraken never vendors npm.
3. **Pre-gate via `/manifest` BEFORE importing the main entry** — the same §5.5 rule the registry follows. This is not theoretical: the test fixture whose entry throws on import caught the first implementation importing too early. Contract compatibility is checked from the manifest.
4. **Advisory host gate**: a darwin-only driver installs fine on Linux with a warning ("installed and lockfile-pinned anyway — your macOS teammates get it; DISABLED on this host"), exit 0. The hard block lives at load/run (§5.5). Driver packages never set npm's `"os"` field.
5. **Full brand validation** (default export is a `defineDriver()` factory) only when the host gate passes — the entry is importable there by the import-safety rule.
6. **Config registration**: append the string form into a `drivers: [` array when mechanically unambiguous; otherwise print the exact lines. Idempotent (detects existing registrations). Never blind-rewrites user code.
7. **Epilogue**: the manifest's `setupHints`.

Both `kraken plugins install` and `kraken plugins:install` work (`topicSeparator: ' '`; colons stay aliases). `@oclif/plugin-plugins` remains excluded; if genuine CLI-extension plugins are ever wanted, oclif's command-priority rules allow adding it later under a different topic.

### D2 — `kraken init`

Scaffolds a runnable skeleton: `kraken.config.ts` (closed actor set + drivers array ready for `plugins install`), `steps/index.ts` (destructured `createStepRegistry()` — the bare-identifier shape the Cucumber VS Code extension indexes), `features/example.feature`, and `.vscode/settings.json` with `cucumber.parameterTypes` for `{actor}`/`{duration}`. **The editor regexps are kept byte-identical to the runtime `ACTOR_REGEXP`/`DURATION_REGEXP` sources and a test pins the equality** (ADR-0004 Appendix B's invariant). Never overwrites existing files.

### D3 — Renderer selection (§5.11, implemented)

`kraken run` uses the Ink lane view when `stdout.isTTY && !CI && !--plain`, else the plain LineReporter; `@kraken/tui` is imported dynamically only in the live branch (CI paths never load ink). The spike resolved POSITIVE: ink-testing-library@4 works under Ink 7.1 + React 19.2 + Vitest, guarded by a permanent test. The TUI consumes ONLY the event stream (a pure reducer — the property the future GUI relies on) and runs with `patchConsole: true`, `exitOnCtrlC: false`.

## Consequences

- `plugins list` / `uninstall` and deep SIGINT integration tests (Ctrl-C mid-run on real devices) remain M1-scope-permitting; the SIGINT design (CLI owns signals; appium's exit(0) handlers stripped at the driver layer) is already in place.
- `kraken run` exits EXPLICITLY with the run's code (observed live: embedded Appium/WDIO keep-alive handles kept the process from draining after a successful run — a hang the user caught watching the devices).
- The config-append codemod is deliberately dumb (regex on `drivers: [`); anything fancier waits for evidence it's needed.
