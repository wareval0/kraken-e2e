/**
 * Step vocabulary for the cross-device Kahoot suite. Steps stay THIN: one line
 * of business language delegating to a Page/Screen Object; the cross-device
 * hand-off is expressed as signals.
 *
 * The choreography, signal by signal:
 *
 *   host   ──game-pin────────▶  player   the join PIN, read off the lobby
 *   player ──player-in-lobby─▶  host     "I'm in — you can start"
 *   host   ──question-live───▶  player   the first question is on screen
 *   player ──answered────────▶  host     "my answer is in — advance"
 *
 * Scenario-scoped state (the quiz id, the host page object) travels through
 * `world`; per-actor configuration (credentials, the nickname) through
 * `actor.data` — see kraken.config.ts for where each value comes from.
 */
import { createStepRegistry } from '@kraken-e2e/gherkin';

import { PlayerApp } from '../screens/mobile/player-app.js';
import { GameHostPage } from '../screens/web/game-host-page.js';
import { LibraryPage } from '../screens/web/library-page.js';
import { LoginPage } from '../screens/web/login-page.js';

export const { Given, When, Then, registry } = createStepRegistry();

/* ────────────────────────────── the host (web) ───────────────────────────── */

Given('{actor} has signed in to Kahoot', async ({ actor }) => {
  const email = String(actor.data['KAHOOT_EMAIL'] ?? '');
  const password = String(actor.data['KAHOOT_PASSWORD'] ?? '');
  if (!email || !password) {
    throw new Error('Set KAHOOT_EMAIL and KAHOOT_PASSWORD in .env.host (copy .env.host.example).');
  }
  await new LoginPage(actor.session).signIn(email, password);
});

Given(
  '{actor} has located the {string} kahoot in their library',
  async ({ actor, world }, ...args) => {
    const [name] = args as unknown as [string];
    world['quizId'] = await new LibraryPage(actor.session).quizIdOf(name);
  },
);

When('{actor} launches it live in classic mode', async ({ actor, world }) => {
  world['game'] = await GameHostPage.launch(actor.session, String(world['quizId']));
});

When(
  '{actor} shares the game PIN with the players',
  { publishes: ['game-pin'] },
  async ({ actor, world }) => {
    const pin = await (world['game'] as GameHostPage).readPin();
    await actor.signals.publish('game-pin', { pin });
  },
);

When(
  '{actor} starts the round once the player is in the lobby',
  { publishes: ['question-live'] },
  async ({ actor, world }) => {
    // The player signals it has joined; the host then confirms a participant
    // actually appears in its OWN lobby before starting (see startRound).
    await actor.signals.waitFor('player-in-lobby', { timeoutMs: 180_000 });
    await (world['game'] as GameHostPage).startRound();
    await actor.signals.publish('question-live', {});
  },
);

Then('{actor} advances to the results once the answer is in', async ({ actor, world }) => {
  await actor.signals.waitFor('answered', { timeoutMs: 180_000 });
  await (world['game'] as GameHostPage).advanceToResults();
});

Then('{actor} sees their placement and leaves the game', async ({ world }) => {
  await (world['player'] as PlayerApp).finish();
});

/* ──────────────────────── the player (native Android) ────────────────────── */

When(
  '{actor} joins the shared game with their configured nickname',
  { publishes: ['player-in-lobby'] },
  async ({ actor, world }) => {
    const nickname = String(actor.data['nickname'] ?? 'Player');
    const { payload } = await actor.signals.waitFor<{ pin: string }>('game-pin', {
      timeoutMs: 300_000,
    });
    world['player'] = await PlayerApp.join(actor.session, payload.pin, nickname);
    await actor.signals.publish('player-in-lobby', {});
  },
);

When(
  '{actor} answers {string} as soon as the question appears',
  { publishes: ['answered'] },
  async ({ actor, world }, ...args) => {
    const [shape] = args as unknown as [string];
    await actor.signals.waitFor('question-live', { timeoutMs: 180_000 });
    await (world['player'] as PlayerApp).answer(shape);
    await actor.signals.publish('answered', {});
  },
);
