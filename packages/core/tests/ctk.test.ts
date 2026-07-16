/**
 * The CTK validated against FakeDriver (ADR-0002 D8): a fully-supporting
 * driver yields an all-supported-pass parity report; the comparison helper
 * implements the M1 exit-gate rule (ADR-0001 §5.4).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HostContext } from '@kraken-e2e/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { compareParityReports, describeDriverConformance, type ParityReport } from '../src/ctk.ts';
import { createFakeDriver, FakeAppWorld } from '../src/testing/fake-driver.ts';

const HOST: HostContext = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0', env: {} };
const artifactsDir = mkdtempSync(join(tmpdir(), 'kraken-ctk-'));
const reportPath = join(artifactsDir, 'parity-report.fake.json');

function ctkWorld(): FakeAppWorld {
  const world = new FakeAppWorld();
  for (const actor of ['ctk']) {
    world.setElement(actor, 'button', { text: 'Tap me', visible: true });
    world.setElement(actor, 'input', { text: '', visible: true });
    world.setElement(actor, 'label', { text: 'hello-ctk', visible: true });
  }
  return world;
}

const driver = createFakeDriver({ world: ctkWorld(), id: 'fake', platforms: ['fake'] });

describeDriverConformance({
  name: 'fake',
  createSession: async () => {
    await driver.start(HOST, {
      runId: 'ctk-run',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      artifactsDir,
      abort: new AbortController().signal,
      emit: () => {},
    });
    return driver.createSession(
      { id: 'ctk', platform: 'fake', config: {} },
      {
        runId: 'ctk-run',
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        artifactsDir,
        abort: new AbortController().signal,
        emit: () => {},
      },
    );
  },
  fixture: {
    tappable: { by: 'testId', value: 'button' },
    typable: { by: 'testId', value: 'input' },
    readable: { target: { by: 'testId', value: 'label' }, expected: 'hello-ctk' },
    navigateTo: 'fake://home',
  },
  reportPath,
});

describe('parity report emission', () => {
  afterAll(() => {
    // Runs after the CTK's own afterAll wrote the report.
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ParityReport;
    const statuses = Object.values(report.operations).map((outcome) => outcome.status);
    if (!statuses.every((status) => status === 'supported')) {
      throw new Error(`FakeDriver must fully support the core surface; got: ${statuses.join(',')}`);
    }
  });

  it('writes parity-report.json next to the suite', () => {
    // The file is written in afterAll; here we only pin the path expectation.
    expect(reportPath.endsWith('parity-report.fake.json')).toBe(true);
    expect(existsSync(artifactsDir)).toBe(true);
  });
});

describe('compareParityReports — the M1 gate rule', () => {
  const base = (driverName: string): ParityReport =>
    JSON.parse(
      readFileSync(reportPath, 'utf8').replace('"fake"', `"${driverName}"`),
    ) as ParityReport;

  it('empty diff between identical reports = parity', () => {
    expect(compareParityReports(base('android'), base('ios'))).toEqual([]);
  });

  it('asymmetric unsupported blocks; symmetric unsupported passes', () => {
    const android = base('android');
    const ios = base('ios');
    const asymmetric: ParityReport = {
      ...ios,
      operations: {
        ...ios.operations,
        navigate: { status: 'unsupported', reason: 'no deep links yet' },
      },
    };
    const problems = compareParityReports(android, asymmetric);
    expect(problems.some((problem) => problem.includes('asymmetric support for navigate'))).toBe(
      true,
    );

    const symmetricA: ParityReport = {
      ...android,
      operations: {
        ...android.operations,
        navigate: { status: 'unsupported', reason: 'n/a' },
      },
    };
    expect(compareParityReports(symmetricA, asymmetric)).toEqual([]);
  });

  it('failing entries always block', () => {
    const android = base('android');
    const failing: ParityReport = {
      ...android,
      operations: {
        ...android.operations,
        tap: { status: 'failing', error: 'element never found' },
      },
    };
    expect(compareParityReports(failing, base('ios'))[0]).toContain('tap is failing');
  });
});
