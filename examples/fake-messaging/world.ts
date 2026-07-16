/**
 * The fake "app + backend" this example choreographs: alice composes on the
 * (fake) Android app; the backend delivers to bob's (fake) iOS app and carol's
 * (fake) web dashboard after simulated network latency. Swapping FakeDriver
 * for the real drivers in Phase 2/3 changes ONLY the config — the feature
 * file and steps stay as they are.
 */
import { FakeAppWorld } from '@kraken-e2e/core/testing';

export function createMessagingWorld(): FakeAppWorld {
  const world = new FakeAppWorld();

  world.setElement('alice', 'composer', { text: '', visible: true });
  world.setElement('alice', 'send-button', { text: 'Send', visible: true });
  world.setElement('bob', 'message-cell', { text: '', visible: false });
  world.setElement('carol', 'feed-cell', { text: '', visible: false });

  world.onAction = (action, w) => {
    if (
      action.op === 'tap' &&
      action.target?.by === 'testId' &&
      action.target.value === 'send-button'
    ) {
      const message = w.getElement('alice', 'composer')?.text ?? '';
      // Simulated backend fan-out: 80ms to bob's device, 120ms to carol's web feed.
      w.after(80, () => w.setElement('bob', 'message-cell', { text: message, visible: true }));
      w.after(120, () => w.setElement('carol', 'feed-cell', { text: message, visible: true }));
    }
  };

  return world;
}
