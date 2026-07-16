/**
 * FakeDriver (ADR-0002 D9): a first-class in-memory driver implementing the
 * full contract, NOT test scaffolding. Per-actor screens plus a SHARED
 * FakeAppWorld let one actor's action change another actor's screen after a
 * configurable latency — so the whole engine (orchestrator, scheduler,
 * signaling, reporting) exercises real cross-actor E2E with zero devices.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ArtifactRef,
  CORE_OPERATIONS,
  type CoreOperation,
  type DriverServices,
  defineDriver,
  type KrakenDriver,
  KrakenError,
  type ResolvedActor,
  type SemanticKey,
  type SessionWaitOptions,
  type TargetLocator,
  type UserSession,
  type WaitState,
} from '@kraken-e2e/contracts';

export interface FakeElement {
  text: string;
  visible: boolean;
}

export interface FakeAction {
  readonly actorId: string;
  readonly op: 'tap' | 'typeText' | 'pressKey' | 'navigate' | 'scrollIntoView';
  readonly target?: TargetLocator;
  readonly text?: string;
  readonly key?: SemanticKey;
  readonly destination?: string;
}

/**
 * The shared "app backend": per-actor screens plus latency-simulated effects.
 * Wire app behavior with onAction — e.g. when alice taps "send", set bob's
 * message cell after 120ms.
 */
export class FakeAppWorld {
  readonly #screens = new Map<string, Map<string, FakeElement>>();
  readonly actions: FakeAction[] = [];
  #pendingEffects = 0;
  /** App behavior hook — the "backend logic" of the fake app. */
  onAction: ((action: FakeAction, world: FakeAppWorld) => void) | undefined;

  screen(actorId: string): Map<string, FakeElement> {
    let screen = this.#screens.get(actorId);
    if (!screen) {
      screen = new Map();
      this.#screens.set(actorId, screen);
    }
    return screen;
  }

  setElement(actorId: string, testId: string, element: FakeElement): this {
    this.screen(actorId).set(testId, { ...element });
    return this;
  }

  getElement(actorId: string, testId: string): FakeElement | undefined {
    return this.screen(actorId).get(testId);
  }

  /** Simulates app latency: apply an effect after `ms` (e.g. message delivery). */
  after(ms: number, effect: () => void): void {
    this.#pendingEffects += 1;
    setTimeout(() => {
      try {
        effect();
      } finally {
        this.#pendingEffects -= 1;
      }
    }, ms);
  }

  get pendingEffects(): number {
    return this.#pendingEffects;
  }

  record(action: FakeAction): void {
    this.actions.push(action);
    this.onAction?.(action, this);
  }
}

export interface FakeDriverOptions {
  readonly world: FakeAppWorld;
  /** Driver id (default 'fake'). */
  readonly id?: string;
  /** Platforms this fake provides (default ['fake']). */
  readonly platforms?: readonly string[];
  /** Simulate a host-gated driver (the C4b test uses a darwin-only fake). */
  readonly hostRequirements?: { readonly platforms?: readonly string[] };
  /** Ops to declare unsupported (they throw KRK-SESSION-OP-UNSUPPORTED). */
  readonly unsupported?: readonly CoreOperation[];
  /** Make specific ops fail (orchestrator failure-path tests). */
  readonly failOn?: { readonly op: CoreOperation; readonly actorId?: string };
  /** Per-op artificial latency in ms. */
  readonly opLatencyMs?: number;
}

class FakeSession implements UserSession {
  readonly actorId: string;
  readonly driverId: string;
  readonly platform: string;
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;
  #disposed = false;
  #screenshotCount = 0;

  constructor(
    private readonly world: FakeAppWorld,
    private readonly options: FakeDriverOptions,
    actor: ResolvedActor,
    private readonly services: DriverServices,
  ) {
    this.actorId = actor.id;
    this.driverId = options.id ?? 'fake';
    this.platform = actor.platform;
    const unsupported = new Set(options.unsupported ?? []);
    this.capabilities = Object.fromEntries(
      CORE_OPERATIONS.map((op) => [op, unsupported.has(op) ? 'unsupported' : 'supported']),
    ) as Record<CoreOperation, 'supported' | 'unsupported'>;
  }

