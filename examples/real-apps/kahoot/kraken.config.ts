/**
 * Cross-device live Kahoot: a HOST in a real desktop browser and a PLAYER on
 * the installed native Android app play one live game together.
 *
 * This file is named `kraken.config.ts`, so every command works with zero
 * flags from this directory:
 *
 *   npx kraken run              # the whole scenario
 *   npx kraken run --dry-run    # compile + deadlock analysis only
 *   npx kraken inspect host     # click-to-identify on the host's browser
 *   npx kraken inspect player   # …or on the player's device
 *
 * Secrets are layered (see SETUP.md):
 *   .env        shared, non-secret run parameters (KAHOOT_HOME_URL)
 *               — loaded into process.env before this file is evaluated
 *   .env.host   the host's credentials — merged into `host`'s actor.data only
 *   inline      the player's nickname — plain per-actor data in this file
 */
import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';
import web from '@kraken-e2e/driver-web';

export default defineConfig({
  actors: {
    // The quiz host: signs in on kahoot.com and drives the live game.
    host: {
      platform: 'web',
      browser: process.env['KRAKEN_WEB_BROWSER'] ?? 'chrome',
      // The session opens here on boot (value comes from .env).
      baseUrl: process.env['KAHOOT_HOME_URL'] ?? 'https://kahoot.com/',
      // KAHOOT_EMAIL / KAHOOT_PASSWORD land in host.data — never in the repo.
      env: '.env.host',
    },
    // The player: the real Kahoot app, signed in as part of the manual setup.
    // If the emulator is not running, Kraken boots this AVD automatically.
    player: {
      platform: 'android',
      avd: process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0',
      appPackage: 'no.mobitroll.kahoot.android',
      appActivity: '.Default',
      data: { nickname: 'Kraken e2e' },
      capabilities: { 'appium:appWaitActivity': '*', 'appium:noReset': true },
    },
  },
  drivers: [web(), android()],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
  // A visual timeline: every step leaves a screenshot in .kraken/runs/<id>/.
  screenshots: 'per-step',
});
