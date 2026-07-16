import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { KrakenEvent, Reporter } from '@kraken-e2e/contracts';

/**
 * The raw JSONL event log (ADR-0001 §5.12): one serialized KrakenEvent per
 * line, persisted per run — the substrate every other reporter (and the future
 * GUI) projects from. Writes are chained so line order matches seq order.
 */
export function createJsonlReporter(filePath: string): Reporter {
  let chain: Promise<void> = mkdir(dirname(filePath), { recursive: true }).then(() => {});
  return {
    id: 'jsonl',
    onEvent(event: KrakenEvent): Promise<void> {
      chain = chain.then(() => appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8'));
      return chain;
    },
    async flush(): Promise<void> {
      await chain;
    },
  };
}
