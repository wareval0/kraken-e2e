/**
 * THE FLAGSHIP vocabulary: a message relayed across THREE platforms. One
 * portable locator strategy — { by: 'a11y' } — resolves to accessibility ids
 * on Android/iOS and [aria-label] on web, so every step below is
 * platform-agnostic and every actor can run every step.
 */
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, registry } = createStepRegistry();

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

When('{actor} opens the composer', async ({ actor }) => {
  if (actor.platform === 'web') {
    // carol's baseUrl already opened the relay page; just confirm it.
    await actor.session.waitFor(a11y('Relay-screen'), 'visible', { timeoutMs: 15_000 });
    return;
  }
  await actor.session.navigate('wdio://forms');
  await actor.session.waitFor(a11y('Forms-screen'), 'visible', { timeoutMs: 20_000 });
});

When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [text] = args as unknown as [string];
  await actor.session.typeText(a11y('text-input'), text);
});

When(
  '{actor} relays the composed text as {string}',
  { publishes: ['relay'] },
  async ({ actor }, ...args) => {
    const [hop] = args as unknown as [string];
    const text = await actor.session.readText(a11y('input-text-result'));
    await actor.signals.publish('relay', { hop, text });
  },
);

Then('{actor} receives the {string} relay within {duration}', async ({ actor, world }, ...args) => {
  const [hop, timeoutMs] = args as unknown as [string, number];
  // Payload-carrying wait: each hop is a distinct payload on one signal
  // name; FIFO cursors deliver each subscriber every hop in order.
  let record = await actor.signals.waitFor<{ hop: string; text: string }>('relay', {
    timeoutMs,
  });
  while (record.payload.hop !== hop) {
    record = await actor.signals.waitFor<{ hop: string; text: string }>('relay', { timeoutMs });
  }
  world[`received:${actor.id}`] = record.payload.text;
});

When('{actor} forwards the received text', async ({ actor, world }) => {
  await actor.session.typeText(a11y('text-input'), String(world[`received:${actor.id}`] ?? ''));
});

Then('{actor} sees the relayed text mirrored', async ({ actor, world }) => {
  const expected = String(world[`received:${actor.id}`] ?? '');
  const mirrored = await actor.session.readText(a11y('input-text-result'));
  if (mirrored !== expected) {
    throw new Error(`Expected the mirror to show "${expected}", found "${mirrored}".`);
  }
});
