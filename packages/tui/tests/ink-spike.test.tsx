/**
 * THE SPIKE mandated by ADR-0001 §5.11: does ink-testing-library@4 (stale
 * since May 2024, tested against Ink 5/React 18) actually work under
 * Ink 7 + React 19.2 + Vitest? If this suite passes, the weak joint holds;
 * if it ever breaks, the recorded fallbacks are pinning Ink 6.8 or vendoring
 * a ~100-line render harness.
 */
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

function Probe({ label }: { readonly label: string }) {
  return <Text color="green">✓ {label}</Text>;
}

describe('ink-testing-library under Ink 7 + React 19.2 (the ADR-0001 §5.11 spike)', () => {
  it('renders, updates, and unmounts an Ink component tree', () => {
    const { lastFrame, rerender, unmount } = render(<Probe label="alice" />);
    expect(lastFrame()).toContain('✓ alice');
    rerender(<Probe label="bob" />);
    expect(lastFrame()).toContain('✓ bob');
    unmount();
  });
});
