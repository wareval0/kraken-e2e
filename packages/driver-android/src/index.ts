/**
 * @kraken-e2e/driver-android — Android driver (Appium 3 + UiAutomator2, ADR-0007).
 *
 * IMPORT-SAFETY RULE (ADR-0001 §5.5): this entry must be importable on every
 * host — appium and webdriverio load DYNAMICALLY inside start()/createSession().
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { defineDriver, KrakenError } from '@kraken-e2e/contracts';

import { type AppiumServerHandle, allocatePort, startAppiumServer } from './appium-server.js';
import {
  type DeviceSelection,
  listAndroidTargets,
  probeAndroidTargets,
  resolveDeviceSelection,
} from './devices.js';
import { androidDoctorChecks } from './doctor.js';
import { manifest } from './manifest.js';
import { AndroidUserSession, type WdioBrowserLike } from './wdio-session.js';

export interface AndroidDriverOptions {
  /** Default AVD to boot for actors that don't specify a device (appium:avd). */
  readonly avd?: string;
  /** Appium 3 scoped insecure features, e.g. ['uiautomator2:adb_shell']. */
  readonly allowInsecure?: readonly string[];
  /** Extra capabilities merged into every session (appium:* keys included). */
  readonly capabilities?: Readonly<Record<string, unknown>>;
}

/**
 * Fail-fast app validation: a missing app file must die HERE, in
 * milliseconds, with an actionable message — not after minutes of
 * emulator/simulator boot inside an Appium session error (observed live
 * following the tutorial with placeholder paths).
 */
function resolveAppPath(
  config: Readonly<Record<string, unknown>>,
  projectRoot: string,
  actorId: string,
): string | undefined {
  if (typeof config['app'] !== 'string') return undefined;
  const resolved = isAbsolute(config['app']) ? config['app'] : resolve(projectRoot, config['app']);
  if (!existsSync(resolved)) {
    throw new KrakenError(
      'KRK-DRIVER-APP-NOT-FOUND',
      `Actor "${actorId}": the app file does not exist: ${resolved}`,
      {
        fix:
          'Check the `app` path in kraken.config.ts (relative paths resolve against the project root). ' +
          'Need a test app? The WebdriverIO native-demo-app works out of the box — see the Kraken tutorial, ' +
          'or run `kraken devices` to see what you already have.',
      },
    );
  }
  return resolved;
}

