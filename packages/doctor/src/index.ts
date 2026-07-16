/**
 * @kraken-e2e/doctor — pure check-execution engine behind `kraken doctor`
 * (ADR-0001 §5.13). Inputs (HostContext, built-in + driver-contributed checks,
 * driver gate statuses) are injected by the CLI; this package never reads
 * process.platform, never resolves drivers, never knows Appium.
 */
export { builtInChecks, type DriverGateStatus, driverGateChecks } from './checks.js';
export { type DoctorEntry, type DoctorReport, renderDoctorText, runDoctor } from './engine.js';
