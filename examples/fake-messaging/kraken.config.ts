import { defineConfig } from '@kraken-e2e/config';
import { createFakeDriver } from '@kraken-e2e/core/testing';

import { createMessagingWorld } from './world.js';

// One shared world = the fake "backend" all three actors talk through.
const world = createMessagingWorld();

export default defineConfig({
  actors: {
    // In Phase 2/3 these become { platform: 'android' | 'ios' | 'web' } with
    // real driver options — the feature file and steps stay unchanged.
    alice: { platform: 'android-fake' },
    bob: { platform: 'ios-fake' },
    carol: { platform: 'web-fake' },
  },
  drivers: [
    createFakeDriver({
      world,
      id: 'fake',
      platforms: ['android-fake', 'ios-fake', 'web-fake'],
    }),
  ],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
