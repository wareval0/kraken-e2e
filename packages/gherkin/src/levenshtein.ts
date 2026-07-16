/**
 * Local copy (also in @kraken-e2e/signaling): gherkin depends only on
 * contracts+core (ADR-0001 §5.3), and 20 lines don't justify a new edge.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distance: number[] = Array.from({ length: rows * cols }, () => 0);
  for (let i = 0; i < rows; i += 1) distance[i * cols] = i;
  for (let j = 0; j < cols; j += 1) distance[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      distance[i * cols + j] = Math.min(
        (distance[(i - 1) * cols + j] ?? 0) + 1,
        (distance[i * cols + (j - 1)] ?? 0) + 1,
        (distance[(i - 1) * cols + (j - 1)] ?? 0) + substitutionCost,
      );
    }
  }
  return distance[rows * cols - 1] ?? 0;
}
