# Your first project

A Kraken project is an ordinary npm package containing three things: a `kraken.config.ts` declaring the actor cast and drivers, a `features/` directory of Gherkin scenarios, and a `steps/` directory with the project's step vocabulary. `kraken init` scaffolds all of it.

## Scaffolding with `kraken init`

Run the command in the directory that holds (or will hold) your test project:

```bash
npx kraken init
```

```text
created: kraken.config.ts
created: steps/index.ts
created: features/example.feature
created: .vscode/settings.json

Next steps:
  1. kraken plugins install @kraken-e2e/driver-android   (and/or -ios, -web)
  2. write steps in steps/index.ts and scenarios in features/
  3. kraken doctor    (verify your environment)
  4. kraken run
```

`kraken init` never overwrites an existing file — a file that is already present is reported as `skip (exists): <path>` and left untouched, so the command is safe to run inside an existing repository.

### `kraken.config.ts`

```ts
import { defineConfig } from '@kraken-e2e/config';

export default defineConfig({
  actors: {
    // The CLOSED actor set: steps naming anyone else are compile errors.
    alice: { platform: 'android' },
    bob: { platform: 'ios' },
  },
  drivers: [
    // Install drivers with: kraken plugins install @kraken-e2e/driver-android
  ],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
```

The `actors` map is the *closed cast* of the suite: a feature step that addresses an undeclared actor is rejected at compilation time, before any session boots. `defineConfig` is an identity function that anchors the config type, so the editor autocompletes every field without additional setup.

### `steps/index.ts`

```ts
import { createStepRegistry } from '@kraken-e2e/gherkin';

// Destructure — bare Given/When/Then call sites are what the Cucumber VS Code
// extension indexes (namespaced calls lose autocomplete).
export const { Given, When, Then, defineParameterType, registry } = createStepRegistry();

// Your app-domain steps live here. Example:
// When('{actor} sends the message {string}', async ({ actor }, ...args) => {
//   const [message] = args as unknown as [string];
//   await actor.session.typeText({ by: 'testId', value: 'composer' }, message);
//   await actor.session.tap({ by: 'testId', value: 'send' });
// });
```

This module is the project's step registry. Kraken ships only choreography steps (signal waits and background-task joins); every app-domain step belongs to the project. The `registry` export is what `kraken run` loads — the destructured, bare `Given`/`When`/`Then` shape is deliberate, because the Cucumber VS Code extension only indexes literal call sites.

### `features/example.feature`

```gherkin
Feature: My first choreography
  Steps run in text order (the screenplay); signals and background tasks are
  the escape hatches. See the Kraken docs for the built-in vocabulary.

  Scenario: two users, one story
    # When alice sends the message "hola"
    # Then bob waits for the signal "message-sent" within 10s
```

### `.vscode/settings.json`

```json
{
  "cucumber.features": [
    "features/**/*.feature"
  ],
  "cucumber.glue": [
    "steps/**/*.ts"
  ],
  "cucumber.parameterTypes": [
    {
      "name": "actor",
      "regexp": "[a-zA-Z][a-zA-Z0-9_-]*|\"[^\"]+\""
    },
    {
      "name": "duration",
      "regexp": "\\d+(?:\\.\\d+)?(?:ms|s|m)"
    }
  ]
}
```

Kraken defines two custom Cucumber parameter types — `{actor}` (a bare name like `alice`, or a quoted alias like `"the moderator"`) and `{duration}` (`500ms`, `10s`, `2m`, converted to milliseconds). The VS Code Cucumber extension cannot see parameter types defined inside `node_modules`, so `kraken init` writes them into the workspace settings; the regular expressions are kept byte-identical to the runtime matchers in `@kraken-e2e/gherkin`, and a test in the repository pins that equality.

## Installing a driver: `kraken plugins install`

Drivers are ordinary npm packages installed per project — never into a per-user global state. `kraken plugins install` wraps the installation with validation and config registration:

```bash
npx kraken plugins install @kraken-e2e/driver-android
```

```text
Installing @kraken-e2e/driver-android with npm (exact-pinned devDependency)…
(…package manager output…)
✓ registered '@kraken-e2e/driver-android' in /Users/dev/messaging-e2e/kraken.config.ts.
  next: Install the Android SDK and set ANDROID_HOME
  next: Install a JDK (17+) and set JAVA_HOME
  next: Create an arm64-v8a AVD at API 26+ (on Apple Silicon) or connect a device
  next: Run: kraken doctor
```

The command runs the following pipeline, in order:

