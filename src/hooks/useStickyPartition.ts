import { useCallback, useEffect, useState } from 'react';

/**
 * Freeze each item's side of a two-way partition (e.g. active vs. past) for the
 * lifetime of this hook's mount, keyed by `id`.
 *
 * The motivating problem: income/expense cards live in one master list that the
 * UI splits into "active" and "past (ended)" sections purely by re-evaluating a
 * date predicate on every render. So the instant you end-date a card it flips
 * the predicate and the row *jumps* out of the section you're looking at (into a
 * collapsed "past" drawer), and the reverse on reactivation — disorienting.
 *
 * This hook decides each item's section once, on first sight, and holds that
 * decision steady while the tab stays mounted. Editing the end date updates the
 * card in place; it doesn't relocate. The partition re-settles naturally the
 * next time the tab mounts (switching tabs or reloading), which is when a jump
 * is no longer surprising because the user isn't mid-edit on that row.
 *
 * Newly-appearing items (e.g. just added) are classified live until the effect
 * below freezes them after commit — a fresh, end-date-less item is "active"
 * either way, so it still lands in the right section immediately.
 *
 * @param items    the full ordered list (both sections combined)
 * @param classify predicate that returns the *live* side for an item
 * @returns a frozen predicate returning the sticky side for a given item
 */
export function useStickyPartition<T extends { id: string }>(
    items: T[],
    classify: (item: T) => boolean,
): (item: T) => boolean {
    // A stable, mutable cache of frozen decisions. Held in state (not a ref) so
    // the returned predicate can read it during render without tripping the
    // "no refs during render" rule; it's never replaced, so it never re-renders.
    const [frozen] = useState(() => new Map<string, boolean>());

    // Freeze any not-yet-seen item after commit (an effect, so no render-time
    // writes). On the very first render `frozen` is empty and the predicate
    // falls through to `classify` — the live value, which is exactly the correct
    // section at mount before anything has been edited.
    useEffect(() => {
        for (const item of items) {
            if (!frozen.has(item.id)) frozen.set(item.id, classify(item));
        }
    });

    return useCallback(
        (item: T) => frozen.get(item.id) ?? classify(item),
        [frozen, classify],
    );
}
