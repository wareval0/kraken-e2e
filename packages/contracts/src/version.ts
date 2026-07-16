export interface ContractVersion {
  readonly major: number;
  readonly minor: number;
}

/**
 * Version of the driver/reporter SPI this package describes. Baked into every
 * plugin by defineDriver() and checked by core's registry at load time.
 * 1.0 froze with ADR-0002's acceptance (2026-07-03). 2.0 (2026-07-04):
 * BREAKING — SemanticKey narrowed to enter|escape|tab ('back' removed: an
 * Android-only concept, proven not-a-key on iOS by live HID probing; see the
 * ADR-0002 amendment). Breaking SPI change = major bump, addition = minor
 * bump; the API-surface snapshot test enforces the discipline. 2.1
 * (2026-07-09): ADDITIVE — optional KrakenDriver.listTargets() + DeviceTarget
 * (the `kraken devices` surface). 2.2 (2026-07-11): ADDITIVE —
 * optional UserSession.evaluate() (web script execution).
 */
export const CONTRACT_VERSION: ContractVersion = { major: 2, minor: 2 };

/**
 * The load-time compatibility rule (ADR-0001 §5.10): same major, and the
 * plugin must not have been compiled against a NEWER minor than the host
 * supports (it may call capabilities the host lacks). Older plugin on newer
 * host is fine.
 */
export function isContractCompatible(plugin: ContractVersion, host: ContractVersion): boolean {
  return plugin.major === host.major && plugin.minor <= host.minor;
}