export const android = defineDriver<AndroidDriverOptions>((opts = {}) => {
  let server: AppiumServerHandle | undefined;
  let startedProjectRoot: string | undefined;

  return {
    manifest,
    doctor: androidDoctorChecks(),

    async listTargets() {
      return listAndroidTargets();
    },

    async start(host, services) {
      if (server) {
        // Double start would silently leak the first embedded server.
        throw new Error('driver-android: already started — call stop() first.');
      }
      const projectRoot = host.projectRoot ?? process.cwd();
      startedProjectRoot = projectRoot;
      server = await startAppiumServer({
        homeDir: join(projectRoot, '.kraken', 'appium', 'android-home'),
        driverPackages: ['appium-uiautomator2-driver'],
        logFile: join(services.artifactsDir, 'appium-android.log'),
        logger: services.logger,
        ...(opts.allowInsecure !== undefined ? { allowInsecure: opts.allowInsecure } : {}),
      });
    },

    async createSession(actor, services) {
      if (!server) {
        throw new Error('driver-android: start() must run before createSession().');
      }
      const config = actor.config;
      const appPath = resolveAppPath(config, startedProjectRoot ?? process.cwd(), actor.id);
      // OS-assigned free port: process-local counters over a fixed base collide
      // across CONCURRENT kraken runs on one machine (uia2 accepts any port).
      const systemPort = await allocatePort();

      // Resolve the device BEFORE Appium: a configured udid that is not
      // connected falls back to booting an AVD (or another running device), and
      // "no device anywhere" dies here with an actionable message instead of a
      // 20s Appium "Could not find a connected Android device".
      //
      // The raw `capabilities` escape hatch is the STRONGEST user intent: when
      // it pins a device (appium:udid/appium:avd) or points at a remote adb
      // server, resolution steps aside entirely — Appium gets the capabilities
      // verbatim, exactly as documented ("capabilities merge last").
      const rawCaps = {
        ...opts.capabilities,
        ...(typeof config['capabilities'] === 'object' && config['capabilities'] !== null
          ? (config['capabilities'] as Record<string, unknown>)
          : {}),
      };
      const capsPinDevice =
        'appium:udid' in rawCaps || 'appium:avd' in rawCaps || 'appium:remoteAdbHost' in rawCaps;
      let selection: DeviceSelection = {
        ...(typeof config['udid'] === 'string' ? { udid: config['udid'] } : {}),
        ...(typeof config['avd'] === 'string'
          ? { avd: config['avd'] }
          : opts.avd !== undefined
            ? { avd: opts.avd }
            : {}),
      };
      if (!capsPinDevice) {
        const probe = await probeAndroidTargets();
        selection = resolveDeviceSelection(selection, probe.targets, probe);
        if (selection.note) {
          services.logger.info(selection.note, { actor: actor.id });
        }
      }

      const capabilities: Record<string, unknown> = {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:systemPort': systemPort,
        'appium:newCommandTimeout': 300,
        // Cold emulator boots on a laptop take a while — be generous.
        'appium:avdLaunchTimeout': 180_000,
        'appium:avdReadyTimeout': 180_000,
        'appium:adbExecTimeout': 60_000,
        // Laptop-class default: the 20s upstream default flakes on loaded
        // machines (observed live: server-APK install timeout mid-demo).
        'appium:uiautomator2ServerInstallTimeout': 120_000,
        // Don't block every command waiting for the UI to go idle. Modern apps
        // animate continuously (progress rings, transitions, Compose
        // recomposition), so a never-idle screen makes each find/displayed/click
        // stall for the full idle window — observed at 20-30s per command on an
        // animated results screen. A short cap keeps commands responsive;
        // explicit waitFor polling still absorbs mid-transition misses.
        'appium:waitForIdleTimeout': 100,
        ...(selection.udid !== undefined ? { 'appium:udid': selection.udid } : {}),
        ...(selection.avd !== undefined ? { 'appium:avd': selection.avd } : {}),
        ...(appPath !== undefined ? { 'appium:app': appPath } : {}),
        ...(typeof config['appPackage'] === 'string'
          ? { 'appium:appPackage': config['appPackage'] }
          : {}),
        ...(typeof config['appActivity'] === 'string'
          ? { 'appium:appActivity': config['appActivity'] }
          : {}),
        ...opts.capabilities,
        ...(typeof config['capabilities'] === 'object' && config['capabilities'] !== null
          ? (config['capabilities'] as Record<string, unknown>)
          : {}),
      };

      services.logger.info('creating Android session', { actor: actor.id, systemPort });
      // Import-safety rule: webdriverio loads here, not at the top level.
      const { remote } = await import('webdriverio');
      const browser = await remote({
        hostname: '127.0.0.1',
        port: server.port,
        capabilities: capabilities as never,
        logLevel: 'error',
        connectionRetryTimeout: 300_000,
        connectionRetryCount: 1,
      });
      const appPackage =
        typeof capabilities['appium:appPackage'] === 'string'
          ? capabilities['appium:appPackage']
          : undefined;
      return new AndroidUserSession(
        browser as unknown as WdioBrowserLike,
        actor,
        services,
        appPackage,
      );
    },

    async stop() {
      await server?.close();
      server = undefined;
    },
  };
});

export default android;
export { allocatePort, prepareAppiumHome, startAppiumServer } from './appium-server.js';
export {
  type DeviceSelection,
  listAndroidTargets,
  probeAndroidTargets,
  resolveDeviceSelection,
} from './devices.js';
export { androidDoctorChecks } from './doctor.js';
export { keyCodeFor, toAndroidSelector } from './locators.js';
export { manifest } from './manifest.js';
export { AndroidUserSession } from './wdio-session.js';
