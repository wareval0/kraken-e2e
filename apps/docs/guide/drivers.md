# Drivers

Kraken's engine contains no platform knowledge: it never imports Appium, WebdriverIO, ADB or a browser. Everything platform-specific lives in **driver packages**, installed per project, pinned in the project lockfile, and registered in `kraken.config.ts`. Three official drivers exist:

| Package | Stack | Host support |
|---|---|---|
| `@kraken-e2e/driver-android` | Appium 3 + UiAutomator2, embedded server | macOS, Linux, Windows |
| `@kraken-e2e/driver-ios` | Appium 3 + XCUITest, embedded server | macOS only (Apple platform restriction) |
| `@kraken-e2e/driver-web` | WebdriverIO native — no Appium | macOS, Linux, Windows |

Each mobile driver exact-pins its automation stack in its own dependencies (`appium@3.5.2` with `appium-uiautomator2-driver@8.0.1` on Android, `appium-xcuitest-driver@11.17.1` on iOS; `webdriverio@9.29.1` on all three). The versions a run uses are therefore governed by the project lockfile — never by a global Appium install or mutable per-user state.

A driver is a factory produced by `defineDriver()` from `@kraken-e2e/contracts`. Per run, Kraken calls `start()` once on each driver whose platform appears in the scenario, creates **one fully independent session per actor** with `createSession()` (never a multiremote session), and calls `stop()` during teardown. Drivers never write to stdout; they log through an injected logger, and their infrastructure logs land in the run's artifacts directory. Each driver also contributes toolchain checks to [`kraken doctor`](/guide/doctor) and target enumeration to [`kraken devices`](/guide/devices).

## Registration

The `drivers` array in `kraken.config.ts` accepts three forms:

```ts
import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';

export default defineConfig({
  actors: {
    alice: { platform: 'android', avd: 'Pixel_9_API_35', app: './apps/app.apk' },
  },
  drivers: [
    android({ avd: 'Pixel_9_API_35' }),                        // value form (primary)
    '@kraken-e2e/driver-web',                                  // string form
    ['@kraken-e2e/driver-ios', { platformVersion: '18.6' }],   // tuple form: [package, options]
  ],
});
```

- **Value form** — import the factory, call it with options, register the resulting value. This is plain dependency injection: the type checker sees the options, and package-manager layouts (pnpm strictness included) cannot interfere with resolution.
- **String and tuple forms** — the package name, optionally with an options object. This is the form `kraken plugins install` appends to the config. Kraken resolves the package from the project root.

## Host gating

Every driver ships a dependency-light `/manifest` subpath describing its id, platforms, contract version, host requirements, and remediation text. For string-form registrations the registry imports **only the manifest first** and gates on it — the driver's main entry is imported after the host check passes. Importing `@kraken-e2e/driver-ios` on Linux therefore never crashes on Apple-only dependencies; it produces a friendly, explicit status instead.

Validation per driver runs in order: brand check (`defineDriver` provenance) → manifest shape → contract compatibility → host requirements. Every failure becomes a status with remediation, surfaced in `kraken run` output and in `kraken doctor` — never a bare stack trace. On a Linux host with the iOS driver registered, `kraken run` prints:

```
! driver "ios" disabled on this host: iOS (XCUITest via Appium 3) requires host platform darwin, but this host is linux/x64
  fix: The iOS driver requires macOS: XCUITest and WebDriverAgent are Apple platform restrictions, not a Kraken limitation. Android and Web drivers work on this host.
```

A disabled driver does not poison the suite: scenarios that involve only other platforms run normally. Binding an actor to a disabled platform fails fast — with error code `KRK-HOST-IOS-UNSUPPORTED` (generally `KRK-HOST-<ID>-UNSUPPORTED`) — before any session boots.

The driver main entries are themselves import-safe on every host: heavy dependencies (`appium`, `webdriverio`) load dynamically inside `start()` and `createSession()`, never at module top level.

## Behavior common to all drivers

