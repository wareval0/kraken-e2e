/**
 * @kraken-e2e/driver-web — web driver (WebdriverIO native, ADR-0009).
 *
 * NO Appium: sessions go straight through webdriverio remote(), which manages
 * browser drivers (chromedriver/geckodriver/safaridriver) automatically.
 * BiDi is WDIO's default for Chrome/Edge/Firefox (progressive enhancement);
 * Safari runs classic WebDriver (ADR-0001 §5.6).
 * IMPORT-SAFETY RULE (§5.5): webdriverio loads dynamically in createSession().
 */
import { join } from 'node:path';

import { defineDriver } from '@kraken-e2e/contracts';

import { listWebTargets } from './devices.js';
import { webDoctorChecks } from './doctor.js';
import { manifest } from './manifest.js';
import { type WdioBrowserLike, WebUserSession } from './wdio-session.js';

export interface WebDriverOptions {
  /** Default browser for actors that don't specify one. Default 'chrome'. */
  readonly browser?: 'chrome' | 'firefox' | 'safari' | 'edge' | (string & {});
  /** Run browsers headless (default false — choreography is worth watching). */
  readonly headless?: boolean;
  /** Extra capabilities merged into every session. */
  readonly capabilities?: Readonly<Record<string, unknown>>;
}

const BROWSER_NAMES: Record<string, string> = {
  chrome: 'chrome',
  firefox: 'firefox',
  safari: 'safari',
  edge: 'MicrosoftEdge',
};

export const web = defineDriver<WebDriverOptions>((opts = {}) => {
  let startedProjectRoot: string | undefined;
  return {
    manifest,
    doctor: webDoctorChecks(),

    async start(host) {
      // Nothing to boot: WDIO spawns/manages the browser driver per session.
      startedProjectRoot = host.projectRoot ?? process.cwd();
    },

    async listTargets() {
      return listWebTargets();
    },

    async createSession(actor, services) {
      const config = actor.config;
      const browserKey = String(config['browser'] ?? opts.browser ?? 'chrome');
      const browserName = BROWSER_NAMES[browserKey] ?? browserKey;
      const headless = (config['headless'] as boolean | undefined) ?? opts.headless ?? false;

      const capabilities: Record<string, unknown> = {
        browserName,
        // Force classic WebDriver (opt out via capabilities). WDIO defaults to
        // BiDi for Chrome/Edge/Firefox, but BiDi's browsingContext calls
        // (getTree — used to enumerate frames/tabs, and screenshots) HANG on
        // heavy SPAs and take the process down. Classic is stable and covers
        // every Kraken op, including the frame/tab-aware element resolution.
        'wdio:enforceWebDriverClassic': true,
        ...(browserName === 'chrome' && headless
          ? { 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1280,900'] } }
          : {}),
        ...(browserName === 'firefox' && headless
          ? { 'moz:firefoxOptions': { args: ['-headless'] } }
          : {}),
        ...opts.capabilities,
        ...(typeof config['capabilities'] === 'object' && config['capabilities'] !== null
          ? (config['capabilities'] as Record<string, unknown>)
          : {}),
      };

      services.logger.info('creating web session', { actor: actor.id, browserName, headless });
      const { remote } = await import('webdriverio');
      const browser = await remote({
        capabilities: capabilities as never,
        logLevel: 'error',
        // Project-local driver cache: WDIO's default is the OS tmpdir, where a
        // single interrupted download leaves a corrupted folder that breaks
        // every later run on the machine (observed live: chromedriver folder
        // present, executable missing, all retries failing). A per-project dir
        // is trivially inspectable and deletable: rm -rf .kraken/browser-cache
        cacheDir: join(startedProjectRoot ?? process.cwd(), '.kraken', 'browser-cache'),
      });
      const session = new WebUserSession(browser as unknown as WdioBrowserLike, actor, services);
      const baseUrl = config['baseUrl'];
      if (typeof baseUrl === 'string') {
        await session.navigate(baseUrl);
      }
      return session;
    },

    async stop() {
      // Session-scoped teardown only; nothing shared to close.
    },
  };
});

export default web;
export { webDoctorChecks } from './doctor.js';
export { toWebSelector, WEB_KEY_CODES } from './locators.js';
export { manifest } from './manifest.js';
export { WebUserSession } from './wdio-session.js';
