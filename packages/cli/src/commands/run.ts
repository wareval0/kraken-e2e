import { Command, Flags } from '@oclif/core';

import { runProject } from '../run-project.js';

export default class Run extends Command {
  static override description =
    'Compile the feature files (dry-run analysis) and execute the multi-actor scenarios.';

  static override examples = [
    '<%= config.bin %> run',
    '<%= config.bin %> run --dry-run',
    '<%= config.bin %> run --tags "@smoke and not @wip"',
  ];

  static override flags = {
    config: Flags.string({ char: 'c', description: 'path to kraken.config.ts' }),
    tags: Flags.string({ char: 't', description: 'tag expression, e.g. "@smoke and not @wip"' }),
    'dry-run': Flags.boolean({
      description: 'compile and statically analyze only — boot no sessions',
    }),
    plain: Flags.boolean({
      description: 'force the plain line renderer (no live Ink UI)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Run);
    const result = await runProject({
      ...(flags.config !== undefined ? { configPath: flags.config } : {}),
      ...(flags.tags !== undefined ? { tags: flags.tags } : {}),
      dryRun: flags['dry-run'],
      plain: flags.plain,
      write: (line) => this.log(line),
    });
    // ALWAYS exit explicitly: embedded Appium/WDIO leave keep-alive handles
    // that keep the event loop from draining after a successful run
    // (observed live: `kraken run` hung post-runFinished — ADR-0005).
    // Drain piped stdout first: process.exit does not wait for pending writes
    // (the CI `kraken run | tee` case would truncate the failure summary).
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
    this.exit(result.exitCode);
  }
}
