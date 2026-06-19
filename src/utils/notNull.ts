/**
 * Type-guard predicate for `.filter(notNull)` — narrows `(T | null)[]` to `T[]`.
 * Shared so the Monte Carlo runner (main thread) and worker can't drift apart.
 */
export function notNull<T>(x: T | null): x is T {
    return x !== null;
}
