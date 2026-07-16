# Installation

Kraken is distributed as npm packages under the `@kraken-e2e` scope. The command-line interface, `@kraken-e2e/cli`, provides the `kraken` binary and is installed as a development dependency of each test project. Platform drivers are separate packages, installed per project and pinned in the project lockfile — see [Your first project](/getting-started/first-project).

## Requirements

### All platforms

| Requirement | Detail |
|---|---|
| Node.js ≥ 22.13 | The `engines` floor of every `@kraken-e2e` package. Node 24 LTS is the reference line; on Node 22 (Maintenance LTS, EOL 2027-04) `kraken doctor` reports a warning, not a failure. |
| A package manager | npm, pnpm or yarn. Kraken detects the project's package manager from its lockfile and never bypasses it. |

Host support is a property of each driver, not of Kraken as a whole:

| Driver | Automation stack | macOS | Linux | Windows |
|---|---|---|---|---|
| `@kraken-e2e/driver-android` | Appium 3 + UiAutomator2 (embedded server) | yes | yes | yes |
| `@kraken-e2e/driver-ios` | Appium 3 + XCUITest (embedded server) | yes | no | no |
| `@kraken-e2e/driver-web` | WebdriverIO native (no Appium) | yes | yes | yes |

macOS is required only for the iOS driver: XCUITest and WebDriverAgent are Apple platform restrictions, not a Kraken limitation. Kraken detects the host at startup and disables unavailable drivers with an explicit message; the rest of the suite remains usable on that host.

### Android toolchain

- **Android SDK**, with `ANDROID_HOME` exported (usually `~/Library/Android/sdk` on macOS). `ANDROID_SDK_ROOT` is deprecated by Google; if only the legacy variable is set, doctor reports a warning.
- **JDK 17 or newer** (21 LTS recommended), with `JAVA_HOME` exported. Android SDK tooling is compiled for JDK 17+; `sdkmanager` fails on older JDKs.
- **platform-tools** (`adb`), installable with `sdkmanager "platform-tools"` or through Android Studio.
- **A target**: either a device connected with USB debugging, or at least one AVD — Kraken can boot an existing AVD automatically. On Apple Silicon only `arm64-v8a` system images boot, and UiAutomator2 requires API 26+.

### iOS toolchain (macOS only)

- **Xcode 16.x or 26.x** — the versions fully supported by `appium-xcuitest-driver` 11.x. This support window moves every September; doctor flags an Xcode outside it.
- **An iOS simulator runtime.** Simulator runtimes are a separate download since Xcode 14 — a fresh Xcode install ships with zero. Download one with `xcodebuild -downloadPlatform iOS` or Xcode → Settings → Components.
- **At least one iPhone simulator**, creatable with `xcrun simctl create "iPhone 16"` or through Xcode → Devices and Simulators.

### Web

- **At least one automatable browser.** Chrome is recommended — WebdriverIO manages chromedriver automatically. On macOS, doctor probes `/Applications` for Chrome, Firefox, Safari and Edge; on other systems it probes `PATH` for `google-chrome`, `chromium` and `firefox`.
- **Safari only:** enable automation once with `safaridriver --enable` (administrator password required). `safaridriver` allows one concurrent session per host, so two simultaneous Safari actors on one machine cannot work — mix browsers instead. Chrome and Firefox actors need no enabling step.

## Installing the CLI

Install `@kraken-e2e/cli` into your test project as a development dependency:

```bash
npm install --save-dev @kraken-e2e/cli
```

Or, with the other package managers:

```bash
pnpm add -D @kraken-e2e/cli
yarn add --dev @kraken-e2e/cli
```

The package exposes a single binary named `kraken`. Verify the installation:

```bash
npx kraken --version
```

```text
@kraken-e2e/cli/3.0.0 darwin-arm64 node-v22.19.0
```

::: tip
All examples in this documentation invoke the CLI as `npx kraken …`. Inside package scripts, or with the project's `node_modules/.bin` on `PATH`, plain `kraken …` works identically.
:::

## First validation: `kraken doctor`

`kraken doctor` diagnoses the environment — host platform, toolchain and per-driver readiness — and pairs every problem with an actionable fix. Run it right after installing the CLI:

```bash
npx kraken doctor
```

