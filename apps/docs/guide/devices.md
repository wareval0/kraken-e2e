# Devices

`kraken devices` answers one question before a run: **what can this machine already drive?** It enumerates concrete automation targets per registered driver — running emulators, connected devices, booted and available simulators, installed browsers — and prints ready-to-paste actor configuration for each. The command is strictly read-only: it never boots an emulator, never creates a simulator, and never starts an Appium server or a browser.

```bash
kraken devices
kraken devices --json
```

The command runs inside a project: the set of drivers to interrogate comes from the `drivers` array in `kraken.config.ts`. Only drivers that are ready on the host are asked — a host-disabled driver (the iOS driver on Linux, for example) simply does not appear in the listing. A registered driver that predates target enumeration (contract < 2.1) is listed as `(driver does not support device enumeration)`.

## Example output

```
android — Android (UiAutomator2 via Appium 3)
  ● Medium_Phone_API_36.0  [running] — model sdk_gphone64_arm64
      actor config: {"platform":"android","udid":"emulator-5554"}
  ○ Pixel_9_API_35  [available] — boots on demand
      actor config: {"platform":"android","avd":"Pixel_9_API_35"}

ios — iOS (XCUITest via Appium 3)
  ● iPhone 16 (iOS 18.6)  [running] — booted
      actor config: {"platform":"ios","udid":"3A5C0D6B-2F1E-4A8B-9C0D-6B2F1E4A8B9C"}
  ○ iPhone 16 Pro (iOS 18.6)  [available]
      actor config: {"platform":"ios","deviceName":"iPhone 16 Pro","platformVersion":"18.6"}

web — Web (WebdriverIO native — no Appium)
  ○ Chrome  [available]
      actor config: {"platform":"web","browser":"chrome"}
  ○ Safari  [available] — max ONE concurrent Safari session per host
      actor config: {"platform":"web","browser":"safari"}

2 running (● reuse these — nothing to boot), 3 available (○ provisioned on demand)
Tip: paste a ● target's actor config into kraken.config.ts to reuse what is already up.
```

## Running versus available

Every target carries one of two states:

| State | Mark | Meaning | Actor config it produces |
|---|---|---|---|
| `running` | `●` | Usable **immediately**: a booted simulator, a running emulator, a connected physical device. | A `udid` pin — the session attaches to that exact target and boots nothing. |
| `available` | `○` | Provisioned **on demand**: an AVD that would be booted, a simulator that would be started, an installed browser that spawns per session. | The provisioning form: `avd` on Android, `deviceName` + `platformVersion` on iOS, `browser` on web. |

Prefer `●` targets. A `udid` pin reuses what is already up, so the run starts stepping immediately instead of paying a cold boot (an emulator boot can take minutes; the Android driver budgets 180 s for it). On iOS a `udid` pin also skips name/version resolution entirely, which is the mechanism behind the ghost-simulator hazard described in [Drivers](/guide/drivers#ios-kraken-e2e-driver-ios) — the `available` iOS lines always pin **both** `deviceName` and `platformVersion` for the same reason: they are the exact pairs that really exist on this host.

## What each driver enumerates

### Android

- `adb devices -l` — everything connected right now: physical devices and running emulators (serials starting with `emulator-`). The device model is read from the adb listing, and for running emulators the backing AVD name is resolved via `adb -s <serial> emu avd name`. These are `running` targets with a `udid` actor config.
- `emulator -list-avds` — AVDs that could be booted on demand. AVDs already running are not listed twice. These are `available` targets with an `avd` actor config and the detail `boots on demand`.

`adb` and `emulator` resolve under `$ANDROID_HOME` (`platform-tools/adb`, `emulator/emulator`), with `ANDROID_SDK_ROOT` and plain `PATH` as fallbacks.

### iOS

- `xcrun simctl list devices --json` — every simulator of every installed iOS runtime. Booted simulators come first as `running` targets with a `udid` actor config (detail `booted`); the rest are `available` targets whose actor config pins `deviceName` **and** `platformVersion`. Unavailable devices and non-iOS runtimes (tvOS, watchOS, visionOS) are skipped. On non-macOS hosts the iOS section is absent (the driver is host-gated off).

### Web

Browsers are always `available` — they spawn per session, so there is nothing to reuse. The value of the listing is showing which `browser` keys are valid on this host:

- **macOS** — probes `/Applications` for Google Chrome, Firefox, Safari and Microsoft Edge. Safari carries the detail `max ONE concurrent Safari session per host`.
- **Linux** — probes `PATH` for `google-chrome`, `chromium` (both map to the `chrome` key; the first found wins) and `firefox`.

## `--json`

`kraken devices --json` emits the same report as machine-readable JSON:

```json
{
  "drivers": [
    {
      "driverId": "android",
      "platformLabel": "Android (UiAutomator2 via Appium 3)",
      "targets": [
        {
          "id": "emulator-5554",
          "name": "Medium_Phone_API_36.0",
          "platform": "android",
          "kind": "emulator",
          "state": "running",
          "actorConfig": { "platform": "android", "udid": "emulator-5554" },
          "detail": "model sdk_gphone64_arm64"
        }
      ]
    }
  ],
  "withoutEnumeration": []
}
```

Each target is a `DeviceTarget`:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable identifier: simulator udid, adb serial, AVD name, or browser key. |
| `name` | `string` | Human name, e.g. `iPhone 16 (iOS 18.6)`, `Pixel_9_API_35`, `Chrome`. |
| `platform` | `string` | The platform id actors bind to (`android`, `ios`, `web`). |
| `kind` | `'device' \| 'emulator' \| 'simulator' \| 'browser'` | What the target physically is. |
| `state` | `'running' \| 'available'` | See [Running versus available](#running-versus-available). |
| `actorConfig` | `object` (optional) | Ready-to-paste actor configuration for `kraken.config.ts`. |
| `detail` | `string` (optional) | Extra context: `booted`, `boots on demand`, device model, Safari's session limit. |

`withoutEnumeration` lists the ids of registered drivers that expose no `listTargets()` capability.

## Flags

| Flag | Effect |
|---|---|
| `--json` | Emit the report as JSON on stdout instead of the text rendering. |
| `--cwd <dir>` | Project directory to load `kraken.config.ts` from (defaults to the current directory). |

::: tip
Run `kraken devices` before editing `kraken.config.ts`. Pasting a `●` target's actor config is both the fastest configuration path and the safest: on iOS it eliminates device-name resolution, and on Android it reuses the emulator you already booted.
:::
