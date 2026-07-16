/**
 * @kraken-e2e/contracts — zero-runtime-dependency SPI (ADR-0001 §5.3, ADR-0002).
 *
 * The hexagonal boundary every plugin compiles against: driver/reporter
 * interfaces, the core session surface, event types, error codes, host
 * detection contracts, and CONTRACT_VERSION. Drivers peer-depend on THIS
 * package, never on @kraken-e2e/core, so core ships majors freely (ADR-0001 §5.10).
 *
 * The signal-transport SPI is owned by @kraken-e2e/signaling and re-exported here
 * type-only (erased at runtime — this package keeps zero runtime imports).
 */

// Type-only re-export of the signal-transport SPI (ADR-0001 §5.3; owned by
// @kraken-e2e/signaling). Erased at runtime — zero runtime imports here.
export type {
  SignalPayload,
  SignalRecord,
  SignalScope,
  SignalTransport,
} from '@kraken-e2e/signaling';
export {
  type DeviceTarget,
  type DoctorCheck,
  type DoctorCheckResult,
  type DoctorStatus,
  DRIVER_BRAND,
  type DriverEmission,
  type DriverManifest,
  type DriverServices,
  type DriverSpec,
  defineDriver,
  isKrakenDriver,
  type KrakenDriver,
  type Logger,
  type ResolvedActor,
} from './driver.js';
export {
  KrakenError,
  type KrakenErrorCode,
  KrakenErrorCodes,
  type SerializedKrakenError,
  serializeError,
} from './errors.js';
export type {
  ActorSummary,
  KrakenEvent,
  KrakenEventBase,
  KrakenEventInput,
  KrakenEventType,
  RunStatus,
  StepStatus,
} from './events.js';
export {
  checkHostRequirements,
  type HostCheckResult,
  type HostContext,
  type HostInfo,
  type HostProbe,
  type HostRequirements,
} from './host.js';
export { defineReporter, type Reporter } from './reporter.js';
export {
  type ArtifactRef,
  CORE_OPERATIONS,
  type CoreOperation,
  type KrakenNativeSessions,
  type SemanticKey,
  type SessionWaitOptions,
  type TargetLocator,
  type UserSession,
  type WaitState,
} from './session.js';
export { CONTRACT_VERSION, type ContractVersion, isContractCompatible } from './version.js';
