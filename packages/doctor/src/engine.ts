import type {
  DoctorCheck,
  DoctorCheckResult,
  DoctorStatus,
  HostContext,
} from '@kraken-e2e/contracts';

export interface DoctorEntry extends DoctorCheckResult {
  readonly id: string;
  readonly title: string;
}

export interface DoctorReport {
  readonly generatedAt: string;
  readonly host: { platform: string; arch: string; nodeVersion: string };
  readonly entries: readonly DoctorEntry[];
  readonly summary: Readonly<Record<DoctorStatus, number>>;
}

/**
 * Pure check-execution engine (ADR-0001 §5.13): inputs — HostContext, the
 * checks (built-in + driver-contributed, both injected by the CLI) — arrive
 * from outside. This package never reads process.platform, never resolves
 * drivers, never knows Appium.
 */
export async function runDoctor(options: {
  host: HostContext;
  checks: readonly DoctorCheck[];
}): Promise<DoctorReport> {
  const entries: DoctorEntry[] = [];
  for (const check of options.checks) {
    try {
      const result = await check.run(options.host);
      entries.push({ id: check.id, title: check.title, ...result });
    } catch (cause) {
      entries.push({
        id: check.id,
        title: check.title,
        status: 'fail',
        detail: `check crashed: ${cause instanceof Error ? cause.message : String(cause)}`,
        fix: 'This is a bug in the check itself — report it.',
      });
    }
  }
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const entry of entries) summary[entry.status] += 1;
  return {
    generatedAt: new Date().toISOString(),
    host: {
      platform: options.host.platform,
      arch: options.host.arch,
      nodeVersion: options.host.nodeVersion,
    },
    entries,
    summary,
  };
}

const ICONS: Record<DoctorStatus, string> = { ok: '✓', warn: '!', fail: '✗' };

export function renderDoctorText(report: DoctorReport): string {
  const lines: string[] = [
    `Kraken doctor — host: ${report.host.platform}/${report.host.arch}, node ${report.host.nodeVersion}`,
    '',
  ];
  for (const entry of report.entries) {
    lines.push(`${ICONS[entry.status]} ${entry.title}${entry.detail ? ` — ${entry.detail}` : ''}`);
    if (entry.fix && entry.status !== 'ok') lines.push(`    fix: ${entry.fix}`);
  }
  lines.push(
    '',
    `${report.summary.ok} ok, ${report.summary.warn} warning(s), ${report.summary.fail} failure(s)`,
  );
  return lines.join('\n');
}
