/**
 * The /manifest subpath (ADR-0001 §5.5): ZERO heavy imports — the registry
 * host-gates string-form registrations by importing THIS module before the
 * main entry ever loads. Keep it dependency-light forever.
 */
import { CONTRACT_VERSION, type DriverManifest } from '@kraken-e2e/contracts';

export const manifest: DriverManifest = {
  kind: 'kraken-driver',
  id: 'android',
  platforms: ['android'],
  version: '0.0.0',
  contract: CONTRACT_VERSION,
  platformLabel: 'Android (UiAutomator2 via Appium 3)',
  // No hostRequirements: Android automation runs on macOS, Linux and Windows.
  setupHints: [
    'Install the Android SDK and set ANDROID_HOME',
    'Install a JDK (17+) and set JAVA_HOME',
    'Create an arm64-v8a AVD at API 26+ (on Apple Silicon) or connect a device',
    'Run: kraken doctor',
  ],
};

export default manifest;
