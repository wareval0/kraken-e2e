import { Command, Flags } from '@oclif/core';

import { buildDevicesReport, renderDevicesText } from '../devices-report.js';

export default class Devices extends Command {
  static override description =
    'List the devices you can already drive — booted simulators, running emulators, connected devices, browsers — with ready-to-paste actor config.';

  static override examples = ['<%= config.bin %> devices', '<%= config.bin %> devices --json'];

  static override enableJsonFlag = true;

  static override flags = {
    cwd: Flags.string({ description: 'project directory (defaults to the current one)' }),
  };

  async run(): Promise<unknown> {
    const { flags } = await this.parse(Devices);
    const report = await buildDevicesReport({
      ...(flags.cwd !== undefined ? { cwd: flags.cwd } : {}),
    });
    if (!this.jsonEnabled()) {
      this.log(renderDevicesText(report));
    }
    return report;
  }
}