1. **Package-name validation.** The argument must match the npm package-name grammar. Anything else — in particular a string starting with `-`, which a package manager would parse as a flag — is rejected before any process is spawned.
2. **Project location.** Kraken searches upward from the current directory for `kraken.config.{ts,mts,js,mjs}`; the config's directory becomes the project root. Without a config, a `package.json` in the current directory is accepted. Without either, the command fails and suggests `kraken init` — there is no silent global install.
3. **Package-manager detection and exact-pin install.** The project's own package manager is detected from its lockfile — `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, otherwise npm — and invoked with the exact-pin arguments so the driver version lands verbatim in the lockfile:

   | Package manager | Invocation |
   |---|---|
   | pnpm | `pnpm add -D -E <package>` |
   | npm | `npm install --save-dev --save-exact <package>` |
   | yarn | `yarn add --dev --exact <package>` |

4. **Manifest pre-validation.** The package's `/manifest` subpath is imported *first* — never the main entry, which on an unsupported host may legitimately fail to load. The manifest must exist (as the default or a named `manifest` export), and its declared plugin-contract version must be compatible with the contract version this Kraken supports; a mismatch aborts with both versions printed.
5. **Advisory host gate.** Installation is deliberately cross-platform; only loading and running are host-gated. If the manifest's host requirements are not met, the command prints, for example:

   ```text
   ! iOS (XCUITest via Appium 3) is DISABLED on this host: requires host platform darwin, but this host is linux/x64.
     Installed and lockfile-pinned anyway (your teammates on supported hosts get it).
   ```

   On a supported host, the full validation proceeds: the main entry is imported and its default export must be a `defineDriver()` factory. If that fails, the command exits with status 1 but leaves the package installed, so it can be fixed or removed with the package manager.
6. **Config registration.** If the package name already appears in `kraken.config.ts`, that is confirmed. Otherwise Kraken appends the string form right after the `drivers: [` marker — comment-aware, so a commented-out example line never swallows the insertion:

   ```ts
   drivers: [
     '@kraken-e2e/driver-android',
     // Install drivers with: kraken plugins install @kraken-e2e/driver-android
   ],
   ```

   When no such marker exists, Kraken prints the exact lines to add instead of rewriting user code; when no config exists at all, it suggests creating one with `kraken init`.
7. **Setup hints.** Finally, the driver's manifest-declared setup hints are printed as `next:` lines — the transcripts above show the Android set; the iOS driver hints at installing Xcode and a simulator runtime, and the web driver at installing a browser. Every driver's last hint is `Run: kraken doctor`.

The flag `--skip-install` skips step 3 and only validates and registers a package that is already installed — useful after a manual install. The oclif colon form `kraken plugins:install …` is equivalent to the spaced form.

::: tip One lockfile for a mixed team
The iOS driver package installs on any operating system — it never sets npm's `os` restriction — so a single lockfile serves a team of macOS and Linux machines. On hosts that cannot run it, the driver disables itself at load time with an explicit message, and doctor reports it as `unavailable-on-host`.
:::

## Anatomy of a project

```text
messaging-e2e/
├── kraken.config.ts        # actors, drivers, feature globs, steps module
├── features/
│   └── example.feature     # Gherkin scenarios (the screenplay)
├── steps/
│   └── index.ts            # the step registry (app-domain vocabulary)
├── .vscode/
│   └── settings.json       # Cucumber extension wiring ({actor}/{duration})
├── package.json            # @kraken-e2e/cli + drivers as exact-pinned devDependencies
└── .kraken/
    └── runs/<run-id>/      # per-run artifacts (event log, reports) — created by kraken run
```

Configuration is resolved from `kraken.config.{ts,mts,js,mjs}`, searched upward from the working directory; the directory containing the config file is the *project root*, the anchor against which everything else resolves. TypeScript configs and steps need no build step — they are loaded through jiti at run time. The config fields:

| Field | Required | Meaning |
|---|---|---|
| `actors` | yes (at least one) | The closed cast: a map of actor name → `{ platform, …driverOptions }`. Everything besides `platform` is passed through to the driver when the actor's session is created. |
| `drivers` | yes | Driver registrations: a package-name string (what `kraken plugins install` appends), a `[packageName, options]` tuple, or a typed driver factory value imported into the config. |
| `features` | no | Feature-file glob or array of globs, relative to the project root. |
| `steps` | no | Path to the module exporting the step `registry` (default `./steps/index.ts`). |
| `defaults.assertionTimeoutMs` | no | The one sanctioned config default: the time budget for polling assertions. |

See [Configuration](/guide/configuration) for the full treatment. Next: write and run a real multi-actor scenario — with no devices required — in [Your first scenario](/getting-started/first-scenario).
