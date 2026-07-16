/** Seeded monkey testing as a BDD scenario (Android). */
import { join } from 'node:path';

import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';

const APPS = join(import.meta.dirname, '../../fixtures/apps');

export default defineConfig({
  actors: {
    alice: {
      platform: 'android',
      avd: process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0',
      app: join(APPS, 'native-demo-app.apk'),
      appPackage: 'com.wdiodemoapp',
    },
  },
  drivers: [android()],
  features: 'features/monkey/**/*.feature',
  steps: './steps/index.ts',
});
