/**
 * The /manifest subpath (ADR-0001 §5.5): ZERO heavy imports — on non-macOS
 * hosts the registry reads THIS and hard-disables the driver with an explicit
 * message; the main entry (and its Appium/Xcode-touching dependencies) is
 * never imported there. NOTE: this package must NEVER set npm's "os" field —
 * it would break `pnpm install` for non-mac teammates sharing the lockfile
 * (ADR-0001 §5.10).
 */
import { CONTRACT_VERSION, type DriverManifest } from '@kraken-e2e/contracts';

export const manifest: DriverManifest = {
  kind: 'kraken-driver',
  id: 'ios',
  platforms: ['ios'],
  version: '0.0.0',
  contract: CONTRACT_VERSION,
  platformLabel: 'iOS (XCUITest via Appium 3)',
  hostRequirements: { platforms: ['darwin'] },
  disabledFix:
    'The iOS driver requires macOS: XCUITest and WebDriverAgent are Apple platform ' +
    'restrictions, not a Kraken limitation. Android and Web drivers work on this host.',
  setupHints: [
    'Install Xcode (16+ / 26.x recommended) and an iOS simulator runtime',
    'Run: kraken doctor',
  ],
};

export default manifest;
