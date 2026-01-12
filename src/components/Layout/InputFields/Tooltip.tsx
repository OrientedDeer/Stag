import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState<'top' | 'bottom'>('top');
    const tooltipRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isVisible && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const spaceAbove = rect.top;

            // Show below if not enough space above (less than 80px)
            setPosition(spaceAbove < 80 ? 'bottom' : 'top');
        }
    }, [isVisible]);

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
            {isVisible && (
                <div
                    ref={tooltipRef}
                    role="tooltip"
                    className={`absolute z-50 w-56 px-3 py-2 text-xs text-gray-200 bg-gray-800 border border-gray-700 rounded-lg shadow-xl ${
                        position === 'top'
                            ? 'bottom-full mb-2'
                            : 'top-full mt-2'
                    } left-1/2 -translate-x-1/2`}
                >
                    {text}
                    <div
                        className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-800 border-gray-700 transform rotate-45 ${
                            position === 'top'
                                ? 'top-full -mt-1 border-r border-b'
                                : 'bottom-full -mb-1 border-l border-t'
                        }`}
                    />
                </div>
            )}
            {children}
        </span>
    );
};

// Question mark icon component for inline use
export const HelpIcon: React.FC<{ tooltip: string }> = ({ tooltip }) => (
    <Tooltip text={tooltip} />
);
