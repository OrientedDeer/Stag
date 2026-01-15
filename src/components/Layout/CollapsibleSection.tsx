import React, { useState } from 'react';

interface CollapsibleSectionProps {
    summary: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
}

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg
        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
    >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
);

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
                <ChevronIcon expanded={isExpanded} />
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
