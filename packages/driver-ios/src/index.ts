/**
 * @kraken-e2e/driver-ios — iOS driver (Appium 3 + XCUITest, ADR-0008).
 *
 * macOS-ONLY at runtime (Apple platform restriction — enforced by the
 * registry via /manifest hostRequirements, C4b). IMPORT-SAFETY RULE
 * (ADR-0001 §5.5): this entry must still be importable on every host —
 * appium and webdriverio load DYNAMICALLY inside start()/createSession().
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { defineDriver, KrakenError } from '@kraken-e2e/contracts';

import { type AppiumServerHandle, allocatePort, startAppiumServer } from './appium-server.js';
import { listIosTargets } from './devices.js';
import { iosDoctorChecks } from './doctor.js';
import { manifest } from './manifest.js';
import { IosUserSession, type WdioBrowserLike } from './wdio-session.js';

export interface IosDriverOptions {
  /** Default simulator for actors without a device (appium:deviceName). */
  readonly deviceName?: string;
  /** Default appium:platformVersion (e.g. '18.6'). */
  readonly platformVersion?: string;
  /**
   * Prebuilt WebDriverAgent .app for simulators (appium:prebuiltWDAPath +
   * usePreinstalledWDA — requires iOS 17+). Skips the slow first-session
   * xcodebuild. Fetch one with: appium driver run xcuitest download-wda.
   */
  readonly prebuiltWDAPath?: string;
  /** Appium 3 scoped insecure features. */
  readonly allowInsecure?: readonly string[];
  /** Extra capabilities merged into every session. */
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

export const ios = defineDriver<IosDriverOptions>((opts = {}) => {
  let server: AppiumServerHandle | undefined;
  let startedProjectRoot: string | undefined;

  return {
    manifest,
    doctor: iosDoctorChecks(),

    async listTargets() {
      return listIosTargets();
    },

    async start(host, services) {
      if (server) {
        // Double start would silently leak the first embedded server.
        throw new Error('driver-ios: already started — call stop() first.');
      }
      const projectRoot = host.projectRoot ?? process.cwd();
      startedProjectRoot = projectRoot;
      server = await startAppiumServer({
        homeDir: join(projectRoot, '.kraken', 'appium', 'ios-home'),
        driverPackages: ['appium-xcuitest-driver'],
        logFile: join(services.artifactsDir, 'appium-ios.log'),
        logger: services.logger,
        ...(opts.allowInsecure !== undefined ? { allowInsecure: opts.allowInsecure } : {}),
      });
    },

    async createSession(actor, services) {
      if (!server) {
        throw new Error('driver-ios: start() must run before createSession().');
      }
      const config = actor.config;
      const appPath = resolveAppPath(config, startedProjectRoot ?? process.cwd(), actor.id);
      // OS-assigned free ports (see driver-android note: fixed-base counters
      // collide across concurrent runs on one machine).
      const wdaLocalPort = await allocatePort();
      const mjpegServerPort = await allocatePort();

      const prebuiltWDAPath =
        typeof config['prebuiltWDAPath'] === 'string'
          ? config['prebuiltWDAPath']
          : opts.prebuiltWDAPath;

      const capabilities: Record<string, unknown> = {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:wdaLocalPort': wdaLocalPort,
        'appium:mjpegServerPort': mjpegServerPort,
        'appium:newCommandTimeout': 300,
        // First-session xcodebuild of WDA can take minutes on a laptop.
        'appium:wdaLaunchTimeout': 120_000,
        'appium:deviceName':
          (config['deviceName'] as string | undefined) ?? opts.deviceName ?? 'iPhone 16',
        ...(typeof config['platformVersion'] === 'string' || opts.platformVersion !== undefined
          ? {
              'appium:platformVersion':
                (config['platformVersion'] as string | undefined) ?? opts.platformVersion,
            }
          : {}),
        ...(typeof config['udid'] === 'string' ? { 'appium:udid': config['udid'] } : {}),
        ...(appPath !== undefined ? { 'appium:app': appPath } : {}),
        ...(typeof config['bundleId'] === 'string'
          ? { 'appium:bundleId': config['bundleId'] }
          : {}),
        ...(prebuiltWDAPath !== undefined
          ? { 'appium:usePreinstalledWDA': true, 'appium:prebuiltWDAPath': prebuiltWDAPath }
          : {}),
        ...opts.capabilities,
        ...(typeof config['capabilities'] === 'object' && config['capabilities'] !== null
          ? (config['capabilities'] as Record<string, unknown>)
          : {}),
      };

      services.logger.info('creating iOS session', { actor: actor.id, wdaLocalPort });
      const { remote } = await import('webdriverio');
      const browser = await remote({
        hostname: '127.0.0.1',
        port: server.port,
        capabilities: capabilities as never,
        logLevel: 'error',
        connectionRetryTimeout: 300_000,
        connectionRetryCount: 1,
      });
      return new IosUserSession(browser as unknown as WdioBrowserLike, actor, services);
    },

    async stop() {
      await server?.close();
      server = undefined;
    },
  };
});

export default ios;
export { allocatePort, prepareAppiumHome, startAppiumServer } from './appium-server.js';
export { iosDoctorChecks } from './doctor.js';
export { toIosSelector } from './locators.js';
export { manifest } from './manifest.js';
export { IosUserSession } from './wdio-session.js';
