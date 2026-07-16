/**
 * The API-surface snapshot guard (ADR-0001 §5.10): the contract's public
 * surface may not change without a CONTRACT_VERSION bump in the SAME commit.
 * Works locally, without CI.
 *
 * If this test fails: you changed what @kraken-e2e/contracts exports (or the
 * error-code registry, or the core-operation list). That is a CONTRACT change:
 * 1. additive → bump CONTRACT_VERSION.minor;  2. breaking → bump major (and
 * read ADR-0001 §5.4's parity gate first);  3. then update this snapshot in
 * the same commit and say why in the commit message.
 */
import { describe, expect, it } from 'vitest';

import * as contracts from '../src/index.ts';
import { CONTRACT_VERSION, CORE_OPERATIONS, KrakenErrorCodes } from '../src/index.ts';

describe('contract surface stability (ADR-0001 §5.10)', () => {
  it('the public surface + version match the committed snapshot', async () => {
    const surface = {
      contractVersion: CONTRACT_VERSION,
      // Runtime exports (values + classes + functions). Pure types are guarded
      // by tsc consumers; a full .d.ts diff is a future improvement.
      runtimeExports: Object.keys(contracts).sort(),
      coreOperations: [...CORE_OPERATIONS],
      errorCodes: Object.values(KrakenErrorCodes).sort(),
    };
    await expect(JSON.stringify(surface, null, 2)).toMatchFileSnapshot(
      './__snapshots__/contract-surface.json',
    );
  });
});
