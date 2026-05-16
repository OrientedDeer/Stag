import { useState, ReactNode, ReactElement } from "react";
import { ChevronIcon } from "./Icons/ChevronIcon.js";

interface ExpandableCardProps {
    /** Display name shown in both collapsed and expanded views */
    name: string;
    /** Background color class for the icon (e.g., "bg-blue-500") */
    iconBg: string;
    /** Single character or short text shown in the icon circle */
    iconLabel: string;
    /** Amount or value displayed in collapsed view */
    displayValue: string;
    /** Optional frequency suffix (e.g., "/mo", "/yr") */
    frequencySuffix?: string;
    /** Content rendered when expanded */
    children: ReactNode;
    /** Content rendered in the expanded header (name input, delete button, etc.) */
    headerContent: ReactNode;
    /** Optional additional actions in expanded header (e.g., history button) */
    headerActions?: ReactNode;
    /** Aria label prefix for accessibility */
    ariaLabelType?: string;
}

export function ExpandableCard({
    name,
    iconBg,
    iconLabel,
    displayValue,
    frequencySuffix = "",
    children,
    headerContent,
    headerActions,
    ariaLabelType = "item"
}: ExpandableCardProps): ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!isExpanded) {
        return (
            <div className="w-full">
                <button
                    onClick={() => setIsExpanded(true)}
                    aria-expanded="false"
                    aria-label={`Expand ${name} ${ariaLabelType} details`}
                    className="flex items-center gap-4 p-4 bg-[#18181b] rounded-xl border border-gray-800 cursor-pointer hover:border-gray-600 transition-colors w-full text-left"
                >
                    <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${iconBg} text-md font-bold text-white shrink-0`}
                        aria-hidden="true"
                    >
                        {iconLabel}
                    </div>
                    <div className="font-semibold text-white truncate flex-1">
                        {name}
                    </div>
                    <div className="text-gray-300 text-sm whitespace-nowrap">
                        {displayValue}{frequencySuffix}
                    </div>
                    <ChevronIcon expanded={false} className="w-5 h-5" />
                </button>
            </div>
        );
    }

    return (
        <div className="w-full">
            {/* Expanded Header */}
            <div className="flex gap-4 mb-4">
                <div className={`w-8 h-8 mt-1 rounded-full flex items-center justify-center shadow-lg ${iconBg} text-md font-bold text-white`}>
                    {iconLabel}
                </div>
                <div className="grow">
                    {headerContent}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    {headerActions}
                    <button
                        onClick={() => setIsExpanded(false)}
                        aria-expanded="true"
                        aria-label={`Collapse ${name} ${ariaLabelType} details`}
                        className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <ChevronIcon expanded={true} className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Expanded Content */}
            {children}
        </div>
    );
}
