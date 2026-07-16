import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HostInfo } from '@kraken-e2e/contracts';
import { ACTOR_REGEXP, DURATION_REGEXP } from '@kraken-e2e/gherkin';
import { describe, expect, it } from 'vitest';

import { initProject, VSCODE_PARAMETER_TYPES } from '../src/init-project.ts';
import { detectPackageManager, installPlugin } from '../src/plugins-install.ts';

const here = dirname(fileURLToPath(import.meta.url));
// The core test fixtures double as installed-driver simulacra (§5.10 checks).
const FIXTURE_PROJECT = join(here, '../../core/tests/fixtures/project');

const LINUX: HostInfo = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' };

describe('detectPackageManager', () => {
  it('sniffs the lockfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-pm-'));
    expect(detectPackageManager(dir)).toBe('npm');
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('yarn');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });
});

describe('installPlugin (validate+register path — C8/D15)', () => {
  it('validates a branded driver and appends it to the config drivers array', async () => {
    const lines: string[] = [];
    const dir = FIXTURE_PROJECT; // has node_modules/@fixture/driver-ok
    const configPath = join(dir, 'kraken.config.ts');
    writeFileSync(
      configPath,
      "import { defineConfig } from '@kraken-e2e/config';\nexport default defineConfig({\n  actors: { a: { platform: 'fixture' } },\n  drivers: [],\n});\n",
    );
    try {
      const result = await installPlugin({
        packageName: '@fixture/driver-ok',
        cwd: dir,
        skipInstall: true,
        host: LINUX,
        write: (line) => lines.push(line),
      });
      expect(result.exitCode).toBe(0);
      expect(result.registeredInConfig).toBe(true);
      expect(readFileSync(configPath, 'utf8')).toContain("'@fixture/driver-ok',");
      // Idempotent: second run detects the existing registration.
      const again = await installPlugin({
        packageName: '@fixture/driver-ok',
        cwd: dir,
        skipInstall: true,
        host: LINUX,
        write: (line) => lines.push(line),
      });
      expect(again.registeredInConfig).toBe(true);
      expect(lines.join('\n')).toContain('already registered');
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(configPath, { force: true });
    }
  });

  it('host-gated drivers install with an ADVISORY warning, exit 0 (never EBADPLATFORM)', async () => {
    const lines: string[] = [];
    const result = await installPlugin({
      packageName: '@fixture/driver-gated',
      cwd: FIXTURE_PROJECT,
      skipInstall: true,
      host: LINUX,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('DISABLED on this host');
    expect(output).toContain('lockfile-pinned anyway');
  });

  it('refuses outside a project with the kraken init hint', async () => {
    const lines: string[] = [];
    const empty = mkdtempSync(join(tmpdir(), 'kraken-noproj-'));
    const result = await installPlugin({
      packageName: '@fixture/driver-ok',
      cwd: empty,
      skipInstall: true,
      host: LINUX,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('kraken init');
  });
});

describe('initProject scaffolding (ADR-0005 / ADR-0004 Appendix B)', () => {
  it('creates the skeleton, never overwrites, and pins editor regexps to the runtime ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-init-'));
    const lines: string[] = [];
    expect(initProject({ cwd: dir, write: (line) => lines.push(line) })).toBe(0);
    for (const file of [
      'kraken.config.ts',
      'steps/index.ts',
      'features/example.feature',
      '.vscode/settings.json',
    ]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    // Re-run: everything skips.
    const again: string[] = [];
    initProject({ cwd: dir, write: (line) => again.push(line) });
    expect(again.filter((line) => line.startsWith('created:'))).toHaveLength(0);

    // THE APPENDIX-B INVARIANT: editor regexps byte-identical to the runtime.
    expect(VSCODE_PARAMETER_TYPES[0]?.regexp).toBe(ACTOR_REGEXP.source);
    expect(VSCODE_PARAMETER_TYPES[1]?.regexp).toBe(DURATION_REGEXP.source);
    const settings = JSON.parse(readFileSync(join(dir, '.vscode/settings.json'), 'utf8')) as {
      'cucumber.parameterTypes': typeof VSCODE_PARAMETER_TYPES;
    };
    expect(settings['cucumber.parameterTypes']).toEqual(VSCODE_PARAMETER_TYPES);
  });
});
