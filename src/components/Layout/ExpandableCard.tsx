import { useEffect, useRef, useState, ReactNode, ReactElement } from "react";
import { ChevronIcon } from "./Icons/ChevronIcon.js";

interface ExpandableCardProps {
    /** Display name shown in both collapsed and expanded views */
    name: string;
    /** Background color class for the icon (e.g., "bg-accent-soft") */
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
    /** Optional status badge shown in BOTH the collapsed and expanded header, so a
     *  condition that needs attention (e.g. a misconfigured grant) is visible without
     *  expanding the card. */
    badge?: ReactNode;
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
    badge,
    ariaLabelType = "item"
}: ExpandableCardProps): ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);
    const expandButtonRef = useRef<HTMLButtonElement>(null);
    const collapseButtonRef = useRef<HTMLButtonElement>(null);
    // Track the previous isExpanded so we only refocus when it ACTUALLY changes.
    // A plain "first render" ref would mis-fire under React strict mode, which
    // re-runs effects on mount — and refs persist across that re-run, so the
    // second invocation would think mount was already past and steal focus.
    const prevExpandedRef = useRef(isExpanded);

    // The collapsed and expanded views render entirely different DOM, so the
    // toggle button gets unmounted and recreated on every toggle — browser
    // drops focus. Move focus to whichever toggle is now visible.
    useEffect(() => {
        if (prevExpandedRef.current === isExpanded) return;
        prevExpandedRef.current = isExpanded;
        const target = isExpanded ? collapseButtonRef.current : expandButtonRef.current;
        target?.focus({ preventScroll: true });
    }, [isExpanded]);

    if (!isExpanded) {
        return (
            <div className="w-full">
                <button
                    ref={expandButtonRef}
                    onClick={() => setIsExpanded(true)}
                    aria-expanded="false"
                    aria-label={`Expand ${name} ${ariaLabelType} details`}
                    className="flex items-center gap-4 p-4 bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle cursor-pointer hover:border-border-strong transition-colors w-full text-left"
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
                    {badge && <div className="shrink-0">{badge}</div>}
                    <div className="text-content-default text-sm whitespace-nowrap">
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
                    {badge}
                    {headerActions}
                    <button
                        ref={collapseButtonRef}
                        onClick={() => setIsExpanded(false)}
                        aria-expanded="true"
                        aria-label={`Collapse ${name} ${ariaLabelType} details`}
                        className="p-2 hover:bg-surface-overlay rounded-lg transition-colors"
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