- **Capability precedence.** Session capabilities merge in a fixed order: computed defaults → keys derived from the actor config → the factory's `capabilities` option → the actor's `capabilities` key. Later entries win, so an actor-level `capabilities` object overrides everything, including factory-level `capabilities`.
- **Fail-fast app validation** (Android and iOS). When an actor config sets `app`, the path is resolved (relative paths resolve against the project root) and its existence is checked **before any session boots**. A missing file fails in milliseconds with `KRK-DRIVER-APP-NOT-FOUND` and an actionable message, instead of minutes later inside an emulator-boot Appium error.
- **OS-assigned ports.** The embedded Appium servers and every per-session port (`appium:systemPort`, `appium:wdaLocalPort`, `appium:mjpegServerPort`) are allocated by the operating system, not counted up from a fixed base. Concurrent Kraken runs on one machine cannot collide on ports.
- **Signal ownership.** The embedded Appium server's own SIGINT/SIGTERM handlers are removed after boot; the Kraken CLI owns process signals, so Ctrl-C performs an orderly teardown rather than an immediate exit.
- **Session hardening.** WebdriverIO sessions are created against `127.0.0.1` with a 300 000 ms connection-retry budget and a single retry.

## Android — `@kraken-e2e/driver-android`

Stack: Appium 3 (`appium@3.5.2`) with the UiAutomator2 driver (`appium-uiautomator2-driver@8.0.1`), driven through WebdriverIO. Runs on macOS, Linux and Windows; the manifest declares no host requirements.

### Factory options

```ts
android({ avd: 'Pixel_9_API_35', allowInsecure: ['uiautomator2:adb_shell'] })
```

| Option | Type | Effect |
|---|---|---|
| `avd` | `string` | Default AVD to boot for actors that do not specify a device (`appium:avd`). |
| `allowInsecure` | `readonly string[]` | Appium 3 scoped insecure features passed to the embedded server, e.g. `['uiautomator2:adb_shell']`. |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged into every session (`appium:*` keys included). |

### Actor configuration

| Key | Type | Effect |
|---|---|---|
| `platform` | `'android'` | Binds the actor to this driver. |
| `udid` | `string` | Attach to a specific connected device or running emulator (`appium:udid`). Boots nothing. |
| `avd` | `string` | AVD to boot for this actor (`appium:avd`). Overrides the factory `avd`. |
| `app` | `string` | Path to the `.apk` installed and launched for the session. Validated before boot. |
| `appPackage` | `string` | Application package id (`appium:appPackage`). Also the target package for `navigate()` deep links. |
| `appActivity` | `string` | Activity to launch (`appium:appActivity`). |
| `capabilities` | `object` | Raw Appium capabilities, merged last — override anything below. |

### Session boot

`start()` boots **one embedded Appium server per run**, in-process, bound to `127.0.0.1` on an OS-assigned port. There is no globally installed Appium and no `appium driver install` step. Instead, the driver synthesizes a project-mode `APPIUM_HOME` at `.kraken/appium/android-home`: a generated `package.json` declares the exact `appium` and `appium-uiautomator2-driver` versions resolved from the driver package's own dependency tree — the lockfile-pinned ones — and the resolved packages are symlinked into its `node_modules`, where Appium's project-mode manifest auto-discovers them. The home is refreshed on every start, and the symlink replacement is atomic, so concurrent runs on one machine are safe.

Each `createSession()` then opens an independent WebdriverIO session against that server. With `udid` set, the session attaches to the already-running device or emulator; with `avd` set (actor or factory), Appium boots the AVD, with generous launch budgets sized for cold emulator boots on laptop-class hardware. The full-debug server log is written to `.kraken/runs/<runId>/appium-android.log`; the console stays quiet because the terminal UI owns stdout.

### Capability defaults

| Capability | Default | Notes |
|---|---|---|
| `platformName` | `Android` | Fixed. |
| `appium:automationName` | `UiAutomator2` | Fixed. |
| `appium:systemPort` | OS-assigned per session | Prevents collisions across concurrent runs. |
| `appium:newCommandTimeout` | `300` (seconds) | Idle-session budget. |
| `appium:avdLaunchTimeout` | `180000` ms | Cold AVD boot budget. |
| `appium:avdReadyTimeout` | `180000` ms | Boot-completed budget. |
| `appium:adbExecTimeout` | `60000` ms | Per-adb-command budget. |
| `appium:uiautomator2ServerInstallTimeout` | `120000` ms | Install of the UiAutomator2 server APKs; the upstream 20 s default is exceeded on loaded machines. |

Every default can be overridden through `capabilities` at the factory or actor level.

### Platform notes

