/**
 * Small waiting utilities the Screen Objects share.
 *
 * `waitForAny` — poll a set of candidate locators until ONE is displayed and
 * return it. Real products A/B-test their controls and rename hooks between
 * releases; anchoring a hop on "whichever of these renders" keeps a suite
 * alive across variants without loosening what it asserts.
 */
import type { TargetLocator, UserSession } from '@kraken-e2e/contracts';

/**
 * Poll a field's value until it matches `expected`. Typing on a native field
 * is not always instant — the app's own input handling can lag a beat behind
 * `typeText`, so submitting immediately can send a half-entered value. This
 * confirms the value landed before the next action. Pass `exact` to require the
 * whole (trimmed) value to equal `expected` rather than merely contain it.
 */
export async function waitForValue(
  session: UserSession,
  target: TargetLocator,
  expected: string,
  opts: { timeoutMs: number; pollMs?: number; exact?: boolean },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  const poll = opts.pollMs ?? 300;
  const want = expected.trim();
  for (;;) {
    const value = (await session.readText(target).catch(() => '')).trim();
    if (opts.exact ? value === want : value.includes(want)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Field never held "${expected}" within ${opts.timeoutMs}ms (last: "${value}").`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

/** Poll until a field is empty — used to confirm a reused input has been
 *  cleared before typing, so a new value isn't appended to a stale one. */
export async function waitForEmpty(
  session: UserSession,
  target: TargetLocator,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<void> {
  await waitForValue(session, target, '', { ...opts, exact: true });
}

export async function waitForAny(
  session: UserSession,
  targets: readonly TargetLocator[],
  opts: { timeoutMs: number; pollMs?: number },
): Promise<TargetLocator> {
  const deadline = Date.now() + opts.timeoutMs;
  const poll = opts.pollMs ?? 500;
  for (;;) {
    for (const target of targets) {
      if (await session.isDisplayed(target)) return target;
    }
    if (Date.now() >= deadline) {
      const described = targets.map((t) => `${t.by}=${t.value}`).join(' | ');
      throw new Error(
        `None of the expected elements appeared within ${opts.timeoutMs}ms: ${described}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}
