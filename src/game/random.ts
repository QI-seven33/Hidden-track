/** Seeded xorshift32. Persisting the seed makes a match reproducible. */
export function nextRandom(seed: number): [number, number] {
  let value = seed || 0x9e3779b9;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const next = value >>> 0;
  return [next / 0x100000000, next];
}
export function shuffled<T>(items: readonly T[], seed: number): [T[], number] {
  const result = [...items];
  let current = seed;
  for (let i = result.length - 1; i > 0; i--) {
    const [random, next] = nextRandom(current);
    current = next;
    const j = Math.floor(random * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return [result, current];
}
