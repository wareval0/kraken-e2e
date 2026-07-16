/**
 * @kraken-e2e/reporters — projections of the KrakenEvent stream (ADR-0001 §5.12).
 * Phase 1 ships JSONL (the raw substrate) and the plain line renderer;
 * Allure 3 and CTRF arrive in Phase 4 (ADR-0006 part B).
 * Depends on @kraken-e2e/contracts ONLY (event types) — never on core.
 */
export { createAllureReporter } from './allure.js';
export { CTRF_SPEC_VERSION, createCtrfReporter } from './ctrf.js';
export { createJsonlReporter } from './jsonl.js';
export { createLineReporter } from './line.js';
