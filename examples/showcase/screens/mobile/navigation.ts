/**
 * Deep-link navigation with ONE retry: on a freshly-booted app the first
 * deep link can race the initial render — a single re-navigate settles it.
 * Every Screen Object opens through this helper.
 */
import type { UserSession } from '@kraken-e2e/contracts';

export async function openByDeepLink(
  session: UserSession,
  link: string,
  marker: { by: 'a11y'; value: string },
): Promise<void> {
  await session.navigate(link);
  try {
    await session.waitFor(marker, 'visible', { timeoutMs: 12_000 });
  } catch {
    await session.navigate(link);
    await session.waitFor(marker, 'visible', { timeoutMs: 15_000 });
  }
}
