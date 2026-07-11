import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
}

/** Shared measure/position/visibility state for both tooltip variants.
 *  Measures in the handler that reveals the tip (not an effect) — the trigger
 *  is already mounted when these fire, so its rect is available immediately. */
function useTooltipState<T extends HTMLElement>() {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState<'top' | 'bottom'>('top');
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<T>(null);

    const show = (): void => {
        const el = triggerRef.current;
        if (el) {
            const rect = el.getBoundingClientRect();
            const spaceAbove = rect.top;
            const tooltipHeight = 80; // Approximate tooltip height
            const tooltipWidth = 224; // w-56 = 14rem = 224px

            // Show below if not enough space above
            const showBelow = spaceAbove < tooltipHeight;
            setPosition(showBelow ? 'bottom' : 'top');

            // Calculate position for portal
            const top = showBelow
                ? rect.bottom + 8 // 8px gap below trigger
                : rect.top - 8; // 8px gap above trigger (tooltip will use bottom positioning)

            let left = rect.left + rect.width / 2 - tooltipWidth / 2;

            // Keep tooltip within viewport horizontally
            const padding = 8;
            if (left < padding) {
                left = padding;
            } else if (left + tooltipWidth > window.innerWidth - padding) {
                left = window.innerWidth - tooltipWidth - padding;
            }

            setCoords({ top, left });
        }
        setIsVisible(true);
    };
    const hide = (): void => setIsVisible(false);

    return { isVisible, position, coords, triggerRef, show, hide };
}

function TooltipBody({ text, position, coords }: {
    text: string;
    position: 'top' | 'bottom';
    coords: { top: number; left: number };
}) {
    return (
        <div
            role="tooltip"
            style={{
                position: 'fixed',
                top: position === 'bottom' ? coords.top : 'auto',
                bottom: position === 'top' ? `calc(100vh - ${coords.top}px)` : 'auto',
                left: coords.left,
                zIndex: 9999,
            }}
            className="w-56 px-3 py-2 text-xs text-content-emphasis bg-surface-overlay border border-border-default rounded-lg shadow-xl"
        >
            {text}
        </div>
    );
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const { isVisible, position, coords, triggerRef, show, hide } = useTooltipState<HTMLButtonElement>();

    return (
        <span className="relative inline-flex items-center">
            <button
                ref={triggerRef}
                type="button"
                className="w-4 h-4 rounded-full bg-surface-input hover:bg-surface-hover text-content-muted hover:text-content-emphasis text-xs flex items-center justify-center transition-colors cursor-help"
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
                aria-label="Help"
            >
                ?
            </button>
            {isVisible && createPortal(
                <TooltipBody text={text} position={position} coords={coords} />,
                document.body,
            )}
            {children}
        </span>
    );
};

/**
 * Styled hover tooltip whose TRIGGER is the wrapped children — for badges and
 * pills that should explain themselves on hover — vs `Tooltip`, which renders
 * its own "?" bubble as the trigger. Use this instead of the native `title`
 * attribute, which shows the browser-default (un-themed) tooltip.
 */
export const HoverTooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
    const { isVisible, position, coords, triggerRef, show, hide } = useTooltipState<HTMLSpanElement>();

    return (
        <span
            ref={triggerRef}
            className="inline-flex items-center cursor-help"
            tabIndex={0}
            aria-label={text}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
        >
            {children}
            {isVisible && createPortal(
                <TooltipBody text={text} position={position} coords={coords} />,
                document.body,
            )}
        </span>
    );
};
