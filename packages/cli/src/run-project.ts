/**
 * The `kraken run` pipeline, extracted from the oclif command so it is plain-
 * function testable: load config → import the step registry → glob+compile
 * features (dry-run analyzer) → build the driver registry → run on the
 * orchestrator with Line+JSONL reporters.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { loadConfig } from '@kraken-e2e/config';
import { KrakenError } from '@kraken-e2e/contracts';
import {
  createHostContext,
  type DriverRegistration,
  DriverRegistry,
  runScenarios,
  systemHostProbe,
} from '@kraken-e2e/core';
import { compileFeatures, isStepRegistry, type StepRegistry } from '@kraken-e2e/gherkin';
import {
  createAllureReporter,
  createCtrfReporter,
  createJsonlReporter,
  createLineReporter,
} from '@kraken-e2e/reporters';
import { InMemoryTransport, SignalBus } from '@kraken-e2e/signaling';
import { createJiti } from 'jiti';
import { glob } from 'tinyglobby';

export interface RunProjectOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly tags?: string;
  readonly dryRun?: boolean;
  /** Force the plain line renderer (default: Ink when TTY and not CI). */
  readonly plain?: boolean;
  /** All human-readable output flows through here (stdout discipline). */
  readonly write: (line: string) => void;
}

export interface RunProjectResult {
  readonly exitCode: number;
  readonly runId?: string;
  readonly eventsPath?: string;
}

async function importStepRegistry(projectRoot: string, stepsPath: string): Promise<StepRegistry> {
  const absolute = isAbsolute(stepsPath) ? stepsPath : resolve(projectRoot, stepsPath);
  const jiti = createJiti(join(projectRoot, 'package.json'));
  let moduleExports: { registry?: unknown };
  try {
    moduleExports = (await jiti.import(absolute)) as { registry?: unknown };
  } catch (cause) {
    throw new KrakenError(
      'KRK-CONFIG-INVALID',
      `Failed to load the steps module ${stepsPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, fix: 'Point config.steps at a module that exports your step `registry`.' },
    );
  }
  const registry = moduleExports.registry;
  // Brand check, not instanceof: jiti may load its own copy of @kraken-e2e/gherkin.
  if (!isStepRegistry(registry)) {
    throw new KrakenError(
      'KRK-CONFIG-INVALID',
      `The steps module ${stepsPath} does not export a \`registry\` created by createStepRegistry().`,
      {
        fix: 'export const { Given, When, Then, registry } = createStepRegistry(); — and import your step files from that module.',
      },
    );
  }
  return registry;
}

