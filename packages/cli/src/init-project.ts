/**
 * `kraken init` scaffolding (ADR-0005): a runnable project skeleton plus the
 * .vscode Cucumber settings that make {actor}/{duration} autocomplete work
 * (the extension cannot see parameter types inside node_modules —
 * ADR-0004 Appendix B). Never overwrites existing files.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Kept byte-identical to @kraken-e2e/gherkin's ACTOR_REGEXP/DURATION_REGEXP
// sources (ADR-0004 Appendix B) — the runtime matcher and the editor must
// agree. There is a test pinning this.
export const VSCODE_PARAMETER_TYPES = [
  { name: 'actor', regexp: '[a-zA-Z][a-zA-Z0-9_-]*|"[^"]+"' },
  { name: 'duration', regexp: '\\d+(?:\\.\\d+)?(?:ms|s|m)' },
];

const FILES: Record<string, string> = {
  'kraken.config.ts': `import { defineConfig } from '@kraken-e2e/config';

export default defineConfig({
  actors: {
    // The CLOSED actor set: steps naming anyone else are compile errors.
    alice: { platform: 'android' },
    bob: { platform: 'ios' },
  },
  drivers: [
    // Install drivers with: kraken plugins install @kraken-e2e/driver-android
  ],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
`,
  'steps/index.ts': `import { createStepRegistry } from '@kraken-e2e/gherkin';

// Destructure — bare Given/When/Then call sites are what the Cucumber VS Code
// extension indexes (namespaced calls lose autocomplete).
export const { Given, When, Then, defineParameterType, registry } = createStepRegistry();

// Your app-domain steps live here. Example:
// When('{actor} sends the message {string}', async ({ actor }, ...args) => {
//   const [message] = args as unknown as [string];
//   await actor.session.typeText({ by: 'testId', value: 'composer' }, message);
//   await actor.session.tap({ by: 'testId', value: 'send' });
// });
`,
  'features/example.feature': `Feature: My first choreography
  Steps run in text order (the screenplay); signals and background tasks are
  the escape hatches. See the Kraken docs for the built-in vocabulary.

  Scenario: two users, one story
    # When alice sends the message "hola"
    # Then bob waits for the signal "message-sent" within 10s
`,
  '.vscode/settings.json': `${JSON.stringify(
    {
      'cucumber.features': ['features/**/*.feature'],
      'cucumber.glue': ['steps/**/*.ts'],
      'cucumber.parameterTypes': VSCODE_PARAMETER_TYPES,
    },
    null,
    2,
  )}\n`,
};

export function initProject(options: {
  readonly cwd: string;
  readonly write: (line: string) => void;
}): number {
  for (const [relative, content] of Object.entries(FILES)) {
    const path = join(options.cwd, relative);
    if (existsSync(path)) {
      options.write(`skip (exists): ${relative}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    options.write(`created: ${relative}`);
  }
  options.write('\nNext steps:');
  options.write('  1. kraken plugins install @kraken-e2e/driver-android   (and/or -ios, -web)');
  options.write('  2. write steps in steps/index.ts and scenarios in features/');
  options.write('  3. kraken doctor    (verify your environment)');
  options.write('  4. kraken run');
  return 0;
}
