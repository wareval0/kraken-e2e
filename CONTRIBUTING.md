# Contributing to Kraken

Kraken is built for long-term maintainability across a rotating group of
contributors. The rules below keep the architecture and dependency surface
sound over time. When a decision is unclear, consult
[ADR-0001](adrs/0001-general-architecture.md) — the single source of truth for
architecture decisions and their reasoning.

## Prerequisites & commands

```sh
corepack enable pnpm   # once per machine (pnpm version comes from package.json#packageManager)
pnpm install
pnpm check             # build + typecheck + test + lint — must be green before every commit
```

If `corepack` is missing (Node ≥25 no longer bundles it): `npm install -g corepack`, or install the exact pnpm version from `package.json#packageManager` directly.

Node ≥ 22.13 is required (`engine-strict` is on, so installs fail fast on older Node). Node 24 LTS is the reference development line (`.nvmrc`).

## Language

Everything in this repository — code, comments, identifiers, docs, commit messages — is written in **English**. User-authored test data inside example scenarios is exempt.

## Dependency direction rules

Violations are architecture bugs, not style issues:

```
signaling  ← nothing                    contracts  ← signaling (type-only)
core       ← contracts, signaling       gherkin    ← contracts, core
config     ← contracts                  doctor     ← contracts, config
drivers    ← contracts ONLY (peer)      reporters  ← contracts ONLY
tui        ← contracts (owns ink)       cli        ← everything (composition layer)
```

Sanctioned exceptions: drivers may take `@kraken-e2e/core/ctk` as a **devDependency** for conformance tests; a driver's optional `/steps` subpath may peer-depend on `@kraken-e2e/gherkin`. WebdriverIO/Appium types appear **only** inside `driver-*`; Ink types **only** inside `tui`; zod never appears in a public `.d.ts`.

Two clarifications so nobody "discovers" these as violations:

- The `contracts → signaling` edge is **type-only by design** (a re-export of the transport SPI, erased at runtime). It appears as a regular dependency in `package.json` so consumers can resolve the types; an import-smoke guard proves zero *runtime* imports.
- `cli ← everything` is an **upper bound**, not a checklist: drivers are never `cli` dependencies (they are devDependencies of the *user's* test project, resolved from the project root).

## The parity gate

The common session surface (`UserSession`) grows **only** through a change that contains all three of:

1. a short note on the operation and why it must be portable,
2. a Conformance Test Kit (CTK) case for it,
3. passing implementations in **both** `driver-android` and `driver-ios`.

Parity is a generated artifact, not a claim: the CTK emits `parity-report.json` per driver. The pass criterion is **zero `failing` entries and an empty diff between the Android and iOS supported-op sets**. Symmetric `unsupported(reason)` entries are allowed; an asymmetric one blocks the change unless explicitly signed off in the report artifact. This is machine-checked in `pnpm check`.

## Keeping dependencies current

The mobile stack breaks by design on a roughly annual cadence, so dependencies are reviewed on a regular schedule rather than left to drift. Once per quarter:

1. Check the watch list: WebdriverIO majors, Appium and both mobile drivers, the `@cucumber/*` lockstep (gherkin/expressions/messages/tag-expressions bump together), TypeScript, Vitest, Biome, Ink, oclif, Changesets, the Node LTS calendar, and the Xcode support window (xcuitest supports the latest two Xcode majors only).
2. Bump shared versions in `pnpm-workspace.yaml` → `catalog:` (one line per dependency), and package-local pins where applicable.
3. Run `pnpm check`; for driver-affecting bumps also run the driver smoke scenarios on the dev machine.
4. Record notable bumps in a changeset; note anything deferred and why.

## Versioning & releases

Every user-visible change lands with a changeset: `pnpm changeset`. Packages are versioned in lockstep. Publishing to npm is a deliberate, human-approved step.

## ADR process

Any non-trivial design decision gets an ADR in `adrs/` (`NNNN-title.md`, English, template in `adrs/template.md`): context, options considered, decision, consequences. Deviations from an accepted ADR are never silent — they get a new ADR (or a ratified amendment) that names what it supersedes.

## Output discipline

Never write to `process.stdout` directly from library or driver code — drivers receive a `Logger`; child-process stdio is always piped, never inherited. `console.*` is a lint error inside `packages/driver-*`. The terminal UI owns the terminal.
