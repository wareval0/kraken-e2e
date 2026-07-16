/**
 * Conformance Test Kit (ADR-0001 §5.4 guardrail 2, ADR-0002 D8): exercises
 * every core operation against a driver + fixture and emits parity-report.json.
 * Parity is a GENERATED artifact: M1 closes only with zero `failing` entries
 * on both mobile platforms AND an empty diff between their supported-op sets
 * (symmetric unsupported(reason) allowed; asymmetric needs recorded sign-off).
 *
 * Uses vitest (optional peer — same pattern as @kraken-e2e/signaling/conformance).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  CORE_OPERATIONS,
  type CoreOperation,
  KrakenError,
  type TargetLocator,
  type UserSession,
} from '@kraken-e2e/contracts';
import { afterAll, describe, expect, it } from 'vitest';

export interface CtkFixture {
  /** An element that can be tapped without navigating away. */
  readonly tappable: TargetLocator;
  /** A text input to type into. */
  readonly typable: TargetLocator;
  /**
   * Where the typed value can be read back. Defaults to `typable`; real apps
   * often mirror input into a label (platforms differ on reading TextField
   * values directly — e.g. native-demo-app's '~input-text-result').
   */
  readonly typableEcho?: TargetLocator;
  /** A visible element with known text. */
  readonly readable: { readonly target: TargetLocator; readonly expected: string };
  /** Destination for navigate() (URL / deep link / fake route). */
  readonly navigateTo?: string;
}

export type CtkOperationOutcome =
  | { readonly status: 'supported' }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'failing'; readonly error: string };

export interface ParityReport {
  readonly driver: string;
  readonly generatedAt: string;
  readonly operations: Readonly<Record<CoreOperation, CtkOperationOutcome>>;
}

export interface CtkOptions {
  readonly name: string;
  /** Fresh session per operation; the CTK disposes it. */
  readonly createSession: () => Promise<UserSession>;
  readonly fixture: CtkFixture;
  /** Where parity-report.json is written (the C3 artifact). */
  readonly reportPath: string;
  /** Reasons for ops the driver declares unsupported (rendered in the report). */
  readonly unsupportedReasons?: Partial<Record<CoreOperation, string>>;
  /**
   * Runs after each createSession, before the operation is exercised — e.g.
   * navigate to the screen holding the fixture elements ('tap the Forms tab').
   */
  readonly prepare?: (session: UserSession) => Promise<void>;
}

async function exercise(
  op: CoreOperation,
  session: UserSession,
  fixture: CtkFixture,
): Promise<void> {
  switch (op) {
    case 'tap':
      return session.tap(fixture.tappable);
    case 'typeText': {
      await session.typeText(fixture.typable, 'kraken-ctk');
      const echoed = await session.readText(fixture.typableEcho ?? fixture.typable);
      expect(echoed).toBe('kraken-ctk');
      return;
    }
    case 'readText': {
      const text = await session.readText(fixture.readable.target);
      expect(text).toBe(fixture.readable.expected);
      return;
    }
    case 'waitFor':
      return session.waitFor(fixture.readable.target, 'visible', { timeoutMs: 5_000 });
    case 'isDisplayed': {
      expect(await session.isDisplayed(fixture.readable.target)).toBe(true);
      return;
    }
    case 'scrollIntoView':
      return session.scrollIntoView(fixture.readable.target);
    case 'pressKey':
      return session.pressKey('enter');
    case 'navigate':
      return session.navigate(fixture.navigateTo ?? 'ctk://noop');
    case 'screenshot': {
      const artifact = await session.screenshot();
      expect(artifact.kind).toBe('screenshot');
      expect(existsSync(artifact.path)).toBe(true);
      return;
    }
    case 'source': {
      const source = await session.source();
      expect(source.length).toBeGreaterThan(0);
      return;
    }
    case 'dispose': {
      await session.dispose();
      await session.dispose(); // idempotency is part of the contract
      return;
    }
  }
}

export function describeDriverConformance(options: CtkOptions): void {
  const outcomes = new Map<CoreOperation, CtkOperationOutcome>();

  describe(`Driver conformance (CTK): ${options.name}`, () => {
    for (const op of CORE_OPERATIONS) {
      it(`operation: ${op}`, async () => {
        const session = await options.createSession();
        try {
          await options.prepare?.(session);
          if (session.capabilities[op] === 'unsupported') {
            // A declared-unsupported op must throw the canonical error — visible
            // parity, never silent absence (ADR-0001 §5.4).
            const reason =
              options.unsupportedReasons?.[op] ?? 'declared unsupported (no reason given)';
            if (op !== 'dispose') {
              await expect(exercise(op, session, options.fixture)).rejects.toSatisfy(
                (error: unknown) =>
                  KrakenError.is(error) && error.code === 'KRK-SESSION-OP-UNSUPPORTED',
              );
            }
            outcomes.set(op, { status: 'unsupported', reason });
            return;
          }
          await exercise(op, session, options.fixture);
          outcomes.set(op, { status: 'supported' });
        } catch (error) {
          outcomes.set(op, {
            status: 'failing',
            error: error instanceof Error ? error.message : String(error),
          });
          throw error; // an op must pass OR be declared unsupported — never fail silently
        } finally {
          try {
            await session.dispose();
          } catch {
            // dispose problems surface in the dispose op's own test
          }
        }
      });
    }

    afterAll(() => {
      const operations = Object.fromEntries(
        CORE_OPERATIONS.map((op) => [
          op,
          outcomes.get(op) ?? { status: 'failing', error: 'not exercised' },
        ]),
      ) as Record<CoreOperation, CtkOperationOutcome>;
      const report: ParityReport = {
        driver: options.name,
        generatedAt: new Date().toISOString(),
        operations,
      };
      mkdirSync(dirname(options.reportPath), { recursive: true });
      writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    });
  });
}

/**
 * The M1 exit-gate comparison (ADR-0001 §5.4): zero failing entries on both
 * sides and an empty diff between supported-op sets. Returns human-readable
 * problems; empty array = parity.
 */
export function compareParityReports(a: ParityReport, b: ParityReport): readonly string[] {
  const problems: string[] = [];
  for (const op of CORE_OPERATIONS) {
    const left = a.operations[op];
    const right = b.operations[op];
    if (left.status === 'failing') problems.push(`${a.driver}: ${op} is failing (${left.error})`);
    if (right.status === 'failing') problems.push(`${b.driver}: ${op} is failing (${right.error})`);
    const leftSupported = left.status === 'supported';
    const rightSupported = right.status === 'supported';
    if (
      leftSupported !== rightSupported &&
      left.status !== 'failing' &&
      right.status !== 'failing'
    ) {
      problems.push(
        `asymmetric support for ${op}: ${a.driver}=${left.status}, ${b.driver}=${right.status} ` +
          '(requires recorded human sign-off — ADR-0001 §5.4)',
      );
    }
  }
  return problems;
}
