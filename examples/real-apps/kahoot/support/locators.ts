/**
 * Locator factories shared by the Screen Objects, so pages read as intent
 * ("tap the sign-in button") instead of selector plumbing. Which strategy for
 * which surface:
 *
 *  - `text`   portable visible text (web + native) — labels and buttons.
 *  - `a11y`   accessibility id (aria-label on web, content-desc on Android).
 *  - `testId` a stable test id (data-testid on web, resource-id on Android).
 *  - `css`    raw web CSS — the escape hatch for a third-party site we don't
 *             control (Kahoot exposes stable `data-functional-selector` hooks).
 *  - `ui`     raw Android UiAutomator — same escape hatch on the native app
 *             (Jetpack Compose exposes few ids).
 *
 * Every selector below was captured with `npx kraken inspect <actor>` against
 * the live app — the inspector ranks candidates by page-wide uniqueness, so
 * what you paste here is what your run will actually find.
 */
import type { TargetLocator } from '@kraken-e2e/contracts';

export const text = (value: string): TargetLocator => ({ by: 'text', value, exact: true });
export const a11y = (value: string): TargetLocator => ({ by: 'a11y', value });
export const testId = (value: string): TargetLocator => ({ by: 'testId', value });
export const css = (value: string): TargetLocator => ({ by: 'native', value });
export const ui = (value: string): TargetLocator => ({ by: 'native', value });
