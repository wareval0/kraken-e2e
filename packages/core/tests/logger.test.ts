import { describe, expect, it } from 'vitest';

import { createLogger, silentLogger } from '../src/logger.ts';

describe('createLogger', () => {
  it('routes every level through the sink with scope and meta (stdout discipline)', () => {
    const lines: unknown[] = [];
    const logger = createLogger('driver:fake', (line) => lines.push(line));
    logger.debug('d');
    logger.info('i', { key: 1 });
    logger.warn('w');
    logger.error('e');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toEqual({
      level: 'info',
      scope: 'driver:fake',
      message: 'i',
      meta: { key: 1 },
    });
    expect(lines[0]).toEqual({ level: 'debug', scope: 'driver:fake', message: 'd' });
  });

  it('silentLogger swallows everything without touching any stream', () => {
    expect(() => {
      silentLogger.info('into the void');
      silentLogger.error('still nothing');
    }).not.toThrow();
  });
});
