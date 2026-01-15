import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState<'top' | 'bottom'>('top');
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isVisible && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const spaceAbove = rect.top;
            const tooltipHeight = 80; // Approximate tooltip height
            const tooltipWidth = 224; // w-56 = 14rem = 224px

            // Show below if not enough space above
            const showBelow = spaceAbove < tooltipHeight;
            setPosition(showBelow ? 'bottom' : 'top');

            // Calculate position for portal
            let top = showBelow
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
    }, [isVisible]);

    const tooltipContent = isVisible && (
        <div
            role="tooltip"
            style={{
                position: 'fixed',
                top: position === 'bottom' ? coords.top : 'auto',
                bottom: position === 'top' ? `calc(100vh - ${coords.top}px)` : 'auto',
                left: coords.left,
                zIndex: 9999,
            }}
            className="w-56 px-3 py-2 text-xs text-gray-200 bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
        >
            {text}
        </div>
    );

    return (
        <span className="relative inline-flex items-center">
            <button
                ref={triggerRef}
                type="button"
                className="w-4 h-4 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 text-xs flex items-center justify-center transition-colors cursor-help"
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
                onFocus={() => setIsVisible(true)}
                onBlur={() => setIsVisible(false)}
                aria-label="Help"
            >
                ?
            </button>
            {isVisible && createPortal(tooltipContent, document.body)}
            {children}
        </span>
    );
};

// Question mark icon component for inline use
export const HelpIcon: React.FC<{ tooltip: string }> = ({ tooltip }) => (
    <Tooltip text={tooltip} />
);
