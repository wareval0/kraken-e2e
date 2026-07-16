import type { Logger } from '@kraken-e2e/contracts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogLine {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Loggers are sink-based: core never writes to stdout itself (ADR-0001 §5.11
 * stdout discipline). The CLI wires the sink to its renderer; tests wire it to
 * an array.
 */
export function createLogger(scope: string, sink: (line: LogLine) => void): Logger {
  const log =
    (level: LogLevel) =>
    (message: string, meta?: Readonly<Record<string, unknown>>): void => {
      sink({ level, scope, message, ...(meta !== undefined ? { meta } : {}) });
    };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

export const silentLogger: Logger = createLogger('silent', () => {});
