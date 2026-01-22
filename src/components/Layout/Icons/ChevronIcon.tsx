import { ReactElement } from 'react';

interface ChevronIconProps {
    expanded: boolean;
    className?: string;
}

export function ChevronIcon({ expanded, className = '' }: ChevronIconProps): ReactElement {
    return (
        <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''} ${className}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
    );
}
