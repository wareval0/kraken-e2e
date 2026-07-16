/**
 * iOS simulator enumeration for `kraken devices` (contract 2.1). Read-only:
 * `xcrun simctl list devices --json`. Booted simulators come first — pinning
 * one (deviceName + platformVersion, or udid) reuses it and boots nothing.
 *
 * This enumeration is also the antidote to the deviceName/platformVersion
 * trap (ADR-0008 D6): it shows the EXACT (name, version) pairs that really
 * exist, so users never point xcuitest at a device it would silently
 * re-create as a ghost simulator.
 */
import { spawnSync } from 'node:child_process';

import type { DeviceTarget } from '@kraken-e2e/contracts';

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string };

export const spawnRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 15_000 });
  return { status: result.status, stdout: `${result.stdout ?? ''}` };
};

interface SimctlDevice {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
  readonly isAvailable?: boolean;
}

/** 'com.apple.CoreSimulator.SimRuntime.iOS-26-5' → '26.5' (undefined for non-iOS). */
function iosVersionOf(runtimeId: string): string | undefined {
  const match = /SimRuntime\.iOS-(\d+)-(\d+)/.exec(runtimeId);
  return match ? `${match[1]}.${match[2]}` : undefined;
}

export async function listIosTargets(
  run: CommandRunner = spawnRunner,
): Promise<readonly DeviceTarget[]> {
  if (process.platform !== 'darwin') return [];
  const result = run('xcrun', ['simctl', 'list', 'devices', '--json']);
  if (result.status !== 0) return [];

  let parsed: { devices?: Record<string, SimctlDevice[]> };
  try {
    parsed = JSON.parse(result.stdout) as { devices?: Record<string, SimctlDevice[]> };
  } catch {
    return [];
  }

  const targets: DeviceTarget[] = [];
  for (const [runtimeId, devices] of Object.entries(parsed.devices ?? {})) {
    const version = iosVersionOf(runtimeId);
    if (version === undefined) continue; // tvOS/watchOS/visionOS: not xcuitest targets here
    for (const device of devices) {
      if (device.isAvailable === false) continue;
      const booted = device.state === 'Booted';
      targets.push({
        id: device.udid,
        name: `${device.name} (iOS ${version})`,
        platform: 'ios',
        kind: 'simulator',
        state: booted ? 'running' : 'available',
        actorConfig: booted
          ? // udid pins the BOOTED simulator exactly — instant reuse.
            { platform: 'ios', udid: device.udid }
          : // name+version MUST both be pinned (ADR-0008 D6 ghost-sim trap).
            { platform: 'ios', deviceName: device.name, platformVersion: version },
        ...(booted ? { detail: 'booted' } : {}),
      });
    }
  }
  // Booted first — they're the ones worth reusing.
  return targets.sort((a, b) => (a.state === b.state ? 0 : a.state === 'running' ? -1 : 1));
}
