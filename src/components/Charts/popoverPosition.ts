/**
 * Shared viewport-edge placement math for floating chart UI (tooltips, the
 * Sankey drill-down popover). Keeps a single offset → flip → clamp
 * implementation so the two callers can't drift apart.
 *
 * Each axis is placed independently in one of two modes:
 * - `offset`: sit `gap` px past the anchor on the preferred side; if that would
 *   overflow the far edge, flip to the opposite side; then clamp into the
 *   viewport. (Used for cursor-following tooltips on both axes, and the
 *   horizontal axis of an anchored popover.)
 * - `center`: centre the element on the anchor, then clamp into the viewport.
 *   (Used for the vertical axis of an anchored popover.)
 */

/** Default gap (px) between the anchor point and the floating element. */
export const POPOVER_GAP = 14;
/** Keep at least this many px between the element and the viewport edge. */
export const POPOVER_VIEWPORT_MARGIN = 10;

export type AxisMode = 'offset' | 'center';

interface AxisInput {
    /** Anchor coordinate on this axis (viewport/client space). */
    anchor: number;
    /** Size of the floating element on this axis. */
    size: number;
    /** Viewport extent on this axis (window.innerWidth / innerHeight). */
    viewport: number;
    mode: AxisMode;
    gap?: number;
    margin?: number;
}

/** Place one axis: returns the top-left coordinate for the floating element. */
export function placeAxis({ anchor, size, viewport, mode, gap = POPOVER_GAP, margin = POPOVER_VIEWPORT_MARGIN }: AxisInput): number {
    let start: number;
    if (mode === 'center') {
        start = anchor - size / 2;
    } else {
        start = anchor + gap;
        // Flip to the opposite side of the anchor if the preferred side overflows.
        if (start + size > viewport - margin) {
            start = anchor - size - gap;
        }
    }
    // Clamp within the viewport. When the element is taller/wider than the
    // viewport, prefer pinning the top/left edge (so the header stays visible).
    if (start + size > viewport - margin) start = viewport - margin - size;
    if (start < margin) start = margin;
    return start;
}

export interface PlacePopoverInput {
    /** Anchor point in viewport/client coordinates. */
    anchorX: number;
    anchorY: number;
    /** Measured (or fallback) size of the floating element. */
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    /** Vertical placement mode: popovers centre vertically; tooltips offset. */
    verticalMode?: AxisMode;
    gap?: number;
    margin?: number;
}

/**
 * Compute the clamped top-left for a floating element anchored at a point.
 * Horizontal axis always uses `offset` (sit beside the anchor, flip on
 * overflow); vertical axis uses `verticalMode` (default `center` for popovers).
 */
export function placePopover({
    anchorX,
    anchorY,
    width,
    height,
    viewportWidth,
    viewportHeight,
    verticalMode = 'center',
    gap = POPOVER_GAP,
    margin = POPOVER_VIEWPORT_MARGIN,
}: PlacePopoverInput): { left: number; top: number } {
    return {
        left: placeAxis({ anchor: anchorX, size: width, viewport: viewportWidth, mode: 'offset', gap, margin }),
        top: placeAxis({ anchor: anchorY, size: height, viewport: viewportHeight, mode: verticalMode, gap, margin }),
    };
}
