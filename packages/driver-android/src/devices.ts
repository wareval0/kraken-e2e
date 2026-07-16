/**
 * Android target enumeration for `kraken devices` (contract 2.1).
 * Read-only probes: `adb devices -l` for what's CONNECTED right now (real
 * devices and running emulators) and `emulator -list-avds` for what could be
 * booted on demand. Never boots anything.
 */
import { execFile, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { type DeviceTarget, KrakenError } from '@kraken-e2e/contracts';

/** Injectable so the enumeration is unit-testable without an Android SDK.
 *  May return synchronously (test fakes) or a promise (the real runner). */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string } | Promise<{ status: number | null; stdout: string }>;

/** Synchronous runner — kept for callers that need it; BLOCKS the event loop. */
export const spawnRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 15_000 });
  return { status: result.status, stdout: `${result.stdout ?? ''}` };
};

/** Default runner: async, so concurrent session boots never freeze the
 *  process while adb/emulator answer (they can take seconds when cold). */
export const asyncRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, [...args], { encoding: 'utf8', timeout: 15_000 }, (error, stdout) =>
      resolve({ status: error ? 1 : 0, stdout: `${stdout ?? ''}` }),
    );
  });

function sdkTool(tool: 'adb' | 'emulator'): string {
  const home = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (!home) return tool; // hope for PATH
  return tool === 'adb' ? join(home, 'platform-tools', 'adb') : join(home, 'emulator', 'emulator');
}

/** `adb -s emulator-5554 emu avd name` → the AVD backing a running emulator. */
async function avdNameOf(run: CommandRunner, serial: string): Promise<string | undefined> {
  const result = await run(sdkTool('adb'), ['-s', serial, 'emu', 'avd', 'name']);
  if (result.status !== 0) return undefined;
  const name = result.stdout.split('\n')[0]?.trim();
  return name && name !== 'OK' ? name : undefined;
}

/** What createSession should aim the Appium capabilities at. */
export interface DeviceSelection {
  /** Pin to this CONNECTED device/emulator. */
  readonly udid?: string;
  /** Boot (or reuse a running emulator of) this AVD. */
  readonly avd?: string;
  /** Human-readable explanation when the selection differs from the config. */
  readonly note?: string;
}

/**
 * Decide which device a session should use — booting an emulator when nothing
 * suitable is running (the "just works" path a laptop needs):
 *
 *  - a configured `udid` that IS connected wins, untouched;
 *  - a configured `udid` that is NOT connected falls back to the configured
 *    `avd` (boot it), else to any other running device, else to booting an
 *    available AVD;
 *  - a configured `avd` reuses a RUNNING emulator of that AVD (pinned by udid)
 *    or boots it;
 *  - nothing configured picks the first running device, else boots the first
 *    available AVD;
 *  - nothing anywhere → a clear, immediate error instead of a 20s Appium
 *    "Could not find a connected Android device".
 *
 * Only acts on POSITIVE knowledge: when device enumeration itself failed
 * (no adb on PATH, sandboxed CI), the configured values pass through untouched
 * so Appium's own resolution still gets its chance.
 */
