# Configuration reference

Exhaustive reference for `kraken.config.ts`: every field, its type, its default, and the layer that consumes it. For a narrative walkthrough, see the [configuration guide](/guide/configuration).

All types are exported by `@kraken-e2e/config` (`defineConfig`, `KrakenConfig`, `ResolvedKrakenConfig`, `ActorConfig`, `DriverRegistrationInput`) except the driver option interfaces, which are exported by their driver packages (`AndroidDriverOptions`, `IosDriverOptions`, `WebDriverOptions`).

## File discovery

Discovery walks **up** from the starting directory to the filesystem root. In each directory, the basenames are tried in this exact order; the first existing file wins:

| Order | Basename |
|---|---|
| 1 | `kraken.config.ts` |
| 2 | `kraken.config.mts` |
| 3 | `kraken.config.js` |
| 4 | `kraken.config.mjs` |

| Command | Starting directory | Explicit override |
|---|---|---|
| `kraken run` | current working directory | `--config <path>` / `-c <path>` (absolute, or relative to the current working directory) |
| `kraken doctor` | `--cwd <dir>`, default current directory | — (config optional: without one, the report covers the host only) |
| `kraken devices` | `--cwd <dir>`, default current directory | — (config required: drivers come from it) |
| `kraken plugins install` | current working directory | — (falls back to the nearest `package.json` if no config exists yet) |
| `kraken serve` | current working directory | — (uses discovery only to locate `.kraken/runs/`) |

No config found where one is required → `KRK-CONFIG-NOT-FOUND`.

## Loading pipeline

| Stage | Behavior | Failure |
|---|---|---|
| Locate | Walk-up discovery, or the `--config` path | `KRK-CONFIG-NOT-FOUND` |
| Execute | jiti runs the file directly — TypeScript, ESM, top-level `await`; no build step | `KRK-CONFIG-INVALID` (wraps the thrown error) |
| Pick export | `default` export if present, otherwise the module namespace itself | — |
| Validate | Structural schema check (see below) plus a non-empty `actors` check | `KRK-CONFIG-INVALID`, listing each field path and message |
| Resolve | Normalize `features` to an array (defaulting it), stamp `projectRoot` and `configPath` | — |

Unknown top-level keys are accepted and ignored. Actor entries are validated only for the `platform` key; every other actor key passes through unvalidated to the owning driver.

## `KrakenConfig` — top-level fields

| Field | Type | Required | Default | Consumed by |
|---|---|---|---|---|
| `actors` | `Record<string, ActorConfig>` | yes (min. one entry) | — | `@kraken-e2e/gherkin` dry-run compiler (closed-cast analysis); `@kraken-e2e/core` runner (platform → driver binding); the bound driver (`createSession`) |
| `drivers` | `DriverRegistrationInput[]` | yes (may be empty; running then requires zero bound platforms) | — | `@kraken-e2e/core` `DriverRegistry` (load, validate, version-check, host-gate) |
| `features` | `string \| string[]` | no | `'features/**/*.feature'` | `@kraken-e2e/cli` run pipeline (tinyglobby, relative to project root) |
| `steps` | `string` | no | `'./steps/index.ts'` | `@kraken-e2e/cli` run pipeline (jiti import; brand-checks the `registry` export) |
| `defaults` | `{ assertionTimeoutMs?: number }` | no | — | `@kraken-e2e/config` (validation); the project-wide polling-assertion timeout budget |

### `defaults`

| Field | Type | Constraint | Semantics |
|---|---|---|---|
| `assertionTimeoutMs` | `number` | positive | The single sanctioned project-wide default: the timeout budget for polling assertions, which are bound by application latency. Signal waits and background-task joins always carry their duration in the step text and never read this value. |

## `ActorConfig`

| Field | Type | Required | Semantics |
|---|---|---|---|
| `platform` | `string` (non-empty) | yes | Matched against the `platforms` array of each registered driver's manifest. Official drivers claim `android`, `ios`, `web`; custom drivers may claim any identifier. First registered driver claiming the platform wins |
| *(any other key)* | `unknown` | no | Passed verbatim to the owning driver's `createSession` as `actor.config` (the `platform` key is stripped first) |

## `DriverRegistrationInput` — the `drivers` array

