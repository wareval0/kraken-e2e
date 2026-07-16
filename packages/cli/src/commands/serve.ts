import { join } from 'node:path';

import { findConfigPath } from '@kraken-e2e/config';
import { Command, Flags } from '@oclif/core';

import { startServe } from '../serve.js';

export default class Serve extends Command {
  static override description =
    'Serve run results (event streams + artifacts) over HTTP/WebSocket — the GUI-ready projection.';

  static override examples = ['<%= config.bin %> serve', '<%= config.bin %> serve --port 4000'];

  static override flags = {
    port: Flags.integer({ description: 'port (default: OS-assigned)', default: 0 }),
    host: Flags.string({ description: 'bind host', default: '127.0.0.1' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Serve);
    const configPath = findConfigPath(process.cwd());
    const projectRoot = configPath ? join(configPath, '..') : process.cwd();
    const handle = await startServe({
      runsDir: join(projectRoot, '.kraken', 'runs'),
      port: flags.port,
      host: flags.host,
      log: (line) => this.log(line),
    });
    this.log(`Viewer: ${handle.url} — Ctrl-C to stop.`);
    // Serve runs until interrupted; the CLI owns SIGINT (ADR-0005).
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => {
        void handle.close().then(resolve);
      });
    });
  }
}
