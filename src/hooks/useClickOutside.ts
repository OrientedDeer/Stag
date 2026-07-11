import { useEffect, type RefObject } from 'react';

/**
 * Call `onOutside` when a pointer press lands outside every supplied ref.
 *
 * - `active` gates the listener so it's only attached while it matters.
 * - The listener is attached on a deferred tick (a microtask via setTimeout 0),
 *   so the very click that opened the surface doesn't immediately dismiss it.
 * - Multiple "inside" refs are supported: a press inside ANY of them is treated
 *   as inside. (The Sankey popover passes both the popover and the chart
 *   container, so clicking a chart node is handled by the node's own click
 *   handler rather than being double-counted as an outside dismissal.)
 *
 * Uses `mousedown` so dismissal happens on press, matching the app's other
 * overlays; refs whose `.current` is null are ignored.
 */
export function useClickOutside(
    refs: Array<RefObject<HTMLElement | null>>,
    onOutside: () => void,
    active: boolean = true,
): void {
    useEffect(() => {
        if (!active) return;

        const handlePointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            const inside = refs.some(ref => ref.current?.contains(target));
            if (!inside) onOutside();
        };

        // Defer attachment so the opening click (which is still propagating)
        // doesn't trigger an immediate dismissal.
        const id = window.setTimeout(() => {
            document.addEventListener('mousedown', handlePointerDown);
        }, 0);

        return () => {
            window.clearTimeout(id);
            document.removeEventListener('mousedown', handlePointerDown);
        };
        // refs is expected to be a stable-length array of stable refs; callers
        // pass refs created with useRef, so identity is stable across renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, onOutside]);
}
