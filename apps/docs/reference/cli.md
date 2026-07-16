# CLI reference

The `kraken` binary is provided by `@kraken-e2e/cli`. Every command is listed below with its complete flag set. Commands that operate on a project locate `kraken.config.ts` by walking upward from the working directory.

## `kraken run`

Compiles the project's features against the configured cast, boots one session per actor, executes the screenplay and writes the run artifacts.

```bash
npx kraken run
npx kraken run --config kraken.trio.config.ts --tags "@smoke and not @wip"
npx kraken run --dry-run
```

| Flag | Type | Default | Effect |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Use a specific configuration file. Multiple configuration files per project are a supported pattern (platform matrices, suite selection). |
| `-t, --tags <expr>` | string | — | Cucumber tag expression filtering which scenarios run, e.g. `"@smoke and not @wip"`. |
| `--dry-run` | boolean | `false` | Compile and statically analyze only — unmatched steps (with closest-expression suggestions), unknown actors, duplicate background-task handles and signal deadlocks are reported; no session boots. |
| `--plain` | boolean | `false` | Force the plain line renderer. Without it, a TTY outside CI gets the live per-actor lane view. |

The process exits with the run's status code: `0` when every scenario passed, `1` otherwise. Each run writes `.kraken/runs/<runId>/` containing the event log, Allure results and the CTRF report — see [Reports](/guide/reports).

## `kraken doctor`

Diagnoses the environment: host checks, per-driver gate status, and the toolchain checks contributed by every ready driver. Each finding carries an actionable fix. See [Environment diagnosis](/guide/doctor).

```bash
npx kraken doctor
npx kraken doctor --json > environment.json
```

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--json` | boolean | `false` | Emit the full report as JSON — a reproducible snapshot of the machine's readiness. |
| `--cwd <dir>` | string | current directory | Diagnose a project located elsewhere. |

Exits `1` when any check fails (text mode).

## `kraken devices`

Enumerates every automation target the configured drivers can see on this host — booted simulators, running emulators, connected devices, installed browsers — each with a ready-to-paste actor configuration. See [Devices](/guide/devices).

```bash
npx kraken devices
npx kraken devices --json
```

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--json` | boolean | `false` | Emit the target list as JSON. |
| `--cwd <dir>` | string | current directory | Inspect a project located elsewhere. |

Targets marked `running` can be reused as-is (their configuration pins the exact device by identifier — nothing boots); `available` targets are provisioned on demand.

## `kraken inspect`

Mirrors an actor's live screen in the browser; clicking an element returns its identifier, ranked locators and a ready-to-paste Screen Object method. See [The inspector](/guide/inspect).

```bash
npx kraken inspect alice
npx kraken inspect bob --port 4600
```

| Argument / flag | Type | Default | Effect |
|---|---|---|---|
| `actor` (argument, required) | string | — | The configured actor whose session to inspect. |
| `-c, --config <path>` | string | auto-discovered | Use a specific configuration file. |
| `--port <n>` | integer | `0` (OS-assigned) | Inspector port. |
| `--host <addr>` | string | `127.0.0.1` | Bind address. |

Runs until interrupted (Ctrl-C), then disposes the session and stops the driver.

## `kraken serve`

Serves the project's run history over HTTP and WebSocket, including a built-in viewer and a machine-consumable API. Reads only the on-disk run directory; works for finished and in-flight runs alike. See [Serving results](/guide/serve).

```bash
npx kraken serve
npx kraken serve --port 4000 --host 0.0.0.0
```

| Flag | Type | Default | Effect |
|---|---|---|---|
| `--port <n>` | integer | `0` (OS-assigned) | Listening port. |
| `--host <addr>` | string | `127.0.0.1` | Bind address. The default is loopback-only; widening it is an explicit decision. |

The server runs until interrupted (Ctrl-C) and shuts down cleanly.

## `kraken init`

Scaffolds a new test project in the current directory: `kraken.config.ts` with a commented actor cast, a `steps/` module wired to the step registry, an example feature, and the VS Code Cucumber settings that make `{actor}` and `{duration}` autocomplete in the editor. Existing files are never overwritten.

```bash
npx kraken init
```

No flags.

## `kraken plugins install`

Installs a driver package as an exact-pinned development dependency of the project and registers it in `kraken.config.ts`. The colon form `plugins:install` is equivalent.

```bash
npx kraken plugins install @kraken-e2e/driver-android
```

| Argument / flag | Type | Effect |
|---|---|---|
| `package` (argument, required) | string | The driver package name. Validated against the npm name grammar before any package manager is invoked. |
| `--skip-install` | boolean | Validate and register an already-installed package without running the package manager. |

The pipeline: locate the project (never a silent global install), install through the project's own package manager (detected from the lockfile; always exact-pinned), validate the driver's manifest **before** importing its implementation, check plugin-contract compatibility, apply an advisory host gate (a macOS-only driver installs fine on Linux, with a notice, so mixed teams share one lockfile), register the package in the configuration's `drivers` array when that edit is mechanically safe, and print the driver's setup hints. Exits `1` when validation fails; the package is left installed for inspection.

## Global behavior

- `--help` on any command prints usage; `--version` prints the CLI version, platform and Node version.
- Commands never write outside the project directory except for the artifacts they document (`.kraken/` inside the project).
- The CLI owns process signals: interrupting a run tears sessions down before exiting.
