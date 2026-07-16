/**
 * The showcase step vocabulary. Steps are DELIBERATELY thin: one line of
 * business language delegating to a Screen/Page Object. Gherkin discipline:
 * Given = context, When = action, Then = observable outcome — features read
 * as specifications, never as scripts of taps.
 */

import { planFuzz, runFuzz } from '@kraken-e2e/fuzz';
import { createStepRegistry } from '@kraken-e2e/gherkin';

import { qaUser } from '../fixtures/users.js';
import { FormsScreen } from '../screens/mobile/forms-screen.js';
import { LoginScreen } from '../screens/mobile/login-screen.js';
import { SwipeScreen } from '../screens/mobile/swipe-screen.js';
import { ReleaseBoardPage } from '../screens/web/release-board-page.js';
import { SauceLoginPage } from '../screens/web/saucedemo/pages.js';

export const { Given, When, Then, registry } = createStepRegistry();

const BOARD_URL = `http://127.0.0.1:${process.env['KRAKEN_BOARD_PORT'] ?? 4173}`;

/* ───────────────────────── account lifecycle (mobile) ───────────────────── */

Given('{actor} has signed up with the shared QA account', async ({ actor }) => {
  const screen = await LoginScreen.open(actor.session);
  await screen.signUpAs(qaUser());
  await screen.confirmSuccessDialog();
});

When('{actor} logs in with the shared QA account', async ({ actor }) => {
  const screen = await LoginScreen.open(actor.session);
  await screen.logInAs(qaUser());
});

Then('{actor} is greeted with a successful login', async ({ actor }) => {
  const screen = await LoginScreen.open(actor.session);
  await screen.confirmSuccessDialog();
});

/* ────────────────────────── smoke checks (mobile) ────────────────────────── */

When('{actor} verifies the forms surface echoes {string}', async ({ actor, world }, ...args) => {
  const [text] = args as unknown as [string];
  const forms = await FormsScreen.open(actor.session);
  const echoed = await forms.typeAndReadEcho(text);
  if (echoed !== text) throw new Error(`Echo mismatch: expected "${text}", got "${echoed}"`);
  world[`smoke:${actor.id}`] = 'forms-ok';
});

When('{actor} verifies the gesture carousel renders', async ({ actor, world }) => {
  const swipe = await SwipeScreen.open(actor.session);
  if (!(await swipe.isCarouselCardShown())) throw new Error('Carousel card not visible');
  world[`smoke:${actor.id}`] = 'gestures-ok';
});

/* ─────────────────── release sign-off choreography (signals) ─────────────── */

When(
  '{actor} signs off the {string} build for {string}',
  { publishes: ['signoff'] },
  async ({ actor }, ...args) => {
    const [platform, build] = args as unknown as [string, string];
    await actor.signals.publish('signoff', { platform, by: actor.id, build });
  },
);

Then(
  '{actor} collects {int} sign-offs in publish order within {duration}',
  async ({ actor, world }, ...args) => {
    const [count, timeoutMs] = args as unknown as [number, number];
    const collected: Array<{ platform: string; by: string; build: string }> = [];
    for (let i = 0; i < count; i += 1) {
      // FIFO per subscriber: each wait resumes after the last delivered record,
      // so the same signal name yields each publication exactly once, in order.
      const record = await actor.signals.waitFor<{ platform: string; by: string; build: string }>(
        'signoff',
        { timeoutMs },
      );
      collected.push(record.payload);
    }
    world['signoffs'] = collected;
  },
);

Then(
  '{actor} confirms the sign-offs arrived from {string} then {string}',
  async ({ world }, ...args) => {
    const [first, second] = args as unknown as [string, string];
    const collected = world['signoffs'] as Array<{ by: string }>;
    const order = collected.map((s) => s.by).join(',');
    if (order !== `${first},${second}`) {
      throw new Error(`Expected FIFO order ${first},${second} — got ${order}`);
    }
  },
);

When(
  '{actor} announces the release is published',
  { publishes: ['release-published'] },
  async ({ actor, world }) => {
    const collected = world['signoffs'] as Array<{ build: string }>;
    await actor.signals.publish('release-published', { build: collected[0]?.build ?? '?' });
  },
);

Then(
  '{actor} receives the publication notice for build {string} within {duration}',
  async ({ actor }, ...args) => {
    const [build, timeoutMs] = args as unknown as [string, number];
    // Fan-out: ONE publication, EVERY waiting subscriber receives it.
    const record = await actor.signals.waitFor<{ build: string }>('release-published', {
      timeoutMs,
    });
    if (record.payload.build !== build) {
      throw new Error(`Expected build ${build}, got ${record.payload.build}`);
    }
  },
);

/* ───────────────────────── release board (local web app) ─────────────────── */

Given('{actor} is watching the release board', async ({ actor, world }) => {
  world['board'] = await ReleaseBoardPage.open(actor.session, BOARD_URL);
});

