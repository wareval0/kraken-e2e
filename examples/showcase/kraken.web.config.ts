/** One of three: a single-user checkout on the REAL public saucedemo.com. */
import { defineConfig } from '@kraken-e2e/config';
import web from '@kraken-e2e/driver-web';

export default defineConfig({
  actors: {
    carol: { platform: 'web', browser: process.env['KRAKEN_WEB_BROWSER'] ?? 'chrome' },
  },
  drivers: [web()],
  features: 'features/solo/web-*.feature',
  steps: './steps/index.ts',
});
