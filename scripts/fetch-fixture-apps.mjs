/**
 * Downloads the CTK fixture app (webdriverio/native-demo-app, EXACT-PINNED)
 * into fixtures/apps/ (gitignored), verifying sha256 against the digests
 * recorded here (which were verified against GitHub's published digests —
 * ADR-0007/0008 research, 2026-07-03). Idempotent: skips valid files.
 *
 * Usage: node scripts/fetch-fixture-apps.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.2.0';
const ASSETS = [
  {
    name: `android.wdio.native.app.v${VERSION}.apk`,
    sha256: 'fe1d605ce099c73d93f33e5cbcb0df0bea437ce57aaaaf156b3b0fa1ca54931d',
    target: 'native-demo-app.apk',
  },
  {
    name: `ios.simulator.wdio.native.app.v${VERSION}.zip`,
    sha256: '84c7efda441f7a8ed37bb1527bae357de8a44a16f878996d52bdfd9d58a8c66a',
    target: 'native-demo-app-ios.zip',
    unzipTo: 'wdiodemoapp.app',
  },
];
const BASE = `https://github.com/webdriverio/native-demo-app/releases/download/v${VERSION}`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = join(root, 'fixtures', 'apps');
mkdirSync(appsDir, { recursive: true });

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

for (const asset of ASSETS) {
  const targetPath = join(appsDir, asset.target);
  if (existsSync(targetPath) && digest(targetPath) === asset.sha256) {
    console.log(`ok (cached): ${asset.target}`);
  } else {
    console.log(`downloading ${asset.name}…`);
    const response = await fetch(`${BASE}/${asset.name}`, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${asset.name}: HTTP ${response.status}`);
    writeFileSync(targetPath, Buffer.from(await response.arrayBuffer()));
    const actual = digest(targetPath);
    if (actual !== asset.sha256) {
      rmSync(targetPath);
      throw new Error(`${asset.name}: sha256 mismatch (${actual}) — refusing to keep it.`);
    }
    console.log(`verified: ${asset.target}`);
  }
  if (asset.unzipTo) {
    const appPath = join(appsDir, asset.unzipTo);
    if (!existsSync(appPath)) {
      execFileSync('unzip', ['-oq', targetPath, '-d', appsDir]);
      console.log(`unzipped: ${asset.unzipTo}`);
    }
  }
}
console.log(`fixture apps ready at ${appsDir}`);
