/**
 * The project's step vocabulary. App-domain steps live HERE, in the user's
 * project — Kraken ships only choreography steps (ADR-0004 D4). Note the
 * shape: destructured bare Given/When/Then calls with literal expressions —
 * exactly what the Cucumber VS Code extension indexes (ADR-0004 appendix B).
 */
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, registry } = createStepRegistry();

const byTestId = (value: string) => ({ by: 'testId', value }) as const;

When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [message] = args as unknown as [string];
  await actor.session.typeText(byTestId('composer'), message);
});

When('{actor} taps send', { publishes: ['message-sent'] }, async ({ actor }) => {
  await actor.session.tap(byTestId('send-button'));
  const text = await actor.session.readText(byTestId('composer'));
  await actor.signals.publish('message-sent', { text });
});

Then(
  '{actor} sees the message {string} on {string} within {duration}',
  { polls: true },
  async ({ actor }, ...args) => {
    const [expected, testId, timeoutMs] = args as unknown as [string, string, number];
    await actor.session.waitFor(byTestId(testId), 'visible', { timeoutMs });
    const text = await actor.session.readText(byTestId(testId));
    if (text !== expected) {
      throw new Error(`Expected "${expected}" on ${testId}, found "${text}".`);
    }
  },
);

When(
  '{actor} starts recording the conversation as {string}',
  { detached: true },
  async ({ actor }) => {
    // A long-running background action (screen recording, upload, stream…):
    // here simulated as watching the message cell for a while.
    await actor.session.waitFor(byTestId('message-cell'), 'visible', { timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
);
