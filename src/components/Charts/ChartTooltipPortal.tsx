import { createPortal } from 'react-dom';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { placePopover } from './popoverPosition';

interface ChartTooltipPortalProps {
    children: ReactNode;
}

/**
 * Wraps chart tooltip content and renders it via a portal to document.body
 * so tooltips escape stacking-context issues (sidebars, etc).
 *
 * Mouse position is updated imperatively via ref + rAF — using React state
 * here meant every pointermove triggered a re-render of the portal and its
 * children (the tooltip body), which on the charts tab produced hundreds of
 * 80ms commits while hovering a chart. The position math here is cheap; the
 * cost was forcing React through the reconciliation pipeline 60+ times/sec.
 */
export const ChartTooltipPortal = ({ children }: ChartTooltipPortalProps) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    // One render after mount so the portal div exists and the ref is bound.
    // After that, we never call setState again — pointer-driven position
    // updates happen directly via ref.
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);

        let rafId: number | null = null;
        let pendingX = 0;
        let pendingY = 0;

        const applyPosition = () => {
            rafId = null;
            const el = tooltipRef.current;
            if (!el) return;
            // Cursor-following tooltip: offset on BOTH axes (flip on overflow).
            const { left, top } = placePopover({
                anchorX: pendingX,
                anchorY: pendingY,
                width: el.offsetWidth || 300,
                height: el.offsetHeight || 200,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                verticalMode: 'offset',
            });
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.style.visibility = 'visible';
        };

        const handlePointerEvent = (e: PointerEvent) => {
            pendingX = e.clientX;
            pendingY = e.clientY;
            if (rafId === null) {
                rafId = requestAnimationFrame(applyPosition);
            }
        };

        window.addEventListener('pointermove', handlePointerEvent);
        window.addEventListener('pointerdown', handlePointerEvent);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            window.removeEventListener('pointermove', handlePointerEvent);
            window.removeEventListener('pointerdown', handlePointerEvent);
        };
    }, []);

    if (!mounted) return null;

    return createPortal(
        <div
            ref={tooltipRef}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                // Hidden until the first pointermove writes a real position;
                // avoids a 1-frame flash at (0,0).
                visibility: 'hidden',
                zIndex: 9999,
                pointerEvents: 'none',
            }}
        >
            {children}
        </div>,
        document.body
    );
};
