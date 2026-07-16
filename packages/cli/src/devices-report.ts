/**
 * `kraken devices` (contract 2.1): show what you can ALREADY drive — booted
 * simulators, running emulators, connected devices, installed browsers —
 * with ready-to-paste actor config for each. Use what you have; provision
 * only when you have nothing.
 */
import { loadConfig } from '@kraken-e2e/config';
import type { DeviceTarget } from '@kraken-e2e/contracts';
import {
  createHostContext,
  type DriverRegistration,
  DriverRegistry,
  systemHostProbe,
} from '@kraken-e2e/core';

export interface DevicesReport {
  readonly drivers: ReadonlyArray<{
    readonly driverId: string;
    readonly platformLabel: string;
    readonly targets: readonly DeviceTarget[];
  }>;
  /** Drivers that are registered but expose no enumeration (older contract). */
  readonly withoutEnumeration: readonly string[];
}

export async function buildDevicesReport(options: { cwd?: string }): Promise<DevicesReport> {
  const host = systemHostProbe.detect();
  const config = await loadConfig({ ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
  const registry = await DriverRegistry.create({
    registrations: config.drivers as readonly DriverRegistration[],
    host,
    projectRoot: config.projectRoot,
  });

  const drivers: Array<DevicesReport['drivers'][number]> = [];
  const withoutEnumeration: string[] = [];
  const hostContext = createHostContext(host, config.projectRoot);

  for (const driver of registry.readyDrivers()) {
    if (typeof driver.listTargets !== 'function') {
      withoutEnumeration.push(driver.manifest.id);
      continue;
    }
    drivers.push({
      driverId: driver.manifest.id,
      platformLabel: driver.manifest.platformLabel,
      targets: await driver.listTargets(hostContext),
    });
  }
  return { drivers, withoutEnumeration };
}

export function renderDevicesText(report: DevicesReport): string {
  const lines: string[] = [];
  let running = 0;
  let available = 0;

  for (const entry of report.drivers) {
    lines.push(`${entry.driverId} — ${entry.platformLabel}`);
    if (entry.targets.length === 0) {
      lines.push('  (no targets found)');
      continue;
    }
    for (const target of entry.targets) {
      const mark = target.state === 'running' ? '●' : '○';
      if (target.state === 'running') running += 1;
      else available += 1;
      const detail = target.detail ? ` — ${target.detail}` : '';
      lines.push(`  ${mark} ${target.name}  [${target.state}]${detail}`);
      if (target.actorConfig) {
        lines.push(`      actor config: ${JSON.stringify(target.actorConfig)}`);
      }
    }
    lines.push('');
  }

  for (const id of report.withoutEnumeration) {
    lines.push(`${id} — (driver does not support device enumeration)`);
  }

  lines.push(
    `${running} running (● reuse these — nothing to boot), ${available} available (○ provisioned on demand)`,
  );
  if (running > 0) {
    lines.push(
      "Tip: paste a ● target's actor config into kraken.config.ts to reuse what is already up.",
    );
  }
  return lines.join('\n');
}