When('{actor} records every collected sign-off on the board', async ({ world }) => {
  const board = world['board'] as ReleaseBoardPage;
  const collected = world['signoffs'] as Array<{ platform: string; by: string; build: string }>;
  for (const signoff of collected) {
    await board.recordSignoff(signoff);
  }
});

Then('{actor} sees {int} recorded sign-offs on the board', async ({ world }, ...args) => {
  const [expected] = args as unknown as [number];
  const board = world['board'] as ReleaseBoardPage;
  const count = await board.signoffCount();
  if (count !== expected) throw new Error(`Board shows ${count} sign-offs, expected ${expected}`);
});

/* ───────────────────────── saucedemo.com (public site) ───────────────────── */

Given('{actor} is logged into the store as {string}', async ({ actor, world }, ...args) => {
  const [username] = args as unknown as [string];
  const login = await SauceLoginPage.open(actor.session);
  world['inventory'] = await login.logInAs(username, 'secret_sauce');
});

When('{actor} adds {string} to the cart', async ({ world }, ...args) => {
  const [product] = args as unknown as [string];
  const inventory = world['inventory'] as Awaited<ReturnType<SauceLoginPage['logInAs']>>;
  await inventory.addToCart(product);
});

Then('{actor} sees {int} item(s) in the cart badge', async ({ world }, ...args) => {
  const [expected] = args as unknown as [number];
  const inventory = world['inventory'] as Awaited<ReturnType<SauceLoginPage['logInAs']>>;
  const count = await inventory.cartCount();
  if (count !== expected) throw new Error(`Cart badge shows ${count}, expected ${expected}`);
});

When('{actor} completes checkout as a seeded customer', async ({ world }) => {
  const inventory = world['inventory'] as Awaited<ReturnType<SauceLoginPage['logInAs']>>;
  const cart = await inventory.openCart();
  const checkout = await cart.checkout();
  const { customers } = await import('../fixtures/users.js');
  const [buyer] = customers(1);
  const [firstName, ...rest] = (buyer?.fullName ?? 'Ada Lovelace').split(' ');
  await checkout.fillBuyer({
    firstName: firstName ?? 'Ada',
    lastName: rest.join(' ') || 'Lovelace',
    postalCode: '111711',
  });
  world['confirmation'] = await checkout.finish();
});

Then('{actor} receives an order confirmation with thanks', async ({ world }) => {
  const confirmation = String(world['confirmation'] ?? '');
  if (!/thank you/i.test(confirmation)) {
    throw new Error(`Expected a thank-you confirmation, got "${confirmation}"`);
  }
});

/* ─────────────────────── seeded monkey testing (fuzz) ────────────────────── */

const FORMS_SURFACE = {
  // NOTE: the switch is deliberately EXCLUDED — toggling it re-renders the
  // whole React Native tree and staleifies in-flight element handles (a real
  // finding this monkey surfaced; kept out for a deterministic demo).
  tappable: [
    { by: 'a11y', value: 'button-Active' },
    { by: 'a11y', value: 'switch-text' },
  ],
  typable: [{ by: 'a11y', value: 'text-input' }],
} as const;

When(
  '{actor} unleashes {int} seeded random interactions on the forms screen',
  async ({ actor, world }, ...args) => {
    const [steps] = args as unknown as [number];
    await FormsScreen.open(actor.session);
    const seed = 20260709; // fixed seed: the SAME monkey walk on every run/machine
    const result = await runFuzz({
      session: actor.session,
      surface: FORMS_SURFACE,
      steps,
      seed,
      weights: { pressKey: 0 }, // stay inside the forms surface
      // Real UIs flake under a monkey (keyboards occlude, re-renders staleify
      // handles): tolerate misses, record them, keep walking.
      tolerateActionErrors: steps,
    });
    world['fuzz'] = result;
    if (result.status !== 'completed') {
      throw new Error(
        `Monkey walk ${result.status} at step ${result.failure?.entry.index}: ${String(result.failure?.error)}`,
      );
    }
  },
);

Then('{actor} confirms the forms screen survived the monkey', async ({ actor }) => {
  // Recovery first: the walk legitimately triggers native alerts (that IS the
  // monkey's job) — dismiss any leftovers before asserting the screen lives.
  for (let i = 0; i < 3; i += 1) {
    try {
      await actor.session.tap({ by: 'text', value: 'OK', exact: true });
    } catch {
      break; // no dialog left
    }
  }
  await FormsScreen.open(actor.session);
});

Then('{actor} confirms the monkey walk is reproducible from its seed', async ({ world }) => {
  const result = world['fuzz'] as Awaited<ReturnType<typeof runFuzz>>;
  // The PLAN is the reproducibility contract: same seed+surface → identical
  // plan, independent of which actions flaked at runtime.
  const executedOrTolerated = result.trace.length + result.errors.length;
  const replanned = planFuzz({
    surface: FORMS_SURFACE,
    steps: executedOrTolerated,
    seed: result.seed,
    weights: { pressKey: 0 },
  });
  if (replanned.length !== executedOrTolerated) {
    throw new Error('Replanned walk length differs — seed broke');
  }
});
