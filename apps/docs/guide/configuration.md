# Configuration

A Kraken project is driven by one file: `kraken.config.ts`. It declares the actor cast, registers the drivers, and points at the feature files and step definitions. The file is ordinary TypeScript, executed at load time — Kraken treats it as the project's *composition root*: drivers arrive as values returned by typed factory imports, and every path in the project resolves relative to the directory that contains it.

This page explains each part of the file and how the engine consumes it. For exhaustive field-by-field tables, see the [configuration reference](/reference/configuration).

## A complete example

```ts
import { join } from 'node:path';

import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';
import ios from '@kraken-e2e/driver-ios';
import web from '@kraken-e2e/driver-web';

const APPS = join(import.meta.dirname, 'apps');

export default defineConfig({
  actors: {
    alice: {
      platform: 'android',
      avd: process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0',
      app: join(APPS, 'native-demo-app.apk'),
      appPackage: 'com.wdiodemoapp',
    },
    bob: {
      platform: 'ios',
      deviceName: process.env['KRAKEN_IOS_SIM'] ?? 'iPhone 16',
      platformVersion: process.env['KRAKEN_IOS_VERSION'] ?? '18.6',
      app: join(APPS, 'wdiodemoapp.app'),
      bundleId: 'org.wdiodemoapp',
    },
    carol: {
      platform: 'web',
      browser: process.env['KRAKEN_WEB_BROWSER'] ?? 'chrome',
      baseUrl: 'http://127.0.0.1:4173/',
    },
  },
  drivers: [android(), ios(), web()],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
```

## defineConfig

`defineConfig` is exported by `@kraken-e2e/config`. It is an identity function — it returns its argument unchanged — whose only purpose is to anchor the `KrakenConfig` type so that editors provide autocompletion and the compiler checks the shape without any import-resolution magic:

```ts
export function defineConfig(config: KrakenConfig): KrakenConfig {
  return config;
}
```

The config module must make the configuration available as its default export. A plain object literal of the correct shape also works; `defineConfig` adds only typing.

## How the config file is located

Commands locate the config by walking **up** the directory tree from the working directory, the same way `tsconfig.json` or an ESLint flat config is found. In each directory, four basenames are tried in order:

1. `kraken.config.ts`
2. `kraken.config.mts`
3. `kraken.config.js`
4. `kraken.config.mjs`

The first existing file wins; the search stops at the filesystem root. If no file is found, loading fails with `KRK-CONFIG-NOT-FOUND`.

Two consequences follow from the walk-up:

- `kraken run` can be invoked from any subdirectory of the project.
- The directory containing the config file becomes the **project root** — the resolution anchor for feature globs, the steps module, relative `app` paths, and the `.kraken/` state directory.

`kraken run` accepts `--config <path>` (short: `-c`) to bypass discovery entirely; the path may be absolute or relative to the current working directory. Only the four basenames above are auto-discovered — a variant file such as `kraken.trio.config.ts` is reachable exclusively through `--config`. `kraken doctor` and `kraken devices` accept `--cwd <dir>` and run the same walk-up from there; `kraken plugins install` uses the walk-up to find the config it registers drivers into. See the [CLI reference](/reference/cli).

## How the config file is loaded

