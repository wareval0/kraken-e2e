import { ParameterType, ParameterTypeRegistry } from '@cucumber/cucumber-expressions';

/** Parses '10s' / '500ms' / '2m' into milliseconds ({duration} — ADR-0004 D1). */
export function parseDuration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(text);
  if (!match) {
    throw new Error(`Invalid duration "${text}" — use e.g. "500ms", "10s", "2m".`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const ms = unit === 'ms' ? value : unit === 's' ? value * 1_000 : value * 60_000;
  if (ms <= 0) {
    throw new Error(`Duration "${text}" must be positive.`);
  }
  return ms;
}

/**
 * The registry with Kraken's built-in parameter types:
 * - {actor}: a bare name (alice) or a quoted alias ("the moderator"); validated
 *   against the closed actor set at COMPILE time (did-you-mean), not here.
 * - {duration}: '10s' / '500ms' / '2m' → milliseconds.
 *
 * NOTE for editor autocomplete (LSP spike, ADR-0004 appendix B): the VS Code
 * Cucumber extension cannot see these (they live in node_modules), so
 * `kraken init` scaffolds cucumber.parameterTypes in .vscode/settings.json
 * with regexps kept byte-identical to the ones below.
 */
export const ACTOR_REGEXP = /[a-zA-Z][a-zA-Z0-9_-]*|"[^"]+"/;
export const DURATION_REGEXP = /\d+(?:\.\d+)?(?:ms|s|m)/;

export function createParameterTypeRegistry(): ParameterTypeRegistry {
  const registry = new ParameterTypeRegistry();
  registry.defineParameterType(
    new ParameterType<string>(
      'actor',
      ACTOR_REGEXP,
      String,
      (value: string) => value.replace(/^"|"$/g, ''),
      false,
      false,
    ),
  );
  registry.defineParameterType(
    new ParameterType<number>('duration', DURATION_REGEXP, Number, parseDuration, false, false),
  );
  return registry;
}