export function resolveDeviceSelection(
  config: { readonly udid?: string; readonly avd?: string },
  targets: readonly DeviceTarget[],
  probe: { readonly adbOk: boolean; readonly emulatorOk: boolean },
): DeviceSelection {
  if (!probe.adbOk) {
    return {
      ...(config.udid ? { udid: config.udid } : {}),
      ...(config.avd ? { avd: config.avd } : {}),
    };
  }
  const running = targets.filter((t) => t.state === 'running');
  // AVAILABLE AVDs are only knowledge when their enumeration itself worked —
  // a failed `emulator -list-avds` must not be read as "no AVDs exist".
  const available = probe.emulatorOk ? targets.filter((t) => t.state === 'available') : [];

  if (config.udid) {
    if (running.some((t) => t.id === config.udid)) {
      return { udid: config.udid };
    }
    if (config.avd) {
      return {
        avd: config.avd,
        note: `device "${config.udid}" is not connected — booting AVD "${config.avd}" instead`,
      };
    }
    const fallback = running[0];
    if (fallback) {
      return {
        udid: fallback.id,
        note: `device "${config.udid}" is not connected — using running ${fallback.kind} "${fallback.name}" (${fallback.id})`,
      };
    }
    const bootable = available[0];
    if (bootable) {
      return {
        avd: bootable.id,
        note: `device "${config.udid}" is not connected — booting available AVD "${bootable.id}"`,
      };
    }
    throw noDeviceError(
      `the configured device "${config.udid}" is not connected` +
        (probe.emulatorOk ? '' : ' (and AVD enumeration failed)'),
    );
  }

  if (config.avd) {
    // Reuse a running emulator of that AVD (its name is the AVD when resolvable).
    const match = running.find((t) => t.kind === 'emulator' && t.name === config.avd);
    if (match) {
      return {
        udid: match.id,
        note: `AVD "${config.avd}" is already running as ${match.id} — reusing it`,
      };
    }
    return { avd: config.avd };
  }

  const first = running[0];
  if (first) {
    return { udid: first.id, note: `using running ${first.kind} "${first.name}" (${first.id})` };
  }
  const bootable = available[0];
  if (bootable) {
    return { avd: bootable.id, note: `no device connected — booting AVD "${bootable.id}"` };
  }
  throw noDeviceError(
    probe.emulatorOk
      ? 'no Android device is connected and no AVD is available'
      : 'no Android device is connected (and AVD enumeration failed)',
  );
}

function noDeviceError(reason: string): KrakenError {
  return new KrakenError(
    'KRK-DRV-ANDROID-NO-DEVICE',
    `Cannot create the Android session: ${reason}.`,
    {
      fix:
        'Start an emulator (or plug in a device with USB debugging), create an AVD in Android Studio, ' +
        'or set `avd`/`udid` on the actor in kraken.config.ts. `kraken devices` lists what this machine has.',
    },
  );
}

export async function listAndroidTargets(
  run: CommandRunner = asyncRunner,
): Promise<readonly DeviceTarget[]> {
  return (await probeAndroidTargets(run)).targets;
}

/** Target enumeration plus whether adb itself answered (drives resolveDeviceSelection). */
export async function probeAndroidTargets(run: CommandRunner = asyncRunner): Promise<{
  readonly targets: readonly DeviceTarget[];
  readonly adbOk: boolean;
  readonly emulatorOk: boolean;
}> {
  const targets: DeviceTarget[] = [];
  const runningAvds = new Set<string>();

  // 1 — connected right now (devices + running emulators)
  const adb = await run(sdkTool('adb'), ['devices', '-l']);
  const adbOk = adb.status === 0;
  if (adb.status === 0) {
    for (const line of adb.stdout.split('\n').slice(1)) {
      const match = /^(\S+)\s+device\b(.*)$/.exec(line.trim());
      if (!match || match[1] === undefined) continue;
      const serial = match[1];
      const isEmulator = serial.startsWith('emulator-');
      const model = /model:(\S+)/.exec(match[2] ?? '')?.[1];
      const avd = isEmulator ? await avdNameOf(run, serial) : undefined;
      if (avd) runningAvds.add(avd);
      targets.push({
        id: serial,
        name: avd ?? model ?? serial,
        platform: 'android',
        kind: isEmulator ? 'emulator' : 'device',
        state: 'running',
        // udid pins THIS device — reuses the already-running one, boots nothing.
        actorConfig: { platform: 'android', udid: serial },
        ...(model ? { detail: `model ${model}` } : {}),
      });
    }
  }

  // 2 — AVDs bootable on demand (skip ones already running)
  const avds = await run(sdkTool('emulator'), ['-list-avds']);
  if (avds.status === 0) {
    for (const line of avds.stdout.split('\n')) {
      const name = line.trim();
      // emulator prints INFO chatter on some setups; AVD names have no spaces
      if (!name || name.includes(' ') || runningAvds.has(name)) continue;
      targets.push({
        id: name,
        name,
        platform: 'android',
        kind: 'emulator',
        state: 'available',
        actorConfig: { platform: 'android', avd: name },
        detail: 'boots on demand',
      });
    }
  }

  return { targets, adbOk, emulatorOk: avds.status === 0 };
}
