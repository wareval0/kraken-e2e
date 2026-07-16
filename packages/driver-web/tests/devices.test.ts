import { describe, expect, it } from 'vitest';

import { listWebTargets } from '../src/devices.ts';

describe.skipIf(process.platform !== 'darwin')('listWebTargets (darwin)', () => {
  it('lists installed browsers as available with browser-key actor configs', async () => {
    const targets = await listWebTargets(
      () => ({ status: 1, stdout: '' }),
      (path) => path.includes('Google Chrome') || path.includes('Safari'),
    );
    expect(targets.map((t) => t.id)).toEqual(['chrome', 'safari']);
    expect(targets[0]?.actorConfig).toEqual({ platform: 'web', browser: 'chrome' });
    expect(targets[1]?.detail).toContain('ONE concurrent Safari session');
  });
});
