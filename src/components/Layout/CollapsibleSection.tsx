import React, { useState } from 'react';
import { ChevronIcon } from './Icons/ChevronIcon.js';

interface CollapsibleSectionProps {
    summary: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    summary,
    children,
    defaultOpen = false,
    className = ''
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultOpen);

    return (
        <div className={className}>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                className="w-full flex items-center justify-between p-3 bg-[#18181b] rounded-xl border border-gray-800 hover:border-gray-700 transition-colors cursor-pointer"
            >
                <div className="flex-1">{summary}</div>
                <ChevronIcon expanded={isExpanded} className="w-5 h-5" />
            </button>
            {isExpanded && (
                <div className="mt-2 p-4 bg-gray-900/50 rounded-xl border border-gray-800">
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleSection;