- `scrollIntoView` drives `UiScrollable` — the platform's own scrolling — and falls back to a plain element find when the screen has no scrollable container.
- `navigate(url)` performs a deep link (`mobile: deepLink`) targeted at `appPackage` when it is set; other URLs go to the system's default handler.
- `pressKey` sends genuine system key events via `mobile: pressKey`.

## iOS — `@kraken-e2e/driver-ios`

Stack: Appium 3 (`appium@3.5.2`) with the XCUITest driver (`appium-xcuitest-driver@11.17.1`), driven through WebdriverIO. macOS only: the manifest declares `hostRequirements: { platforms: ['darwin'] }`, and on any other host the registry disables the driver from the manifest alone, with the message quoted in [Host gating](#host-gating). The package deliberately does not set npm's `os` field, so a shared lockfile installs cleanly for teammates on Linux or Windows.

### Factory options

```ts
ios({ deviceName: 'iPhone 16', platformVersion: '18.6' })
```

| Option | Type | Effect |
|---|---|---|
| `deviceName` | `string` | Default simulator for actors without a device (`appium:deviceName`). |
| `platformVersion` | `string` | Default `appium:platformVersion`, e.g. `'18.6'`. |
| `prebuiltWDAPath` | `string` | Prebuilt WebDriverAgent `.app` for simulators. Sets `appium:usePreinstalledWDA: true` and `appium:prebuiltWDAPath`; requires iOS 17+. Skips the slow first-session `xcodebuild`. Fetch one with `appium driver run xcuitest download-wda`. |
| `allowInsecure` | `readonly string[]` | Appium 3 scoped insecure features. |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged into every session. |

### Actor configuration

| Key | Type | Effect |
|---|---|---|
| `platform` | `'ios'` | Binds the actor to this driver. |
| `udid` | `string` | Pin an exact simulator by udid (`appium:udid`) — the way to reuse a booted simulator. |
| `deviceName` | `string` | Simulator name (`appium:deviceName`). Falls back to the factory value, then `'iPhone 16'`. |
| `platformVersion` | `string` | iOS runtime version (`appium:platformVersion`). Falls back to the factory value. |
| `app` | `string` | Path to the simulator `.app` bundle. Validated before boot. |
| `bundleId` | `string` | Bundle identifier (`appium:bundleId`). |
| `prebuiltWDAPath` | `string` | Per-actor prebuilt WebDriverAgent path. Falls back to the factory value. |
| `capabilities` | `object` | Raw Appium capabilities, merged last. |

### Session boot

`start()` boots the same kind of embedded, per-run Appium server as the Android driver, with its own synthesized home at `.kraken/appium/ios-home` (declaring `appium` and `appium-xcuitest-driver`) and its full-debug log at `.kraken/runs/<runId>/appium-ios.log`. Each session receives OS-assigned `appium:wdaLocalPort` and `appium:mjpegServerPort` values.

On a fresh machine, the **first iOS session compiles WebDriverAgent with `xcodebuild`**, which can take minutes on a laptop; `appium:wdaLaunchTimeout` is sized at `120000` ms for exactly this. Later sessions reuse the built agent. The `prebuiltWDAPath` option removes the build entirely (iOS 17+ simulators).

::: warning deviceName and platformVersion must name a real simulator pair
When `appium:platformVersion` is absent, XCUITest resolves `deviceName` against the **newest installed runtime** — and when no simulator with that exact name exists there, it silently **creates** a fresh `appiumTest-<UUID>-<name>` simulator, once per session. A config that names a simulator that exists only on an older runtime therefore keeps creating and booting new simulators instead of using the intended one. Always pin **both** `deviceName` and `platformVersion`, or pin `udid`. [`kraken devices`](/guide/devices) prints the exact `(name, version)` pairs that exist on the host, as ready-to-paste actor config. Leftover `appiumTest-*` simulators are safe to delete.
:::

For an already-booted simulator, prefer the `udid` pin that `kraken devices` prints: the session attaches to it directly, boots nothing, and skips name resolution entirely.

### Capability defaults

| Capability | Default | Notes |
|---|---|---|
| `platformName` | `iOS` | Fixed. |
| `appium:automationName` | `XCUITest` | Fixed. |
| `appium:wdaLocalPort` | OS-assigned per session | WebDriverAgent port. |
| `appium:mjpegServerPort` | OS-assigned per session | Screen-stream port. |
| `appium:newCommandTimeout` | `300` (seconds) | Idle-session budget. |
| `appium:wdaLaunchTimeout` | `120000` ms | Covers the first-session WebDriverAgent build. |
| `appium:deviceName` | `iPhone 16` | Used only when neither the actor nor the factory names a device. |

### Platform notes

- `scrollIntoView` uses `mobile: scroll` with `toVisible: true`.
- `navigate(url)` performs a deep link via `mobile: deepLink`.
- `pressKey` emits device-level HID keyboard events (`mobile: performIoHidEvent`) — faithful hardware-key semantics rather than text input.

## Web — `@kraken-e2e/driver-web`

Stack: WebdriverIO native (`webdriverio@9.29.1`) — **no Appium**. Sessions go straight through WebdriverIO's `remote()`, which spawns and manages the matching browser driver (chromedriver, geckodriver, safaridriver, edgedriver) automatically. WebDriver BiDi is WebdriverIO's default for Chrome, Edge and Firefox; Safari runs classic WebDriver. Runs on every OS; no host requirements.

### Factory options

```ts
web({ browser: 'chrome', headless: true })
```

| Option | Type | Effect |
|---|---|---|
| `browser` | `'chrome' \| 'firefox' \| 'safari' \| 'edge'` or any `browserName` string | Default browser for actors that do not specify one. Default `'chrome'`. |
| `headless` | `boolean` | Run browsers headless. Default `false` — the choreography stays visible during local runs. |
| `capabilities` | `Record<string, unknown>` | Extra capabilities merged into every session. |

### Actor configuration

| Key | Type | Effect |
|---|---|---|
| `platform` | `'web'` | Binds the actor to this driver. |
| `browser` | `string` | Browser key for this actor. Overrides the factory value. |
| `headless` | `boolean` | Per-actor headless override. Falls back to the factory value, then `false`. |
| `baseUrl` | `string` | URL the session navigates to immediately after creation. |
| `capabilities` | `object` | Raw WebDriver capabilities, merged last. |

Browser keys map to `browserName` as follows; unknown keys pass through verbatim, so any `browserName` WebdriverIO accepts is usable.

| Key | `browserName` |
|---|---|
| `chrome` | `chrome` |
| `firefox` | `firefox` |
| `safari` | `safari` |
| `edge` | `MicrosoftEdge` |

### Session boot

There is no server to boot: `start()` only records the project root, and each `createSession()` lets WebdriverIO spawn the browser plus its driver. With `headless: true`, Chrome receives `--headless=new` and `--window-size=1280,900`, and Firefox receives `-headless`; the option currently maps to Chrome and Firefox only (Safari has no headless mode).

Downloaded browser drivers are cached **project-locally** at `.kraken/browser-cache` instead of the OS temp directory. An interrupted driver download leaves a corrupted cache folder that fails every subsequent run; with a project-local cache the recovery is inspectable and total:

```bash
rm -rf .kraken/browser-cache
```

::: warning Safari allows one session per host
`safaridriver` accepts at most **one concurrent session per machine**. Two simultaneous Safari actors on one host cannot work — give concurrent web actors different browsers instead. Safari automation must also be enabled once with `safaridriver --enable` (administrator password required); Chrome and Firefox actors do not need this. `kraken doctor` reports the safaridriver state.
:::

### Platform notes

- `readText` falls back to the element's `value` when it has no text content — form controls carry their content in `value`, not text nodes.
- `navigate(url)` is a plain browser navigation.
- `pressKey` uses W3C key actions.

## Artifacts on failure

When a scenario fails, the runner captures artifacts from **every actor in the cast**, not only the one whose step failed — in a multi-device scenario the other side of the conversation is usually the interesting evidence:

- a **screenshot** per actor, written to `.kraken/runs/<runId>/<actorId>/<driverId>-<sessionTag>-<n>.png`;
- the **full page source** per actor (UI hierarchy XML on Android and iOS, DOM HTML on web), written to `.kraken/runs/<runId>/<scenarioId>-<actorId>-source.txt`.

Both surface as `artifactCaptured` events in the run's event log and flow into the [reports](/guide/reports). Capture is best-effort by design: a failure while collecting artifacts never masks the original scenario failure. The embedded Appium server logs (`appium-android.log`, `appium-ios.log`) live in the same run directory.
