/**
 * Platform parity is machine-checked, not just asserted in prose: the committed
 * parity-report artifacts must keep satisfying the criterion of zero failing
 * operations on both platforms and an empty diff between their supported-op
 * sets. Regenerating either report with a regression fails `pnpm check` here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareParityReports, type ParityReport } from '../src/ctk.ts';

const REPORTS = join(import.meta.dirname, '../../../parity-reports');

function load(name: string): ParityReport {
  return JSON.parse(readFileSync(join(REPORTS, name), 'utf8')) as ParityReport;
}

describe('committed platform-parity record', () => {
  it('android↔ios: zero failing operations, empty supported-op diff', () => {
    const android = load('parity-report.android.json');
    const ios = load('parity-report.ios.json');
    for (const report of [android, ios]) {
      const failing = Object.entries(report.operations).filter(
        ([, out]) => out.status === 'failing',
      );
      expect(failing).toEqual([]);
    }
    expect(compareParityReports(android, ios)).toEqual([]);
  });
});