| Form | Type | Options handling | Loading semantics |
|---|---|---|---|
| Value | `KrakenDriver` (result of calling a `defineDriver()` factory) | passed to the factory at the call site | Brand-checked, manifest-validated, contract-version-checked, host-gated |
| String | `string` (npm package name) | factory invoked with `undefined` | `<pkg>/manifest` is resolved from the project root and imported **before** the main entry; the manifest is validated and host-gated first, so an unsupported host never imports the heavy entry. Then the main entry's default export (which must be a `defineDriver()` factory) is invoked. This is the form `kraken plugins install` appends |
| Tuple | `[packageName: string, options?: unknown]` | second element passed to the factory | Same as the string form |

Every registration resolves to one status:

| Status | Meaning | Effect at run time |
|---|---|---|
| `ready` | Loaded, valid, compatible, host-supported | Serves its platforms |
| `unavailable-on-host` | Manifest host requirements unmet (e.g. iOS driver off macOS) | Reported with reason and fix; binding an actor to its platform throws `KRK-HOST-<ID>-UNSUPPORTED` before any session boots |
| `incompatible` | Driver built against an unsupported contract version | Binding throws `KRK-PLUGIN-INCOMPATIBLE` |
| `invalid` | Not a branded driver, malformed manifest, or unresolvable package | Binding throws `KRK-PLUGIN-INVALID` |

An actor whose `platform` no registration claims at all fails with `KRK-DRIVER-UNKNOWN-PLATFORM`, listing the known platforms.

## `ResolvedKrakenConfig`

`loadConfig()` returns the validated config extended with:

| Field | Type | Value |
|---|---|---|
| `features` | `string[]` | Normalized array; `['features/**/*.feature']` when the field was omitted |
| `projectRoot` | `string` | The directory containing the config file — the resolution anchor for features, steps, relative `app` paths and `.kraken/` |
| `configPath` | `string` | Absolute path of the loaded config file |

## Android — `@kraken-e2e/driver-android`

### Actor keys

| Key | Type | Capability produced | Fallback | Notes |
|---|---|---|---|---|
| `udid` | `string` | `appium:udid` | — | Targets a specific device or running emulator |
| `avd` | `string` | `appium:avd` | factory `avd` option | AVD to boot when no device is targeted |
| `app` | `string` | `appium:app` (resolved absolute path) | — | Validated fail-fast (see below); relative paths resolve against the project root |
| `appPackage` | `string` | `appium:appPackage` | — | Also scopes the session's `navigate()` deep links to the app under test |
| `appActivity` | `string` | `appium:appActivity` | — | Activity to launch |
| `capabilities` | `Record<string, unknown>` | merged verbatim, highest precedence | — | Keys must carry their vendor prefix (`appium:*`) |

### Factory options — `AndroidDriverOptions`

| Option | Type | Default | Semantics |
|---|---|---|---|
| `avd` | `string` | — | Default AVD for actors that declare none |
| `allowInsecure` | `string[]` | — | Appium 3 scoped insecure features forwarded to the embedded server, e.g. `['uiautomator2:adb_shell']` |
| `capabilities` | `Record<string, unknown>` | — | Merged into every Android session (below actor-level `capabilities`) |

### Driver-computed base capabilities

| Capability | Value | Note |
|---|---|---|
| `platformName` | `Android` | |
| `appium:automationName` | `UiAutomator2` | |
| `appium:systemPort` | OS-assigned free port | Per session; prevents collisions between concurrent runs on one machine |
| `appium:newCommandTimeout` | `300` | Seconds (Appium unit) |
| `appium:avdLaunchTimeout` | `180000` | ms; sized for cold emulator boots on laptop-class hardware |
| `appium:avdReadyTimeout` | `180000` | ms |
| `appium:adbExecTimeout` | `60000` | ms |
| `appium:uiautomator2ServerInstallTimeout` | `120000` | ms; the 20 s upstream default is unreliable on loaded machines |

Infrastructure: an embedded Appium 3 server with `appium-uiautomator2-driver`, installed under `<projectRoot>/.kraken/appium/android-home/`, logging to `appium-android.log` inside the run's artifacts directory. The WebDriver client connects to `127.0.0.1:<server port>` with `logLevel: 'error'`, `connectionRetryTimeout: 300000`, `connectionRetryCount: 1`. Host support: macOS, Linux, Windows (no manifest host requirements).

