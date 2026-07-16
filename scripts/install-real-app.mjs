#!/usr/bin/env node
/**
 * Install a real Android app onto a connected device/emulator for use as a
 * Kraken test target. Handles both a single `.apk` and an App Bundle exported
 * as a set of split APKs (`.apks` / `.xapk` — a zip of `base.apk` plus
 * `split_*.apk`, which modern Play Store apps ship as).
 *
 * Usage:
 *   node scripts/install-real-app.mjs <path-to.apk|.apks|.xapk> [--serial <adb-serial>]
 *
 * This is the third of the three ways to get a real app onto the device; the
 * other two — installing from the Play Store on the emulator, or with the
 * device already carrying the app — need no script. See
 * examples/real-apps/NATIVE-APPS.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const serialIndex = args.indexOf('--serial');
const serial = serialIndex !== -1 ? args[serialIndex + 1] : undefined;

if (!file || !existsSync(file)) {
  console.error(
    'Usage: node scripts/install-real-app.mjs <path-to.apk|.apks|.xapk> [--serial <adb-serial>]',
  );
  process.exit(1);
}

const ANDROID_HOME = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = ANDROID_HOME ? join(ANDROID_HOME, 'platform-tools', 'adb') : 'adb';

function run(bin, argv, opts = {}) {
  const result = spawnSync(bin, argv, { encoding: 'utf8', ...opts });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const target = serial ? ['-s', serial] : [];

// One connected target required (unless a serial is given).
const devices = run(adb, [...target, 'devices'])
  .out.split('\n')
  .slice(1)
  .filter((l) => /\tdevice$/.test(l));
if (!serial && devices.length !== 1) {
  console.error(
    `Expected exactly one connected device; found ${devices.length}. Pass --serial <serial> (see \`adb devices\`, or \`kraken devices\`).`,
  );
  process.exit(1);
}

const ext = extname(file).toLowerCase();

if (ext === '.apk') {
  console.log(`Installing ${file}…`);
  const { status } = run(adb, [...target, 'install', '-r', '-g', file], { stdio: 'inherit' });
  process.exit(status ?? 0);
}

if (ext === '.apks' || ext === '.xapk' || ext === '.zip') {
  // A split-APK bundle: unzip and install every apk together atomically.
  const dir = mkdtempSync(join(tmpdir(), 'kraken-apks-'));
  console.log(`Unpacking split bundle ${file}…`);
  const unzip = run('unzip', ['-o', '-q', file, '-d', dir]);
  if (unzip.status !== 0) {
    console.error(`Could not unpack the bundle:\n${unzip.out}`);
    process.exit(1);
  }
  const apks = readdirSync(dir)
    .filter((f) => f.endsWith('.apk'))
    .map((f) => join(dir, f));
  if (apks.length === 0) {
    console.error('No .apk files inside the bundle — is this a valid split-APK archive?');
    process.exit(1);
  }
  console.log(`Installing ${apks.length} split(s) with install-multiple…`);
  const { status } = run(adb, [...target, 'install-multiple', '-r', '-g', ...apks], {
    stdio: 'inherit',
  });
  process.exit(status ?? 0);
}

console.error(`Unsupported file type "${ext}". Provide a .apk, .apks or .xapk.`);
process.exit(1);