/** Read an env-format file into a plain object (per-actor data source). */
function loadEnvObject(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = parseEnv(readFileSync(path, 'utf8'));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export async function runProject(options: RunProjectOptions): Promise<RunProjectResult> {
  const { write } = options;
  const config = await loadConfig({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
  });

  const registry = await importStepRegistry(config.projectRoot, config.steps ?? './steps/index.ts');

  const featureFiles = await glob([...config.features], {
    cwd: config.projectRoot,
    absolute: true,
  });
  if (featureFiles.length === 0) {
    write(`No feature files matched ${config.features.join(', ')} under ${config.projectRoot}.`);
    return { exitCode: 1 };
  }
  const sources = featureFiles.sort().map((uri) => ({ uri, content: readFileSync(uri, 'utf8') }));

  const actors = Object.entries(config.actors).map(([id, actorConfig]) => {
    const { platform, data, env, ...rest } = actorConfig as {
      platform: string;
      data?: Record<string, unknown>;
      env?: string;
      [k: string]: unknown;
    };
    // Per-actor data: an optional env-format file, overlaid by inline `data`.
    const fromFile = typeof env === 'string' ? loadEnvObject(join(config.projectRoot, env)) : {};
    const merged = { ...fromFile, ...(data ?? {}) };
    return {
      id,
      platform,
      config: rest,
      ...(Object.keys(merged).length > 0 ? { data: merged } : {}),
    };
  });

  // ── Dry-run analysis: ALWAYS runs; kraken refuses to start on errors ──
  const compiled = compileFeatures({
    sources,
    registry,
    actors,
    ...(options.tags !== undefined ? { tagFilter: options.tags } : {}),
  });
  for (const diagnostic of compiled.diagnostics) {
    write(
      `${diagnostic.severity === 'error' ? '✗' : '!'} [${diagnostic.code}] ${diagnostic.uri}` +
        `${diagnostic.scenario ? ` › ${diagnostic.scenario}` : ''}: ${diagnostic.message}`,
    );
  }
  if (!compiled.ok) {
    write('\nCompilation failed — nothing was executed (no sessions were booted).');
    return { exitCode: 1 };
  }
  if (options.dryRun) {
    write(
      `\nDry run OK: ${compiled.plans.length} scenario(s), ` +
        `${compiled.plans.reduce((sum, plan) => sum + plan.nodes.length, 0)} step(s), ` +
        `actors: ${[...new Set(compiled.plans.flatMap((plan) => plan.actors.map((actor) => actor.id)))].join(', ')}.`,
    );
    return { exitCode: 0 };
  }

  // ── Real execution ──
  const host = systemHostProbe.detect();
  const driverRegistry = await DriverRegistry.create({
    registrations: config.drivers as readonly DriverRegistration[],
    host,
    projectRoot: config.projectRoot,
  });
  for (const status of driverRegistry.statuses()) {
    if (status.state === 'unavailable-on-host') {
      write(`! driver "${status.manifest.id}" disabled on this host: ${status.reason}`);
      write(`  fix: ${status.fix}`);
    }
  }

  const runId = randomUUID();
  const artifactsDir = join(config.projectRoot, '.kraken', 'runs', runId);
  const eventsPath = join(artifactsDir, 'events.jsonl');

  // Renderer selection (ADR-0001 §5.11): Ink lanes on a TTY, plain lines
  // otherwise — never Ink's final-frame CI mode for a long-running test run.
  const live =
    options.plain !== true && process.stdout.isTTY === true && process.env['CI'] === undefined;
  let finishInk: (() => Promise<void>) | undefined;
  let liveReporter = createLineReporter(write);
  if (live) {
    const { createInkReporter } = await import('@kraken-e2e/tui');
    const handle = createInkReporter();
    liveReporter = handle.reporter;
    finishInk = handle.finish;
  }

  let result: Awaited<ReturnType<typeof runScenarios>>;
  try {
    result = await runScenarios({
      plans: compiled.plans,
      registry: driverRegistry,
      signalBus: new SignalBus(new InMemoryTransport()),
      hostContext: createHostContext(host, config.projectRoot),
      reporters: [
        liveReporter,
        createJsonlReporter(eventsPath),
        // ADR-0006 part B: Allure + CTRF are always-on projections (cheap).
        createAllureReporter(join(artifactsDir, 'allure-results')),
        createCtrfReporter(join(artifactsDir, 'ctrf-report.json')),
      ],
      artifactsDir,
      runId,
      ...(config.screenshots !== undefined ? { screenshots: config.screenshots } : {}),
      onReporterError: (reporterId, error) =>
        write(
          `! reporter "${reporterId}" failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
  } finally {
    // The Ink instance MUST unmount on throw paths too (driver-start failures,
    // host-disabled bindings) — a patched console with a frozen frame would
    // swallow the error rendering otherwise.
    await finishInk?.();
  }
  write(`\nEvent log: ${eventsPath}`);
  write(
    `Allure results: ${join(artifactsDir, 'allure-results')} — html: npx allure generate <dir> -o <out>`,
  );
  write(`CTRF report: ${join(artifactsDir, 'ctrf-report.json')}`);
  return { exitCode: result.status === 'passed' ? 0 : 1, runId, eventsPath };
}