## iOS — `@kraken-e2e/driver-ios`

### Actor keys

| Key | Type | Capability produced | Fallback | Notes |
|---|---|---|---|---|
| `deviceName` | `string` | `appium:deviceName` | factory `deviceName`, then `'iPhone 16'` | Simulator name |
| `platformVersion` | `string` | `appium:platformVersion` | factory `platformVersion` | Set only when the actor or the factory provides it. Pinning is recommended — unpinned versions let XCUITest boot additional simulators |
| `udid` | `string` | `appium:udid` | — | Targets a specific simulator or device |
| `app` | `string` | `appium:app` (resolved absolute path) | — | Validated fail-fast; relative paths resolve against the project root |
| `bundleId` | `string` | `appium:bundleId` | — | Bundle identifier of the app under test |
| `prebuiltWDAPath` | `string` | `appium:prebuiltWDAPath` **and** `appium:usePreinstalledWDA: true` | factory `prebuiltWDAPath` | Skips the first-session `xcodebuild` of WebDriverAgent; requires iOS 17+; obtain with `appium driver run xcuitest download-wda` |
| `capabilities` | `Record<string, unknown>` | merged verbatim, highest precedence | — | |

### Factory options — `IosDriverOptions`

| Option | Type | Default | Semantics |
|---|---|---|---|
| `deviceName` | `string` | `'iPhone 16'` (applied at session build) | Default simulator for actors that declare none |
| `platformVersion` | `string` | — | Default `appium:platformVersion` |
| `prebuiltWDAPath` | `string` | — | Default prebuilt WebDriverAgent `.app` |
| `allowInsecure` | `string[]` | — | Appium 3 scoped insecure features forwarded to the embedded server |
| `capabilities` | `Record<string, unknown>` | — | Merged into every iOS session (below actor-level `capabilities`) |

### Driver-computed base capabilities

| Capability | Value | Note |
|---|---|---|
| `platformName` | `iOS` | |
| `appium:automationName` | `XCUITest` | |
| `appium:wdaLocalPort` | OS-assigned free port | Per session |
| `appium:mjpegServerPort` | OS-assigned free port | Per session |
| `appium:newCommandTimeout` | `300` | Seconds (Appium unit) |
| `appium:wdaLaunchTimeout` | `120000` | ms; the first-session WebDriverAgent build can take minutes |

Infrastructure: an embedded Appium 3 server with `appium-xcuitest-driver`, installed under `<projectRoot>/.kraken/appium/ios-home/`, logging to `appium-ios.log` in the run's artifacts directory; same WebDriver client settings as Android. Host support: **macOS only** (`hostRequirements: { platforms: ['darwin'] }` in the manifest — an Apple platform restriction). On other hosts the driver is disabled with an explicit message before its main entry is ever imported; binding an actor to `ios` there throws `KRK-HOST-IOS-UNSUPPORTED`.

## Web — `@kraken-e2e/driver-web`

### Actor keys

| Key | Type | Effect | Fallback |
|---|---|---|---|
| `browser` | `string` | Sets `browserName` via the mapping below; unmapped values pass through verbatim | factory `browser`, then `'chrome'` |
| `baseUrl` | `string` | The session calls `navigate(baseUrl)` immediately after creation. Any WebDriver-navigable URL, including `file://` | — |
| `headless` | `boolean` | Injects headless arguments (table below) | factory `headless`, then `false` |
| `capabilities` | `Record<string, unknown>` | Merged verbatim, highest precedence | — |

### Factory options — `WebDriverOptions`

| Option | Type | Default | Semantics |
|---|---|---|---|
| `browser` | `'chrome' \| 'firefox' \| 'safari' \| 'edge' \| string` | `'chrome'` | Default browser for actors that declare none |
| `headless` | `boolean` | `false` | Default headless mode |
| `capabilities` | `Record<string, unknown>` | — | Merged into every web session (below actor-level `capabilities`) |

### Browser name mapping

| `browser` value | `browserName` sent |
|---|---|
| `chrome` | `chrome` |
| `firefox` | `firefox` |
| `safari` | `safari` |
| `edge` | `MicrosoftEdge` |
| anything else | passed through unchanged |

