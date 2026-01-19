import { createPortal } from 'react-dom';
import { ReactNode, useEffect, useState, useRef } from 'react';

interface ChartTooltipPortalProps {
    children: ReactNode;
}

/**
 * Wraps chart tooltip content and renders it via a portal to document.body.
 * This ensures tooltips appear above all other elements (like sidebars)
 * by escaping any stacking context issues.
 *
 * Tracks mouse position to position the tooltip near the cursor.
 */
export const ChartTooltipPortal = ({ children }: ChartTooltipPortalProps) => {
    const [mounted, setMounted] = useState(false);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);

        const handleMouseMove = (e: MouseEvent) => {
            setMousePos({ x: e.clientX, y: e.clientY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            setMounted(false);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    // Don't render until we have both mounted and received a mouse position
    if (!mounted || !mousePos) return null;

    // Calculate position to keep tooltip in viewport
    const tooltipWidth = tooltipRef.current?.offsetWidth || 300;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 200;

    let left = mousePos.x + 15; // 15px offset from cursor
    let top = mousePos.y + 15;

    // Keep tooltip in viewport
    if (left + tooltipWidth > window.innerWidth - 10) {
        left = mousePos.x - tooltipWidth - 15;
    }
    if (top + tooltipHeight > window.innerHeight - 10) {
        top = mousePos.y - tooltipHeight - 15;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    return createPortal(
        <div
            ref={tooltipRef}
            style={{
                position: 'fixed',
                left: `${left}px`,
                top: `${top}px`,
                zIndex: 9999,
                pointerEvents: 'none',
            }}
        >
            {children}
        </div>,
        document.body
    );
};
