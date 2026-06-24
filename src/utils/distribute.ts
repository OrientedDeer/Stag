/**
 * Allocate a single `total` across `weights`, giving every item a share
 * proportional to its weight and handing the LAST item the remainder so the
 * shares sum back to `total` exactly (no proportional-rounding drift).
 *
 * This is the "split a deposit/balance across feeders, last one absorbs the
 * remainder" idiom shared by the cashflow per-income deferral split and the
 * SimpleFIN multi-target balance split. Both sites were hand-rolling it.
 *
 * `round` is applied to each non-final share AND to the running allocated
 * total before the final remainder is computed — this matches the SimpleFIN
 * split, which rounds to cents at every step so the remainder is the exact
 * leftover of the already-rounded shares. When omitted, shares are exact
 * (the cashflow split needs full precision).
 *
 * A zero or negative `total` of weights falls back to an even split so a
 * degenerate all-zero-weight input still distributes the whole total.
 */
export function distributeProportional(
    total: number,
    weights: number[],
    round: (n: number) => number = (n) => n,
): number[] {
    const n = weights.length;
    if (n === 0) return [];

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let allocated = 0;
    return weights.map((w, i) => {
        const isLast = i === n - 1;
        const share = isLast
            ? round(total - allocated)
            : round(totalWeight > 0 ? total * (w / totalWeight) : total / n);
        allocated = round(allocated + share);
        return share;
    });
}