The file is loaded with [jiti](https://github.com/unjs/jiti), the same TypeScript-config engine ESLint and Nuxt use. There is **no build step**: the `.ts` file is executed directly. This has several practical consequences:

- The config can import other TypeScript modules from the project (a shared world object, path helpers, driver factories).
- The **default export** is used. If the module has no default export, the module namespace itself is validated instead.
- Top-level `await` is allowed — the config may perform asynchronous work before exporting. The showcase example boots a local backend server this way before declaring its actors.
- Because the file is executed code, anything TypeScript can do is available: reading environment variables, computing paths with `import.meta.dirname`, conditional actor definitions.

If the module throws while loading, the error surfaces as `KRK-CONFIG-INVALID` with the underlying message attached.

## Validation

After loading, the exported value is validated structurally (the validation library is internal — it never appears in Kraken's public types):

- `actors` must be a record of non-empty names; each actor must have a non-empty string `platform`. All other actor keys are accepted and passed through untouched.
- `drivers` must be an array whose entries are driver values, package-name strings, or `[packageName, options]` tuples.
- `features`, if present, must be a string or an array of strings.
- `steps`, if present, must be a string.
- `defaults.assertionTimeoutMs`, if present, must be a positive number.
- At least one actor must be declared.

Any violation fails with `KRK-CONFIG-INVALID`, listing every offending field path and message. Unknown top-level keys are not rejected; the engine ignores them. Validation is deliberately shallow for actor entries: which keys mean something on an `android` actor is the Android driver's business, not the schema's.

## Top-level fields

| Field | Required | Default | Purpose |
|---|---|---|---|
| `actors` | yes | — | The closed actor cast: name → platform binding plus driver-specific session configuration |
| `drivers` | yes | — | Driver registrations: factory values, package names, or `[name, options]` tuples |
| `features` | no | `'features/**/*.feature'` | Feature file glob(s), relative to the project root |
| `steps` | no | `'./steps/index.ts'` | Module whose `registry` export is the project's step registry |
| `defaults` | no | — | Project-wide defaults; the single sanctioned entry is `assertionTimeoutMs` |
| `screenshots` | no | `'on-failure'` | Automatic screenshot policy: `'on-failure'` captures every actor's screenshot + page source when a scenario fails; `'per-step'` additionally captures the acting actor's screen after every completed step (a visual timeline of the run); `'off'` disables automatic captures. Steps can always capture explicitly with `actor.session.screenshot()`. |

### actors

`actors` is a named map — the **closed cast** of the suite. A feature step that names an actor absent from this map is rejected during dry-run compilation, before any session boots (see [How Kraken works](/introduction/how-kraken-works)).

Each entry has exactly one universally meaningful key, `platform`, a string matched against the `platforms` list in each registered driver's manifest. The official drivers claim `android`, `ios` and `web`; a custom driver may claim any identifiers it likes. The fake driver used in the `fake-messaging` example claims `android-fake`, `ios-fake` and `web-fake`, for instance — platform names are an open vocabulary, not an enum.

Every other key on an actor entry is **driver-specific session configuration**, passed verbatim to the owning driver's `createSession`. The keys each official driver understands are documented [below](#actor-configuration-by-platform).

### drivers

`drivers` is an array of registrations. Three forms are accepted:

```ts
drivers: [
  android({ avd: 'Pixel_9_API_35' }),          // 1 — driver value (recommended)
  '@kraken-e2e/driver-web',                    // 2 — package name string
  ['@kraken-e2e/driver-ios', { deviceName: 'iPhone 16' }], // 3 — [name, options] tuple
],
```

1. **Driver values** — import the factory, call it (optionally with options), register the returned value. This is dependency injection: it survives strict package managers, works in monorepos, and gives full type checking on the options object.
2. **Package-name strings** — the form `kraken plugins install <pkg>` appends automatically. At run start the engine resolves `<pkg>/manifest` from the project root, validates the manifest, and checks host requirements **before** importing the package's main entry — so a driver that cannot load on the current host (the iOS driver on Linux, for example) is disabled with an explicit message instead of crashing on import. Only after the host gate passes is the main entry imported; its default export must be a `defineDriver()` factory, which is invoked with no options.
3. **Tuples** — identical to the string form, except the second element is passed to the factory as its options.

Each ready driver claims the platforms in its manifest; when two drivers claim the same platform, the one registered **first** wins. At run start, every registration is reported: host-disabled drivers print their reason and remediation but do not abort the run — the failure happens only if an actor actually binds to a disabled platform, and then it fails fast with an explicit error before any session boots. See [Drivers](/guide/drivers) for the full lifecycle and [Environment diagnosis](/guide/doctor) for how registration problems surface in `kraken doctor`.

### features

A glob pattern, or an array of patterns, matched **relative to the project root** (matching is done with tinyglobby). The default is `features/**/*.feature`. Matching files are sorted and compiled before execution; if no file matches, `kraken run` prints the patterns it tried and exits with code 1.

### steps

The path (relative to the project root, or absolute) of the module whose `registry` export is the project's step registry. The default is `./steps/index.ts`. The module is loaded with jiti — TypeScript, no build step — and must export a `registry` created by `createStepRegistry()` from `@kraken-e2e/gherkin`; the export is verified with a brand check, so it works even when the package is duplicated in the dependency tree. The convention is explicit composition: `steps/index.ts` creates the registry and imports every step file, with no directory scanning. See [Writing steps](/guide/writing-steps).

### defaults

`defaults` holds project-wide defaults, and by design there is exactly one: `assertionTimeoutMs`, a positive number of milliseconds — the timeout budget for polling assertions. Assertions poll because they are bound by application latency; this is the sanctioned place to size that budget for the whole project. Choreography steps are deliberately excluded: signal waits and background-task joins always carry their duration in the step text (`within 5s`) and never fall back to a config default.

## The project root

The directory containing the config file anchors everything:

| What | Resolution |
|---|---|
| `features` globs | matched relative to the project root |
| `steps` path | resolved against the project root |
| Actor `app` paths (Android/iOS) | relative paths resolve against the project root |
| Run artifacts | `.kraken/runs/<runId>/` under the project root (events log, screenshots, Appium logs, Allure and CTRF outputs) |
| Embedded Appium installations | `.kraken/appium/android-home/` and `.kraken/appium/ios-home/` |
| Browser driver cache (web) | `.kraken/browser-cache/` |

The `.kraken/` directory is per-project state; it is safe to delete (`rm -rf .kraken/browser-cache` resolves a corrupted browser-driver download, for example).

## Actor configuration by platform

Each official driver reads a specific set of keys from an actor entry and translates them into WebDriver capabilities. Anything the keys do not cover is reachable through the `capabilities` escape hatch, whose entries are merged verbatim into the session capabilities (vendor prefixes such as `appium:` must be written explicitly).

### Android actors

```ts
alice: {
  platform: 'android',
  avd: 'Medium_Phone_API_36.0',        // emulator to boot, or:
  // udid: 'emulator-5554',            // a specific running device/emulator
  app: './apps/native-demo-app.apk',   // installed on session start
  appPackage: 'com.wdiodemoapp',
  // appActivity: '.MainActivity',
  // capabilities: { 'appium:noReset': true },
},
```

| Key | Type | Effect |
|---|---|---|
| `udid` | `string` | Targets a specific device or running emulator (`appium:udid`). `kraken devices` prints ready-to-paste values |
| `avd` | `string` | Android Virtual Device to boot (`appium:avd`); falls back to the driver factory's `avd` option |
| `app` | `string` | Path to the `.apk` to install; relative paths resolve against the project root and the file's existence is checked before the session boots (see [fail-fast app validation](#fail-fast-app-validation)) |
| `appPackage` | `string` | Application package id (`appium:appPackage`); also lets the session scope `navigate()` deep links to the app under test |
| `appActivity` | `string` | Activity to launch (`appium:appActivity`) |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged last, verbatim |

Device resolution is forgiving on purpose. Before a session boots, the driver checks what is actually connected: a configured `udid` that is connected wins untouched; one that is **not** connected falls back to the configured `avd` (booting it), then to any other running device, then to booting an available AVD. A configured `avd` that is already running as an emulator is reused rather than double-booted. When nothing is configured, the first running device is used — or, with none running, the first available AVD is booted. Only when there is no device and no AVD anywhere does the session fail, immediately, with `KRK-DRV-ANDROID-NO-DEVICE` — never with a slow, opaque Appium timeout. Every deviation from the literal config is logged; and when raw `capabilities` already pin a device (`appium:udid`, `appium:avd` or `appium:remoteAdbHost`), resolution steps aside entirely and Appium receives them verbatim.

The Android driver factory itself accepts options that apply to every Android actor:

```ts
android({
  avd: 'Pixel_9_API_35',                       // default AVD for actors without one
  allowInsecure: ['uiautomator2:adb_shell'],   // Appium 3 scoped insecure features
  capabilities: { 'appium:disableWindowAnimation': true },
})
```

The driver embeds its own Appium 3 server (installed under `.kraken/appium/android-home/`, logging to `appium-android.log` in the run's artifacts directory) and assigns an OS-allocated free `appium:systemPort` per session, so concurrent Kraken runs on one machine do not collide.

### iOS actors

```ts
bob: {
  platform: 'ios',
  deviceName: 'iPhone 16',
  platformVersion: '18.6',
  app: './apps/wdiodemoapp.app',
  bundleId: 'org.wdiodemoapp',
  // udid: 'A1B2C3D4-…',              // a specific simulator/device
  // prebuiltWDAPath: './wda/WebDriverAgentRunner-Runner.app',
  // capabilities: { 'appium:includeSafariInWebviews': true },
},
```

| Key | Type | Effect |
|---|---|---|
| `deviceName` | `string` | Simulator name (`appium:deviceName`); falls back to the factory option, then to `iPhone 16` |
| `platformVersion` | `string` | iOS runtime version (`appium:platformVersion`); falls back to the factory option |
| `udid` | `string` | Targets a specific simulator or device (`appium:udid`) |
| `app` | `string` | Path to the `.app`/`.ipa` to install; relative paths resolve against the project root, existence checked fail-fast |
| `bundleId` | `string` | Bundle identifier (`appium:bundleId`) |
| `prebuiltWDAPath` | `string` | Prebuilt WebDriverAgent `.app`; sets `appium:usePreinstalledWDA: true` and `appium:prebuiltWDAPath`, skipping the slow first-session `xcodebuild` (requires iOS 17+; fetch one with `appium driver run xcuitest download-wda`) |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged last, verbatim |

::: tip Pin the runtime
Declare `platformVersion` explicitly. An unpinned version lets the XCUITest stack pick any installed runtime, which can silently create and boot additional simulators instead of reusing the one you expect.
:::

The iOS driver factory accepts:

```ts
ios({
  deviceName: 'iPhone 16',            // default simulator
  platformVersion: '18.6',            // default runtime
  prebuiltWDAPath: './wda/WebDriverAgentRunner-Runner.app',
  allowInsecure: [],                  // Appium 3 scoped insecure features
  capabilities: {},                   // merged into every iOS session
})
```

Like Android, the driver embeds its own Appium 3 server (under `.kraken/appium/ios-home/`, logging to `appium-ios.log`) and allocates free `appium:wdaLocalPort` and `appium:mjpegServerPort` values per session. The iOS driver runs only on macOS — an Apple platform restriction, enforced through the driver manifest's host requirements; on other hosts it disables itself with an explicit message and the rest of the suite remains usable.

### Web actors

```ts
carol: {
  platform: 'web',
  browser: 'chrome',                  // 'chrome' | 'firefox' | 'safari' | 'edge' | any browserName
  baseUrl: 'http://127.0.0.1:4173/',  // navigated to right after the session starts
  headless: false,
  // capabilities: { 'goog:chromeOptions': { args: ['--lang=es'] } },
},
```

| Key | Type | Effect |
|---|---|---|
| `browser` | `string` | Browser to launch; `chrome`, `firefox`, `safari` and `edge` map to the proper `browserName` (`edge` → `MicrosoftEdge`); any other value is passed through as `browserName` verbatim. Default `chrome` |
| `baseUrl` | `string` | If set, the session navigates there immediately after creation — the actor starts every scenario on that page. Any URL WebDriver accepts works, including `file://` URLs |
| `headless` | `boolean` | Runs the browser headless. Default `false` — a Kraken run is a multi-device choreography, and watching it is often the point. Implemented for Chrome (`--headless=new`, window 1280×900) and Firefox (`-headless`); other browsers need explicit `capabilities` |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged last, verbatim |

The web driver factory accepts `browser`, `headless` and `capabilities` with the same meanings, as defaults for every web actor. There is no Appium involved: sessions go straight through WebdriverIO, which downloads and manages the matching browser driver automatically, caching it under `.kraken/browser-cache/` in the project.

### Capability precedence

For every driver, the final WebDriver capability set is built in four layers, later layers overriding earlier ones:

1. Driver-computed base capabilities (platform name, automation name, allocated ports, generous timeouts suited to laptop-class hardware).
2. Capabilities derived from the actor keys above (`avd` → `appium:avd`, `app` → `appium:app`, …).
3. The driver factory's `capabilities` option (applies to every session of that driver).
4. The actor's `capabilities` entry (applies to that actor only).

Because user capabilities merge last, they can override anything — including the driver's computed ports and timeouts. The exact base values per driver are tabulated in the [configuration reference](/reference/configuration).

## Fail-fast app validation

On Android and iOS, when an actor declares `app`, the driver resolves the path (absolute paths as-is; relative paths against the project root) and checks that the file exists **before creating the session**. A missing file fails in milliseconds with `KRK-DRIVER-APP-NOT-FOUND`, naming the actor and the fully resolved path — instead of minutes later, as an opaque Appium session error after an emulator or simulator boot. Actors that drive a pre-installed app (only `appPackage`/`appActivity` on Android, only `bundleId` on iOS) skip the check, since no file is involved.

## Environment variables in config files

The repository's examples parameterize device choices through environment variables:

```ts
avd: process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0',
deviceName: process.env['KRAKEN_IOS_SIM'] ?? 'iPhone 16',
platformVersion: process.env['KRAKEN_IOS_VERSION'] ?? '18.6',
browser: process.env['KRAKEN_WEB_BROWSER'] ?? 'chrome',
```

`KRAKEN_ANDROID_AVD`, `KRAKEN_IOS_SIM`, `KRAKEN_IOS_VERSION` and `KRAKEN_WEB_BROWSER` are **conventions of the examples, not engine features**: the engine reads no environment variables to configure actors. Because the config is executed TypeScript, `process.env` plus a `??` fallback is all the mechanism required, and any naming scheme works equally well.

## Multiple configurations

Only the four standard basenames are auto-discovered, so additional configurations live in separate files run explicitly:

```bash
kraken run                                    # kraken.config.ts (discovered)
kraken run --config kraken.swapped.config.ts  # a variant
kraken run -c configs/ci.config.ts            # any path works
```

Two workflows build on this:

**Suite splitting.** The showcase example keeps one config per suite — `kraken.web.config.ts`, `kraken.android.config.ts`, `kraken.duo.config.ts`, `kraken.trio.config.ts`, `kraken.monkey.config.ts` — each declaring only the actors and drivers that suite needs and narrowing `features` to its own subdirectory (`features/trio/**/*.feature`), while all of them share the same `steps: './steps/index.ts'`.

**Matrix permutation.** Because steps written against portable locator strategies are platform-agnostic, swapping the platform assignment of the cast is a pure configuration change. The `multi-user-android-ios-web` example ships `kraken.config.ts` (alice on Android, bob on iOS, carol on web) and `kraken.swapped.config.ts` (alice on web, carol on Android, bob on iOS): the same feature file and the same step definitions run under both — only the `actors` map differs. Running the suite across a device matrix is therefore a loop over config files, not a rewrite:

```bash
kraken run --config kraken.config.ts
kraken run --config kraken.swapped.config.ts
```

See the [examples overview](/examples/overview) for the full projects these workflows come from.


## Per-actor data and credentials

Each actor can carry its own key/value **data** — the natural place for
per-actor credentials or custom fields. Provide it inline, or as a path to an
env-format file (merged, with inline `data` winning):

```ts
actors: {
  alice: {
    platform: 'web',
    data: { username: 'alice@example.com', role: 'admin' },
  },
  bob: {
    platform: 'web',
    env: './secrets/bob.env',   // KEY=value lines, gitignored
  },
}
```

Steps read it through `actor.data`:

```ts
When('{actor} signs in', async ({ actor }) => {
  const page = await LoginPage.open(actor.session);
  await page.logIn(String(actor.data.username), String(actor.data.password));
});
```

`actor.data` is step-facing only — it is never passed to the driver, so it
will not collide with driver capabilities. Keep any referenced `env` files out
of version control.

## Environment files and credentials

Kraken loads a project `.env` file automatically before evaluating
`kraken.config.ts`, so credentials and per-environment values live in an
untracked file rather than in the config or the shell:

```bash
# examples/real-apps/.env  (gitignored)
KAHOOT_EMAIL=you@example.com
KAHOOT_PASSWORD=your-password
```

Your config and steps read them through `process.env` as usual:

```ts
const email = process.env['KAHOOT_EMAIL'];
```

Precedence is **real environment variables > `.env.local` > `.env`**: the files
only fill values that are not already set, so a CI secret or a one-off
`FOO=bar kraken run` always wins, and `.env.local` overrides a shared `.env`.
The file is looked up next to `kraken.config.ts`. Keep `.env` and `.env.local`
out of version control (add them to `.gitignore`); commit a `.env.example`
documenting the expected keys instead.
