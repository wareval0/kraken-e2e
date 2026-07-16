/**
 * Host-platform detection contracts (ADR-0001 §5.5 / constraint C4b).
 * The single implementation reading process.platform/arch lives in
 * @kraken-e2e/core (`systemHostProbe`); everything else receives HostInfo values.
 */

export interface HostInfo {
  readonly platform: 'darwin' | 'linux' | 'win32' | (string & {});
  readonly arch: 'arm64' | 'x64' | (string & {});
  /** Without the leading 'v', e.g. '22.19.0'. */
  readonly nodeVersion: string;
}

/** Injectable so the non-darwin branch is a plain unit test (C4b). */
export interface HostProbe {
  detect(): HostInfo;
}

/** What a driver's manifest declares about the hosts it can run on. */
export interface HostRequirements {
  readonly platforms?: readonly string[];
  readonly archs?: readonly string[];
  readonly minNodeMajor?: number;
}

/** What drivers receive at start(): host facts plus the environment. */
export interface HostContext extends HostInfo {
  readonly projectRoot?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export type HostCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly fix: string };

/** Pure — trivially unit-testable with injected values (never reads process.*). */
export function checkHostRequirements(
  requirements: HostRequirements | undefined,
  host: HostInfo,
): HostCheckResult {
  if (!requirements) return { ok: true };
  if (requirements.platforms && !requirements.platforms.includes(host.platform)) {
    return {
      ok: false,
      reason:
        `requires host platform ${requirements.platforms.join(' or ')}, ` +
        `but this host is ${host.platform}/${host.arch}`,
      fix: `Run on a supported host (${requirements.platforms.join(', ')}). Other drivers remain available on this host.`,
    };
  }
  if (requirements.archs && !requirements.archs.includes(host.arch)) {
    return {
      ok: false,
      reason: `requires CPU architecture ${requirements.archs.join(' or ')}, but this host is ${host.arch}`,
      fix: `Run on a supported architecture (${requirements.archs.join(', ')}).`,
    };
  }
  if (requirements.minNodeMajor !== undefined) {
    const major = Number.parseInt(host.nodeVersion.split('.')[0] ?? '0', 10);
    if (major < requirements.minNodeMajor) {
      return {
        ok: false,
        reason: `requires Node >= ${requirements.minNodeMajor}, but this host runs ${host.nodeVersion}`,
        fix: `Upgrade Node.js to ${requirements.minNodeMajor} or newer.`,
      };
    }
  }
  return { ok: true };
}
