/**
 * @kraken-e2e/cli — the `kraken` command (ADR-0001 §5.11). oclif v4, ESM,
 * topicSeparator ' ' (colons remain aliases). Phase 1 ships `run` and
 * `doctor` with the plain LineReporter; the Ink live UI and the
 * Kraken-owned `plugins` topic arrive in Phase 2 (ADR-0001 §5.10/D15).
 */
export { buildDoctorReport } from './doctor-report.js';
export { type RunProjectOptions, type RunProjectResult, runProject } from './run-project.js';
