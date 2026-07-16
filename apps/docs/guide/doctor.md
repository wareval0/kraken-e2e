# Environment diagnosis

`kraken doctor` diagnoses the machine before it costs you a run: host platform and toolchain, per-driver readiness on this host, and each ready driver's platform toolchain — with an actionable fix attached to every problem it reports.

```bash
kraken doctor
kraken doctor --json
```

The report is assembled by composition: the CLI probes the host once, asks the driver registry for each registered driver's gate status, collects the toolchain checks contributed by every driver that is ready on this host, and feeds all of it to a pure check-execution engine. Two consequences are worth knowing:

- A **host-disabled** driver (the iOS driver on Linux, for example) appears only as its gate entry — a warning with remediation — and contributes no toolchain checks. A Linux host without Xcode is therefore not "failing"; it is simply a host where the iOS driver does not apply.
- Running `kraken doctor` **outside a project** still works: without a `kraken.config.ts` the report contains the host-level checks only (no gate entries, no driver toolchain checks).

All checks are read-only. Doctor shells out to version and listing commands (`java --version`, `adb devices`, `xcodebuild -version`, `xcrun simctl list`, `safaridriver --version`, …) and never boots, installs, or modifies anything.

## Status semantics

| Status | Icon | Meaning |
|---|---|---|
| `ok` | `✓` | The requirement is satisfied. The detail often carries useful facts (SDK path, JDK major, installed runtimes). |
| `warn` | `!` | Usable, but degraded or noteworthy — a deprecated variable, a missing optional tool, a driver that does not apply to this host. Warnings never affect the exit code. |
| `fail` | `✗` | Blocks the corresponding capability. Every failure carries a `fix` line. |

A check that throws is reported as `fail` with a note that the check itself is defective — a crashing check can never abort the rest of the report.

## Host checks

These run always, project or not.

| Check | Verifies | Degraded states |
|---|---|---|
| `common.node-version` | Node.js at or above the 22.12 engines floor. | `warn` on any Node 22.x — Node 22 is Maintenance LTS (EOL 2027-04); Node 24 LTS is the reference line. `fail` below the floor; fix: install Node 24 (`nvm install 24`). |
| `common.pnpm` | `pnpm --version` runs. | `warn` when pnpm is not on `PATH`; fix: `corepack enable pnpm` (or `npm install -g corepack` on Node >= 25). Never fails. |
| `common.host` | Reports the platform. | Always `ok`; the detail states `darwin/arm64 — all three drivers (android, ios, web) can run here` or, off macOS, that the iOS driver requires macOS while android/web remain available. |

## Driver gate entries

With a project loaded, every registered driver produces one entry `driver.<id>.gate`:

| Gate state | Status | Detail and fix |
|---|---|---|
| ready | `ok` | `ready on this host`. |
| unavailable on host | `warn` | The reason (`iOS (XCUITest via Appium 3) requires host platform darwin, but this host is linux/x64`) plus the driver's remediation text. |
| incompatible | `fail` | `built against contract X.Y, host supports Z.W`, with the direction-specific fix (upgrade `@kraken-e2e/core`, or align major versions). |
| invalid | `fail` | The validation problems (missing manifest export, package not created with `defineDriver()`, unresolvable package with an install hint). |

## Android toolchain checks

Contributed by `@kraken-e2e/driver-android` when it is ready on the host.

| Check | Verifies | Degraded states |
|---|---|---|
| `android.sdk-home` | `ANDROID_HOME` points at an existing Android SDK directory. | `warn` when only the deprecated `ANDROID_SDK_ROOT` is set; fix: set `ANDROID_HOME` to the same directory. `fail` when `ANDROID_HOME` is unset or points at a non-existent path. |
| `android.jdk` | `JAVA_HOME` is set and `java` runs with major 17+ (`sdkmanager` requires it; UiAutomator2 needs a JDK). | `fail` when `JAVA_HOME` is unset, `java` is not runnable, or the JDK is older than 17 — Android SDK tooling is compiled for class-file 61; fix: install JDK 17+ (21 LTS recommended). |
| `android.adb` | `adb --version` succeeds, resolving `$ANDROID_HOME/platform-tools/adb` first, then `PATH`. | `fail`; fix: install platform-tools (`sdkmanager "platform-tools"` or via Android Studio). |
| `android.target` | `adb devices` shows a connected device or emulator, or `emulator -list-avds` shows at least one AVD available for auto-boot (the `ok` detail names them). | `fail` when neither exists; fix: create an AVD (Android Studio → Device Manager) or connect a device with USB debugging. On Apple Silicon the fix adds that only `arm64-v8a` system images boot and UiAutomator2 requires API 26+. |

## iOS toolchain checks

Contributed by `@kraken-e2e/driver-ios`. These only ever run on macOS — elsewhere the driver is gated off before checks are collected.

