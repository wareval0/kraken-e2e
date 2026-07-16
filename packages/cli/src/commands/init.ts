import { Command } from '@oclif/core';

import { initProject } from '../init-project.js';

export default class Init extends Command {
  static override description =
    'Scaffold a Kraken test project (config, steps, features, VS Code Cucumber settings).';

  static override examples = ['<%= config.bin %> init'];

  async run(): Promise<void> {
    const code = initProject({ cwd: process.cwd(), write: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
