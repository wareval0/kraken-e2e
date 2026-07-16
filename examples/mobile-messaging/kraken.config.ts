import { join } from 'node:path';

import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';
import ios from '@kraken-e2e/driver-ios';

const APPS = join(import.meta.dirname, '../../fixtures/apps');

export default defineConfig({
  actors: {
    alice: {
      platform: 'android',
      avd: process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0',
      app: join(APPS, 'native-demo-app.apk'),
      appPackage: 'com.wdiodemoapp',
    },
    bob: {
      platform: 'ios',
      deviceName: process.env['KRAKEN_IOS_SIM'] ?? 'iPhone 16',
      // Pin the runtime (ADR-0008 D6: unpinned versions spawn ghost simulators).
      platformVersion: process.env['KRAKEN_IOS_VERSION'] ?? '18.6',
      app: join(APPS, 'wdiodemoapp.app'),
      bundleId: 'org.wdiodemoapp',
    },
  },
  drivers: [android(), ios()],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