| Check | Verifies | Degraded states |
|---|---|---|
| `ios.xcode` | A developer directory is selected (`xcode-select -p`) and `xcodebuild -version` reports a major inside the xcuitest-driver support window (currently 16.x / 26.x). | `fail` when no developer directory is selected (fix: install Xcode, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`), when `xcodebuild` does not run (fix: open Xcode once to finish first-launch setup), or when the major is below 16. `warn` when the major is above the window. The fix notes the window tracks the latest two Xcode majors and moves every September. |
| `ios.simulator-runtimes` | `xcrun simctl list runtimes` shows at least one iOS runtime; the `ok` detail lists them. | `fail` when none is installed; fix: `xcodebuild -downloadPlatform iOS` (or Xcode → Settings → Components). Simulator runtimes are separate downloads since Xcode 14 — a fresh Xcode install ships with zero. |
| `ios.simulators` | `xcrun simctl list devices available` shows at least one iPhone simulator. | `fail`; fix: `xcrun simctl create "iPhone 16"` (or Xcode → Devices and Simulators). |

## Web toolchain checks

Contributed by `@kraken-e2e/driver-web`.

| Check | Verifies | Degraded states |
|---|---|---|
| `web.browsers` | At least one automatable browser is installed. On macOS: `/Applications` probes for Chrome, Firefox, Safari and Edge; elsewhere: `PATH` probes for `google-chrome`, `chromium`, `firefox`. The `ok` detail lists what was found. | `fail` on macOS when nothing is found, `warn` on other hosts; fix: install Chrome (recommended — WebdriverIO manages its driver automatically). |
| `web.safaridriver` | Safari automation state. Off macOS: `ok` (`not applicable off macOS`). When runnable, the `ok` detail includes the constraint `max ONE concurrent Safari session per host`. | `warn` when `safaridriver` is not runnable (never enabled); fix: `safaridriver --enable` once (administrator password required) — Chrome/Firefox actors do not need this. |

## Output and exit code

The text rendering prints one line per check, `fix:` lines for anything non-ok, and a summary:

```
Kraken doctor — host: darwin/arm64, node 24.4.0
✓ Node.js >= 22.12 (engines floor) — running 24.4.0
✓ pnpm available — pnpm 10.12.1
✓ Host platform — darwin/arm64 — all three drivers (android, ios, web) can run here
✓ Driver "android" — ready on this host
✓ Driver "ios" — ready on this host
✓ Driver "web" — ready on this host
✓ ANDROID_HOME points at an Android SDK — /Users/dev/Library/Android/sdk
✓ JDK 17+ (sdkmanager requires it; uiautomator2 needs a JDK) — JDK 21
✓ adb (platform-tools) is runnable — Android Debug Bridge version 1.0.41
✗ A device is connected or an AVD exists — no connected device and no AVD
    fix: Create an AVD (Android Studio → Device Manager) or connect a device with USB debugging. On Apple Silicon only arm64-v8a system images boot (API 26+ required by uiautomator2).
✓ Xcode present and inside the xcuitest-driver support window (16.x / 26.x) — Xcode 26.0
✓ An iOS simulator runtime is installed (separate download since Xcode 14) — iOS 18.6, iOS 26.5
✓ At least one iPhone simulator is available — 6 iPhone simulator(s) available
✓ At least one automatable browser is installed — Chrome, Safari
! Safari automation (safaridriver) state — safaridriver not runnable (never enabled?)
    fix: Enable once with: safaridriver --enable (admin password required). Chrome/Firefox actors don't need this.

13 ok, 1 warning(s), 1 failure(s)
```

In text mode the command **exits 1 when any check fails** and 0 otherwise; warnings do not affect the exit code.

## `--json`

`kraken doctor --json` emits the report as a machine-readable environment snapshot and exits 0 regardless of check results — consumers gate on `summary.fail`:

```json
{
  "generatedAt": "2026-07-09T15:04:05.000Z",
  "host": { "platform": "darwin", "arch": "arm64", "nodeVersion": "24.4.0" },
  "entries": [
    {
      "id": "common.node-version",
      "title": "Node.js >= 22.12 (engines floor)",
      "status": "ok",
      "detail": "running 24.4.0"
    },
    {
      "id": "android.target",
      "title": "A device is connected or an AVD exists",
      "status": "fail",
      "detail": "no connected device and no AVD",
      "fix": "Create an AVD (Android Studio → Device Manager) or connect a device with USB debugging."
    }
  ],
  "summary": { "ok": 13, "warn": 1, "fail": 1 }
}
```

```bash
# CI gate: fail the job when anything fails
test "$(kraken doctor --json | jq '.summary.fail')" -eq 0
```

The snapshot is also the right thing to attach to a bug report: it captures the host triple, every check outcome, and the exact details (SDK paths, tool versions, simulator runtimes) in one document.

## Flags

| Flag | Effect |
|---|---|
| `--json` | Emit the report as JSON on stdout; the exit code is 0 — gate on `summary.fail`. |
| `--cwd <dir>` | Project directory to load `kraken.config.ts` from (defaults to the current directory). Determines which drivers are gated and which toolchain checks run. |
