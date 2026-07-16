import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CONTRACT_VERSION,
  CORE_OPERATIONS,
  type CoreOperation,
  checkHostRequirements,
  DRIVER_BRAND,
  defineDriver,
  isContractCompatible,
  isKrakenDriver,
  KrakenError,
  serializeError,
  type UserSession,
} from '../src/index.ts';

describe('contract version', () => {
  it('compatibility rule: same major, plugin minor <= host minor', () => {
    expect(isContractCompatible({ major: 1, minor: 2 }, { major: 1, minor: 5 })).toBe(true);
    expect(isContractCompatible({ major: 1, minor: 5 }, { major: 1, minor: 2 })).toBe(false);
    expect(isContractCompatible({ major: 2, minor: 0 }, { major: 1, minor: 9 })).toBe(false);
    expect(isContractCompatible(CONTRACT_VERSION, CONTRACT_VERSION)).toBe(true);
  });
});

describe('checkHostRequirements (pure — the C4b gating logic)', () => {
  const linuxHost = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' } as const;
  const macHost = { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0' } as const;

  it('rejects a darwin-only requirement on linux, with an actionable fix', () => {
    const result = checkHostRequirements({ platforms: ['darwin'] }, linuxHost);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('darwin');
      expect(result.reason).toContain('linux');
      expect(result.fix).toBeTruthy();
    }
  });

  it('accepts a darwin-only requirement on darwin', () => {
    expect(checkHostRequirements({ platforms: ['darwin'] }, macHost).ok).toBe(true);
  });

  it('accepts when no requirements are declared', () => {
    expect(checkHostRequirements(undefined, linuxHost).ok).toBe(true);
  });

  it('enforces arch and node floors', () => {
    expect(checkHostRequirements({ archs: ['arm64'] }, linuxHost).ok).toBe(false);
    expect(checkHostRequirements({ minNodeMajor: 24 }, linuxHost).ok).toBe(false);
    expect(checkHostRequirements({ minNodeMajor: 22 }, linuxHost).ok).toBe(true);
  });
});

describe('defineDriver', () => {
  const fake = defineDriver<{ flag?: boolean }>(() => ({
    manifest: {
      id: 'fake',
      platforms: ['fake'],
      version: '0.0.0',
      platformLabel: 'Fake (in-memory)',
    },
    start: async () => {},
    createSession: async () => {
      throw new Error('not implemented');
    },
    stop: async () => {},
  }));

  it('bakes the brand, kind, and CONTRACT_VERSION into the produced driver', () => {
    const driver = fake({ flag: true });
    expect(driver[DRIVER_BRAND]).toBe(true);
    expect(driver.manifest.kind).toBe('kraken-driver');
    expect(driver.manifest.contract).toEqual(CONTRACT_VERSION);
    expect(isKrakenDriver(driver)).toBe(true);
    expect(isKrakenDriver({ manifest: {} })).toBe(false);
  });

  it('brand survives duplicate contract copies (Symbol.for global registry)', () => {
    expect(Symbol.for('kraken.driver/v1')).toBe(DRIVER_BRAND);
  });
});

describe('KrakenError', () => {
  it('serializes to the event-carriable shape', () => {
    const error = new KrakenError('KRK-HOST-IOS-UNSUPPORTED', 'iOS needs macOS', {
      fix: 'Run on macOS',
      data: { host: 'linux' },
    });
    expect(error.toJSON()).toEqual({
      code: 'KRK-HOST-IOS-UNSUPPORTED',
      message: 'iOS needs macOS',
      fix: 'Run on macOS',
      data: { host: 'linux' },
    });
  });

  it('wrap preserves KrakenErrors and wraps foreign ones with cause', () => {
    const original = new KrakenError('KRK-CONFIG-INVALID', 'bad');
    expect(KrakenError.wrap(original, 'KRK-STEP-FAILED')).toBe(original);
    const wrapped = KrakenError.wrap(new Error('boom'), 'KRK-STEP-FAILED', 'step exploded');
    expect(wrapped.code).toBe('KRK-STEP-FAILED');
    expect(wrapped.message).toContain('boom');
    expect(serializeError('plain string').message).toBe('plain string');
  });
});

describe('core surface integrity', () => {
  it('CORE_OPERATIONS matches the UserSession method surface (parity-report basis)', () => {
    // Compile-time: every CoreOperation is a UserSession method name.
    expectTypeOf<CoreOperation>().toExtend<keyof UserSession>();
    // Runtime sanity: the list is unique and non-empty.
    expect(new Set(CORE_OPERATIONS).size).toBe(CORE_OPERATIONS.length);
    expect(CORE_OPERATIONS).toContain('dispose');
  });
});
