/**
 * `kraken plugins install` (ADR-0001 §5.10/D15, ADR-0005): Kraken OWNS the
 * plugins topic. Drivers are exact-pinned project devDependencies — installed
 * by the project's own package manager, validated against the contract, and
 * registered in kraken.config.ts. @oclif/plugin-plugins is deliberately not
 * used (per-user dataDir state outside the lockfile).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findConfigPath } from '@kraken-e2e/config';
import {
  CONTRACT_VERSION,
  checkHostRequirements,
  type DriverManifest,
  type HostInfo,
  isContractCompatible,
  isKrakenDriver,
  KrakenError,
} from '@kraken-e2e/contracts';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

const INSTALL_ARGS: Record<PackageManager, readonly string[]> = {
  pnpm: ['add', '-D', '-E'],
  npm: ['install', '--save-dev', '--save-exact'],
  yarn: ['add', '--dev', '--exact'],
};

export interface InstallPluginOptions {
  readonly packageName: string;
  readonly cwd?: string;
  /** Validate+register only (tests; also useful after a manual install). */
  readonly skipInstall?: boolean;
  readonly host: HostInfo;
  readonly write: (line: string) => void;
}

export interface InstallPluginResult {
  readonly exitCode: number;
  readonly registeredInConfig: boolean;
}

const NPM_NAME_GRAMMAR = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export async function installPlugin(options: InstallPluginOptions): Promise<InstallPluginResult> {
  const { packageName, write } = options;
  const cwd = options.cwd ?? process.cwd();

  // Never forward untrusted strings to a package manager: a name starting
  // with '-' would be parsed as a FLAG (registry override, script injection).
  if (!NPM_NAME_GRAMMAR.test(packageName)) {
    write(`✗ "${packageName}" is not a valid npm package name.`);
    return { exitCode: 1, registeredInConfig: false };
  }

  // 1 — Locate the project (never a silent global install — ADR-0001 §5.10).
  const configPath = findConfigPath(cwd);
  const projectRoot = configPath
    ? join(configPath, '..')
    : existsSync(join(cwd, 'package.json'))
      ? cwd
      : undefined;
  if (!projectRoot) {
    write('✗ No Kraken project found (no kraken.config.* upwards, no package.json here).');
    write('  fix: run inside your test project, or create one with: kraken init');
    return { exitCode: 1, registeredInConfig: false };
  }

  // 2 — Install through the project's OWN package manager (lockfile-governed).
  if (options.skipInstall !== true) {
    const pm = detectPackageManager(projectRoot);
    write(`Installing ${packageName} with ${pm} (exact-pinned devDependency)…`);
    const result = spawnSync(pm, [...INSTALL_ARGS[pm], packageName], {
      cwd: projectRoot,
      stdio: 'inherit',
      // Windows package managers are .cmd shims — they need a shell there.
      shell: process.platform === 'win32',
    });
    if (result.error) {
      write(`✗ could not launch ${pm}: ${result.error.message}`);
      return { exitCode: 1, registeredInConfig: false };
    }
    if (result.status !== 0) {
      write(`✗ ${pm} exited with ${result.status ?? 'a signal'} — nothing was registered.`);
      return { exitCode: 1, registeredInConfig: false };
    }
  }

  // 3 — Pre-gate via /manifest FIRST (ADR-0001 §5.5, same rule as the
  //     registry): on an unsupported host the MAIN ENTRY is never imported —
  //     it may legitimately fail to load there.
  const resolve = createRequire(join(projectRoot, 'package.json')).resolve;
  let manifest: DriverManifest;
  try {
    const manifestModule = (await import(
      pathToFileURL(resolve(`${packageName}/manifest`)).href
    )) as {
      default?: DriverManifest;
      manifest?: DriverManifest;
    };
    const candidate = manifestModule.default ?? manifestModule.manifest;
    if (!candidate) throw new Error('no default (or named `manifest`) export');
    manifest = candidate;
  } catch (cause) {
    write(
      `✗ ${packageName}/manifest could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    write('  Kraken drivers must ship a /manifest subpath (ADR-0001 §5.5).');
    return { exitCode: 1, registeredInConfig: false };
  }
  if (!isContractCompatible(manifest.contract, CONTRACT_VERSION)) {
    write(
      `✗ ${packageName} was built against contract ` +
        `${manifest.contract.major}.${manifest.contract.minor}; this Kraken supports ` +
        `${CONTRACT_VERSION.major}.${CONTRACT_VERSION.minor}. Align the versions.`,
    );
    return { exitCode: 1, registeredInConfig: false };
  }

  // 4 — ADVISORY host gate (install is cross-platform; load/run is what gates).
  const gate = checkHostRequirements(manifest.hostRequirements, options.host);
  if (!gate.ok) {
    write(`! ${manifest.platformLabel} is DISABLED on this host: ${gate.reason}.`);
    write('  Installed and lockfile-pinned anyway (your teammates on supported hosts get it).');
  } else {
    // Host is fine — the full brand validation can import the entry safely.
    try {
      const entry = (await import(pathToFileURL(resolve(packageName)).href)) as {
        default?: (opts?: unknown) => unknown;
      };
      if (typeof entry.default !== 'function' || !isKrakenDriver(entry.default())) {
        throw new KrakenError(
          'KRK-PLUGIN-INVALID',
          `${packageName}'s default export is not a defineDriver() factory.`,
        );
      }
    } catch (cause) {
      write(
        `✗ ${packageName} could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      write('  The package stays installed; fix it or remove it with your package manager.');
      return { exitCode: 1, registeredInConfig: false };
    }
  }

  // 5 — Config registration: append the string form when mechanically safe,
  //     otherwise print the exact lines (never rewrite user code blindly).
  let registered = false;
  if (configPath) {
    const source = readFileSync(configPath, 'utf8');
    if (source.includes(`'${packageName}'`) || source.includes(`"${packageName}"`)) {
      write(`✓ ${packageName} is already registered in ${configPath}.`);
      registered = true;
    } else {
      // Comment-aware: only append at a drivers:[ marker on a NON-comment line
      // (a commented-out example above the real array must not swallow it).
      const lines = source.split('\n');
      const markerLine = lines.findIndex((line) => {
        const match = /\bdrivers\s*:\s*\[/.exec(line);
        return match !== null && !line.slice(0, match.index).includes('//');
      });
      if (markerLine !== -1) {
        lines[markerLine] = (lines[markerLine] as string).replace(
          /(\bdrivers\s*:\s*\[)/,
          `$1\n    '${packageName}',`,
        );
        writeFileSync(configPath, lines.join('\n'));
        write(`✓ registered '${packageName}' in ${configPath}.`);
        registered = true;
      } else {
        write(`Add it to your config's drivers array:\n    drivers: ['${packageName}', …],`);
      }
    }
  } else {
    write(
      `No kraken.config.ts found — create one (kraken init) and register:\n    drivers: ['${packageName}'],`,
    );
  }

  // 6 — Epilogue.
  for (const hint of manifest.setupHints ?? []) {
    write(`  next: ${hint}`);
  }
  return { exitCode: 0, registeredInConfig: registered };
}
