import { describe, expect, it } from 'vitest';

import { createHostContext, systemHostProbe } from '../src/host.ts';

describe('systemHostProbe — the ONLY process.platform/arch reader (C4b)', () => {
  it('reports the live host truthfully', () => {
    const host = systemHostProbe.detect();
    expect(host.platform).toBe(process.platform);
    expect(host.arch).toBe(process.arch);
    expect(host.nodeVersion).toBe(process.versions.node);
  });

  it('createHostContext layers env and optional projectRoot over HostInfo', () => {
    const host = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' } as const;
    const ctx = createHostContext(host, '/project');
    expect(ctx.projectRoot).toBe('/project');
    expect(ctx.env).toBe(process.env);
    expect(createHostContext(host).projectRoot).toBeUndefined();
  });
});
