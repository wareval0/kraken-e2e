import { systemHostProbe } from '@kraken-e2e/core';
import { Args, Command, Flags } from '@oclif/core';
import { installPlugin } from '../../plugins-install.js';

export default class PluginsInstall extends Command {
  static override description =
    'Install a Kraken driver as an exact-pinned project devDependency and register it in kraken.config.ts.';

  static override examples = [
    '<%= config.bin %> plugins install @kraken-e2e/driver-ios',
    '<%= config.bin %> plugins:install @kraken-e2e/driver-android',
  ];

  static override args = {
    package: Args.string({ description: 'driver package name', required: true }),
  };

  static override flags = {
    'skip-install': Flags.boolean({
      description: 'validate and register an already-installed package only',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginsInstall);
    const result = await installPlugin({
      packageName: args.package,
      skipInstall: flags['skip-install'],
      host: systemHostProbe.detect(),
      write: (line) => this.log(line),
    });
    if (result.exitCode !== 0) this.exit(result.exitCode);
  }
}
