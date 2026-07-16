import { defineConfig } from '../../src/index.ts';

export default defineConfig({
  actors: {
    alice: { platform: 'fake', avd: 'Pixel_8' },
    bob: { platform: 'fake' },
  },
  drivers: ['@kraken-e2e/driver-fake'],
  features: 'scenarios/**/*.feature',
  steps: './steps/index.ts',
});