### Headless implementation

| Browser | Capability injected when `headless: true` |
|---|---|
| Chrome | `'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900'] }` |
| Firefox | `'moz:firefoxOptions': { args: ['-headless'] }` |
| Safari, Edge, others | none — supply the vendor flags through `capabilities` |

Infrastructure: no Appium. Sessions go directly through WebdriverIO `remote()`, which downloads and manages the matching browser driver (chromedriver, geckodriver, safaridriver) automatically, caching it in `<projectRoot>/.kraken/browser-cache/` — a project-local directory that is trivially inspectable and safe to delete if a download is interrupted and leaves the cache corrupted. BiDi is WebdriverIO's default protocol for Chrome, Edge and Firefox; Safari runs classic WebDriver. Host support: macOS, Linux, Windows.

## Capability merge precedence

Applies to all three drivers; later layers override earlier ones, key by key:

| Layer | Source | Scope |
|---|---|---|
| 1 | Driver-computed base capabilities (platform/automation names, allocated ports, timeouts) | every session of the driver |
| 2 | Capabilities derived from actor keys (`avd`, `app`, `deviceName`, `browser`, …) | the actor |
| 3 | Factory option `capabilities` | every session of the driver |
| 4 | Actor key `capabilities` | the actor |

User-supplied capabilities can therefore override anything, including the driver's allocated ports and timeouts.

## Fail-fast app validation

Applies to the Android and iOS drivers whenever an actor's `app` is a string:

1. The path is resolved: absolute paths are used as-is; relative paths resolve against the **project root** (the directory of the config file).
2. The resolved file's existence is checked in `createSession`, **before** any capability set is sent to Appium — that is, before an emulator or simulator boots.
3. If the file does not exist, the session fails immediately with `KRK-DRIVER-APP-NOT-FOUND`, whose message names the actor and includes the fully resolved path, and whose fix text points at the `app` entry in `kraken.config.ts`.

Actors that drive a pre-installed app (Android: `appPackage`/`appActivity` without `app`; iOS: `bundleId` without `app`) are not subject to the check.

## Configuration-related error codes

| Code | Raised when | Raised by |
|---|---|---|
| `KRK-CONFIG-NOT-FOUND` | No `kraken.config.{ts,mts,js,mjs}` from the starting directory upwards, or the `--config` path does not exist | `@kraken-e2e/config` loader |
| `KRK-CONFIG-INVALID` | The config file throws while loading; the exported value fails schema validation; `actors` is empty; the steps module fails to load or does not export a `registry` created by `createStepRegistry()` | `@kraken-e2e/config` loader / `@kraken-e2e/cli` run pipeline |
| `KRK-DRIVER-APP-NOT-FOUND` | An actor's `app` file does not exist at its resolved path | Android / iOS drivers, in `createSession` |
| `KRK-DRIVER-UNKNOWN-PLATFORM` | An actor's `platform` is claimed by no registered driver | `@kraken-e2e/core` registry |
| `KRK-HOST-<ID>-UNSUPPORTED` | An actor binds to a platform whose driver is disabled on this host (e.g. `KRK-HOST-IOS-UNSUPPORTED` off macOS) | `@kraken-e2e/core` registry |
| `KRK-PLUGIN-INCOMPATIBLE` | An actor binds to a driver built against an incompatible contract version | `@kraken-e2e/core` registry |
| `KRK-PLUGIN-INVALID` | An actor binds to a registration that failed validation (missing brand, malformed manifest, unresolvable package) | `@kraken-e2e/core` registry |

See [error codes](/reference/error-codes) for the complete catalog.

## Which commands read the configuration

| Command | Uses the config for |
|---|---|
| `kraken run` | Everything: actors, drivers, features, steps; `--dry-run` stops after compilation and static analysis |
| `kraken doctor` | Driver registrations, to include gate statuses and driver-contributed checks; without a config it still reports the host |
| `kraken devices` | Driver registrations, to enumerate each ready driver's targets (with ready-to-paste actor config per target) |
| `kraken plugins install` | Locating the project and appending the string-form registration to the `drivers` array (only when it can do so mechanically safely; otherwise it prints the exact lines to add) |
| `kraken serve` | Only the config's location, to anchor `.kraken/runs/` |
