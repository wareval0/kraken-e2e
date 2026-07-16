/**
 * The M1 demo vocabulary: the fixture app's Forms screen doubles as a
 * "messaging" surface — the message travels between the REAL devices through
 * Kraken's signal bus (payload-carrying), which is exactly the
 * inter-communication primitive Kraken exists for.
 */
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, registry } = createStepRegistry();

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

When('{actor} opens the forms screen', async ({ actor }) => {
  await actor.session.navigate('wdio://forms');
  await actor.session.waitFor(a11y('Forms-screen'), 'visible', { timeoutMs: 20_000 });
});

When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [text] = args as unknown as [string];
  await actor.session.typeText(a11y('text-input'), text);
});

When(
  '{actor} transmits the composed text',
  { publishes: ['text-transmitted'] },
  async ({ actor }) => {
    // Read what the app actually shows (not what we intended to type) and
    // carry it across devices as the signal payload.
    const text = await actor.session.readText(a11y('input-text-result'));
    await actor.signals.publish('text-transmitted', { text });
  },
);

Then(
  '{actor} receives the transmitted text within {duration}',
  async ({ actor, world }, ...args) => {
    const [timeoutMs] = args as unknown as [number];
    const record = await actor.signals.waitFor<{ text: string }>('text-transmitted', {
      timeoutMs,
    });
    world['receivedText'] = record.payload.text;
  },
);

When('{actor} types the received text', async ({ actor, world }) => {
  await actor.session.typeText(a11y('text-input'), String(world['receivedText'] ?? ''));
});

Then(
  '{actor} sees the received text mirrored within {duration}',
  { polls: true },
  async ({ actor, world }, ...args) => {
    const [timeoutMs] = args as unknown as [number];
    const expected = String(world['receivedText'] ?? '');
    await actor.session.waitFor(a11y('input-text-result'), 'visible', { timeoutMs });
    const mirrored = await actor.session.readText(a11y('input-text-result'));
    if (mirrored !== expected) {
      throw new Error(`Expected the mirror to show "${expected}", found "${mirrored}".`);
    }
  },
);