  async #guard(op: CoreOperation): Promise<void> {
    if (this.capabilities[op] === 'unsupported') {
      throw new KrakenError(
        'KRK-SESSION-OP-UNSUPPORTED',
        `Operation "${op}" is not supported by ${this.driverId} (declared in capabilities).`,
      );
    }
    if (this.options.failOn?.op === op) {
      const { actorId } = this.options.failOn;
      if (actorId === undefined || actorId === this.actorId) {
        throw new KrakenError('KRK-STEP-FAILED', `Injected failure on ${op} for ${this.actorId}.`);
      }
    }
    const latency = this.options.opLatencyMs ?? 0;
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
  }

  #find(target: TargetLocator): FakeElement {
    const element = this.#lookup(target);
    if (!element) {
      throw new KrakenError(
        'KRK-SESSION-ELEMENT-NOT-FOUND',
        `Actor "${this.actorId}" has no element matching ${target.by}="${target.value}".`,
        { data: { target: { ...target } } },
      );
    }
    return element;
  }

  #lookup(target: TargetLocator): FakeElement | undefined {
    const screen = this.world.screen(this.actorId);
    if (target.by === 'testId' || target.by === 'a11y' || target.by === 'native') {
      return screen.get(target.value);
    }
    // by text: first element whose text matches
    for (const element of screen.values()) {
      const matches = target.exact
        ? element.text === target.value
        : element.text.includes(target.value);
      if (matches) return element;
    }
    return undefined;
  }

  async tap(target: TargetLocator): Promise<void> {
    await this.#guard('tap');
    this.#find(target);
    this.world.record({ actorId: this.actorId, op: 'tap', target });
  }

  async typeText(target: TargetLocator, text: string): Promise<void> {
    await this.#guard('typeText');
    const element = this.#find(target);
    element.text = text;
    this.world.record({ actorId: this.actorId, op: 'typeText', target, text });
  }

  async readText(target: TargetLocator): Promise<string> {
    await this.#guard('readText');
    return this.#find(target).text;
  }

  async waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void> {
    await this.#guard('waitFor');
    const timeoutMs = opts?.timeoutMs ?? 1_000;
    const pollMs = opts?.pollMs ?? 15;
    const startedAt = Date.now();
    for (;;) {
      const element = this.#lookup(target);
      const satisfied =
        state === 'visible'
          ? element?.visible === true
          : state === 'hidden'
            ? element === undefined || element.visible === false
            : element !== undefined; // 'attached'
      if (satisfied) return;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new KrakenError(
          'KRK-SESSION-WAIT-TIMEOUT',
          `Actor "${this.actorId}" waited ${timeoutMs}ms for ${target.by}="${target.value}" to be ${state}.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async isDisplayed(target: TargetLocator): Promise<boolean> {
    await this.#guard('isDisplayed');
    return this.#lookup(target)?.visible === true;
  }

  async scrollIntoView(target: TargetLocator): Promise<void> {
    await this.#guard('scrollIntoView');
    this.#find(target);
    this.world.record({ actorId: this.actorId, op: 'scrollIntoView', target });
  }

  async pressKey(key: SemanticKey): Promise<void> {
    await this.#guard('pressKey');
    this.world.record({ actorId: this.actorId, op: 'pressKey', key });
  }

  async navigate(destination: string): Promise<void> {
    await this.#guard('navigate');
    this.world.record({ actorId: this.actorId, op: 'navigate', destination });
  }

  async screenshot(): Promise<ArtifactRef> {
    await this.#guard('screenshot');
    this.#screenshotCount += 1;
    const path = join(
      this.services.artifactsDir,
      `${this.actorId}-screen-${this.#screenshotCount}.txt`,
    );
    writeFileSync(path, await this.source());
    return { kind: 'screenshot', path };
  }

  async source(): Promise<string> {
    await this.#guard('source');
    const screen = this.world.screen(this.actorId);
    return JSON.stringify(Object.fromEntries(screen.entries()), null, 2);
  }

  async dispose(): Promise<void> {
    // Idempotent by contract.
    this.#disposed = true;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  native<K extends never>(kind: K): never {
    throw new KrakenError(
      'KRK-SESSION-OP-UNSUPPORTED',
      `FakeDriver has no native session (requested "${String(kind)}").`,
    );
  }
}

/** Build a fake driver bound to a shared world. Dogfoods defineDriver(). */
export function createFakeDriver(options: FakeDriverOptions): KrakenDriver<FakeDriverOptions> {
  const factory = defineDriver<FakeDriverOptions>((opts) => ({
    manifest: {
      id: opts.id ?? 'fake',
      platforms: [...(opts.platforms ?? ['fake'])],
      version: '0.0.0',
      platformLabel: `Fake (${opts.id ?? 'fake'}, in-memory)`,
      ...(opts.hostRequirements !== undefined
        ? {
            hostRequirements: { platforms: opts.hostRequirements.platforms ?? [] },
            disabledFix: 'This fake driver is host-gated for testing purposes.',
          }
        : {}),
    },
    start: async () => {},
    createSession: async (actor, services) => new FakeSession(opts.world, opts, actor, services),
    stop: async () => {},
  }));
  return factory(options);
}
