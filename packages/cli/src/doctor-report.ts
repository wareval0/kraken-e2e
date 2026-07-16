/**
 * The `kraken doctor` pipeline (ADR-0001 §5.13 composition): the CLI — the
 * composition layer — injects HostContext (from core's probe), driver gate
 * statuses (from core's registry), and driver-contributed checks into the
 * pure @kraken-e2e/doctor engine.
 */
import { loadConfig } from '@kraken-e2e/config';
import {
  createHostContext,
  type DriverRegistration,
  DriverRegistry,
  type DriverStatus,
  systemHostProbe,
} from '@kraken-e2e/core';
import {
  builtInChecks,
  type DoctorReport,
  type DriverGateStatus,
  driverGateChecks,
  runDoctor,
} from '@kraken-e2e/doctor';

function toGateStatus(status: DriverStatus): DriverGateStatus {
  switch (status.state) {
    case 'ready':
      return { driverId: status.driver.manifest.id, state: 'ready' };
    case 'unavailable-on-host':
      return {
        driverId: status.manifest.id,
        state: 'unavailable-on-host',
        detail: status.reason,
        fix: status.fix,
      };
    case 'incompatible':
      return {
        driverId: status.id,
        state: 'incompatible',
        detail: `built against contract ${status.found.major}.${status.found.minor}, host supports ${status.supported.major}.${status.supported.minor}`,
        fix: status.fix,
      };
    case 'invalid':
      return { driverId: status.ref, state: 'invalid', detail: status.problems.join('; ') };
  }
}

export async function buildDoctorReport(options: { cwd?: string }): Promise<DoctorReport> {
  const host = systemHostProbe.detect();
  const checks = [...builtInChecks()];

  // Config is optional for doctor: without a project we still report the host.
  try {
    const config = await loadConfig({ ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) });
    const registry = await DriverRegistry.create({
      registrations: config.drivers as readonly DriverRegistration[],
      host,
      projectRoot: config.projectRoot,
    });
    checks.push(...driverGateChecks(registry.statuses().map(toGateStatus)));
    for (const driver of registry.readyDrivers()) {
      checks.push(...(driver.doctor ?? []));
    }
    return runDoctor({ host: createHostContext(host, config.projectRoot), checks });
  } catch {
    // No project found — run the host-level checks only.
    return runDoctor({ host: createHostContext(host), checks });
  }
}
