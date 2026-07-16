import type { HostContext, HostInfo, HostProbe } from '@kraken-e2e/contracts';

/**
 * THE single place in the entire codebase that reads process.platform/arch
 * (ADR-0001 §5.5 / constraint C4b). Everything downstream receives injected
 * HostInfo values, which is what makes the non-darwin branch unit-testable.
 */
export const systemHostProbe: HostProbe = {
  detect(): HostInfo {
    return {
      platform: process.platform as HostInfo['platform'],
      arch: process.arch as HostInfo['arch'],
      nodeVersion: process.versions.node,
    };
  },
};

/** What drivers receive at start(): host facts plus environment access. */
export function createHostContext(host: HostInfo, projectRoot?: string): HostContext {
  return {
    ...host,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    env: process.env,
  };
}