```text
Kraken doctor — host: darwin/arm64, node 22.19.0

! Node.js >= 22.12 (engines floor) — running 22.19.0. Node 22 is Maintenance LTS (EOL 2027-04) — Node 24 LTS is the reference dev line.
✓ pnpm available — pnpm 11.10.0
✓ Host platform — darwin/arm64 — all three drivers (android, ios, web) can run here

2 ok, 1 warning(s), 0 failure(s)
```

Each line carries one of three statuses — `✓` ok, `!` warning, `✗` failure — and any non-ok entry is followed by an indented `fix:` line describing the exact remedy. In text mode the command exits with status 1 when any check fails. Two flags exist:

| Flag | Effect |
|---|---|
| `--json` | Emit the full report (host, entries, per-status summary, timestamp) as a JSON document for machine consumption. |
| `--cwd <dir>` | Diagnose a project in another directory (defaults to the current one). |

Doctor works with or without a project. Outside a project it runs the host-level checks only; inside a project it additionally resolves the configured drivers, reports each driver's gate status, and runs the checks that each *ready* driver contributes.

### Built-in host checks

| Check | Verifies | On failure |
|---|---|---|
| `common.node-version` | The running Node satisfies the engines floor. Node 22 passes with a warning (Maintenance LTS); older Node fails. | Install Node 24 LTS, e.g. `nvm install 24`. |
| `common.pnpm` | `pnpm` is on `PATH`. Absence is only a warning — npm and yarn projects work without it. | `corepack enable pnpm`. |
| `common.host` | Reports the host platform/architecture and which drivers can run on it. | Informational — always ok. |

### Driver gate checks

For every driver registered in `kraken.config.ts`, doctor emits a `driver.<id>.gate` entry:

| Gate state | Status | Meaning |
|---|---|---|
| `ready` | `✓` | The driver loads and can run on this host. |
| `unavailable-on-host` | `!` | The driver's manifest declares host requirements this machine does not meet (e.g. the iOS driver off macOS). The rest of the suite is unaffected. |
| `incompatible` | `✗` | The driver was built against a plugin contract version this Kraken does not support. |
| `invalid` | `✗` | The package does not satisfy the driver contract at all. |

### Android driver checks

| Check | Verifies | Fix on failure |
|---|---|---|
| `android.sdk-home` | `ANDROID_HOME` is set and points at an existing directory. Warns when only the deprecated `ANDROID_SDK_ROOT` is set. | Install the Android SDK and export `ANDROID_HOME`. |
| `android.jdk` | `JAVA_HOME` is set, `java` runs, and the JDK major is ≥ 17. | Install a JDK 17+ (21 LTS recommended) and export `JAVA_HOME`. |
| `android.adb` | `adb` (from `$ANDROID_HOME/platform-tools`) is runnable. | `sdkmanager "platform-tools"` or install via Android Studio. |
| `android.target` | A device is connected, or at least one AVD exists for auto-boot. | Create an AVD (Android Studio → Device Manager) or connect a device with USB debugging. On Apple Silicon only `arm64-v8a` images at API 26+ boot. |

### iOS driver checks

These run only on macOS; on any other host the driver is gated off before checks are collected.

| Check | Verifies | Fix on failure |
|---|---|---|
| `ios.xcode` | A developer directory is selected and the Xcode major is inside the xcuitest-driver support window (16.x / 26.x). | Install Xcode, `sudo xcode-select -s …`, or move inside the support window — it shifts every September. |
| `ios.simulator-runtimes` | At least one iOS simulator runtime is installed. | `xcodebuild -downloadPlatform iOS` — a fresh Xcode install ships with zero runtimes. |
| `ios.simulators` | At least one iPhone simulator is available. | `xcrun simctl create "iPhone 16"`. |

### Web driver checks

| Check | Verifies | Fix on failure |
|---|---|---|
| `web.browsers` | At least one automatable browser is installed (see [Web](#web) above for the probing rules). | Install Chrome (recommended). |
| `web.safaridriver` | On macOS: whether `safaridriver` has been enabled. Off macOS: not applicable. When available, the report reiterates the one-concurrent-Safari-session limit. | `safaridriver --enable` — only needed for Safari actors. |

With the CLI installed and doctor green (or warning-only), continue to [Your first project](/getting-started/first-project).
