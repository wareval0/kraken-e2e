import { join } from 'node:path';

import { loadConfig } from '@kraken-e2e/config';
import {
  createHostContext,
  type DriverRegistration,
  DriverRegistry,
  systemHostProbe,
} from '@kraken-e2e/core';
import { Args, Command, Flags } from '@oclif/core';

import { startInspect } from '../inspect/server.js';

export default class Inspect extends Command {
  static override description =
    "Mirror an actor's live screen in the browser and click elements to discover their identifiers, ranked Kraken locators and ready-to-paste Screen Object methods.";

  static override examples = [
    '<%= config.bin %> inspect alice',
    '<%= config.bin %> inspect bob --port 4600',
  ];

  static override args = {
    actor: Args.string({
      description: 'the configured actor whose session to inspect',
      required: true,
    }),
  };

  static override flags = {
    config: Flags.string({ char: 'c', description: 'path to kraken.config.ts' }),
    port: Flags.integer({ description: 'inspector port (default: OS-assigned)', default: 0 }),
    host: Flags.string({ description: 'bind host', default: '127.0.0.1' }),
    headless: Flags.boolean({
      description:
        'web only: run the browser headless so tapping does not steal focus from the mirror',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Inspect);
    const host = systemHostProbe.detect();
    const config = await loadConfig({
      ...(flags.config !== undefined ? { configPath: flags.config } : {}),
    });
    const actorConfig = config.actors[args.actor];
    if (!actorConfig) {
      this.error(
        `Actor "${args.actor}" is not declared in the config. Declared actors: ${Object.keys(config.actors).join(', ')}.`,
      );
    }

    const registry = await DriverRegistry.create({
      registrations: config.drivers as readonly DriverRegistration[],
      host,
      projectRoot: config.projectRoot,
    });
    const driver = registry.driverFor(actorConfig.platform);
    const artifactsDir = join(config.projectRoot, '.kraken', 'inspect');
    const services = {
      runId: `inspect-${Date.now()}`,
      logger: {
        debug: () => {},
        info: (message: string) => this.log(`  ${message}`),
        warn: (message: string) => this.log(`  ! ${message}`),
        error: (message: string) => this.log(`  ✗ ${message}`),
      },
      artifactsDir,
      abort: new AbortController().signal,
      emit: () => {},
    };

    // A stray WebDriver command rejection (e.g. a BiDi timeout) must never take
    // the inspector process down — log it and keep serving.
    const onUnhandled = (reason: unknown): void =>
      this.log(`  ! ${reason instanceof Error ? reason.message : String(reason)} (ignored)`);
    process.on('unhandledRejection', onUnhandled);

    this.log(`Booting a ${actorConfig.platform} session for "${args.actor}"…`);
    await driver.start(createHostContext(host, config.projectRoot), services);
    const existingCaps = actorConfig['capabilities'] as Record<string, unknown> | undefined;
    let sessionConfig: typeof actorConfig;
    if (actorConfig.platform === 'web') {
      // Force classic WebDriver — BiDi's browsingContext calls (getTree,
      // screenshots) intermittently hang on heavy SPAs, and classic is more
      // stable for the screenshot/evaluate loop. Optionally headless so a tap
      // does not raise the browser window over the mirror.
      sessionConfig = {
        ...actorConfig,
        ...(flags.headless ? { headless: true } : {}),
        capabilities: { ...existingCaps, 'wdio:enforceWebDriverClassic': true },
      };
      if (!flags.headless)
        this.log('  tip: pass --headless so tapping does not steal focus from the mirror.');
    } else {
      // Mobile: disable Appium's idle-session reaper. The inspector is
      // interactive with long gaps between commands; the default
      // newCommandTimeout (300s) would terminate the session while you think.
      sessionConfig = {
        ...actorConfig,
        capabilities: { ...existingCaps, 'appium:newCommandTimeout': 0 },
      };
    }
    const session = await driver.createSession(
      { id: args.actor, platform: actorConfig.platform, config: sessionConfig as never },
      services,
    );

    const platformHint =
      actorConfig.platform === 'android' ||
      actorConfig.platform === 'ios' ||
      actorConfig.platform === 'web'
        ? actorConfig.platform
        : 'auto';
    const handle = await startInspect({
      session,
      platform: platformHint,
      port: flags.port,
      host: flags.host,
      log: (line) => this.log(line),
    });
    this.log(`Inspector: ${handle.url} — Ctrl-C to stop.`);

    await new Promise<void>((resolve) => {
      let shuttingDown = false;
      // Dispose on either signal — with newCommandTimeout:0 the mobile session
      // never self-reaps, so a leaked session would linger until the (embedded)
      // Appium server dies.
      const shutdown = (): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        this.log('\nShutting down…');
        void (async () => {
          await handle.close().catch(() => {});
          await session.dispose().catch(() => {});
          await driver.stop().catch(() => {});
          resolve();
        })();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    this.exit(0);
  }
}
