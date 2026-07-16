/**
 * The /manifest subpath (ADR-0001 §5.5): ZERO heavy imports. Web automation
 * runs on every OS — no host requirements.
 */
import { CONTRACT_VERSION, type DriverManifest } from '@kraken-e2e/contracts';

export const manifest: DriverManifest = {
  kind: 'kraken-driver',
  id: 'web',
  platforms: ['web'],
  version: '0.0.0',
  contract: CONTRACT_VERSION,
  platformLabel: 'Web (WebdriverIO native — no Appium)',
  setupHints: [
    'Install at least one browser (Chrome recommended; WebdriverIO manages its driver automatically)',
    'Run: kraken doctor',
  ],
};

export default manifest;
