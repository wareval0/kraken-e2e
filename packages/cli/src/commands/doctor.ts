import { renderDoctorText } from '@kraken-e2e/doctor';
import { Command, Flags } from '@oclif/core';
import { buildDoctorReport } from '../doctor-report.js';

export default class Doctor extends Command {
  static override description =
    'Diagnose the environment: host platform, toolchain, and per-driver readiness with actionable fixes.';

  static override examples = ['<%= config.bin %> doctor', '<%= config.bin %> doctor --json'];

  static override enableJsonFlag = true;

  static override flags = {
    cwd: Flags.string({ description: 'project directory (defaults to the current one)' }),
  };

  async run(): Promise<unknown> {
    const { flags } = await this.parse(Doctor);
    const report = await buildDoctorReport({
      ...(flags.cwd !== undefined ? { cwd: flags.cwd } : {}),
    });
    if (!this.jsonEnabled()) {
      this.log(renderDoctorText(report));
      if (report.summary.fail > 0) this.exit(1);
    }
    return report;
  }
}
