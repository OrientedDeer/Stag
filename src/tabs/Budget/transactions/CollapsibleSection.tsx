import { ReactNode } from 'react';
import { ChevronIcon } from '../../../components/Layout/Icons/ChevronIcon';

/**
 * Visual themes shared across the grouped-transactions sections. Each maps
 * to the original ad-hoc color combos in TransactionsTab, so swapping the
 * abstraction in didn't change any pixels.
 */
export type SectionTheme =
    | 'yellow'      // Uncategorized
    | 'green'       // Income
    | 'transfers'   // Transfers (muted gray)
    | 'expense'     // Per-expense category (default card look)
    | 'blue';       // Contributions

const THEMES: Record<SectionTheme, {
    container: string;
    header: string;
    label: string;
    rightText: string;
    chevron: string;
    bodyDivide: string;
}> = {
    yellow: {
        container: 'bg-warning-tint/20 border border-warning-strong/50',
        header: 'bg-warning-tint/30 border-b border-warning-strong/50 hover:bg-warning-tint/40',
        label: 'text-warning',
        rightText: 'text-warning',
        chevron: 'text-warning',
        bodyDivide: 'divide-y divide-warning-strong/30',
    },
    green: {
        container: 'bg-positive-tint/20 border border-positive-strong/50',
        header: 'bg-positive-tint/30 border-b border-positive-strong/50 hover:bg-positive-tint/40',
        label: 'text-positive',
        rightText: 'text-positive',
        chevron: 'text-positive',
        bodyDivide: 'divide-y divide-positive-strong/30',
    },
    transfers: {
        container: 'bg-surface-overlay/50 border border-border-strong',
        header: 'bg-surface-input/50 border-b border-border-strong hover:bg-surface-input/70',
        label: 'text-content-default',
        rightText: 'text-content-muted',
        chevron: 'text-content-muted',
        bodyDivide: 'divide-y divide-border-default',
    },
    expense: {
        container: 'bg-surface-overlay border border-border-default',
        header: 'bg-surface-overlay border-b border-border-default hover:bg-surface-input',
        label: 'text-white',
        rightText: 'text-content-muted',
        chevron: 'text-content-muted',
        bodyDivide: 'divide-y divide-border-default',
    },
    blue: {
        container: 'bg-info-tint/20 border border-info-strong/50',
        header: 'bg-info-tint/30 border-b border-info-strong/50 hover:bg-info-tint/40',
        label: 'text-info',
        rightText: 'text-info',
        chevron: 'text-info',
        bodyDivide: 'divide-y divide-info-strong/30',
    },
};

interface CollapsibleSectionProps {
    theme: SectionTheme;
    label: string;
    /** Optional count badge rendered after the label (e.g., "(3)"). */
    count?: number;
    /**
     * Custom right-side header content (e.g., gross/reimb/net breakdown).
     * When omitted, falls back to a simple formatted total.
     */
    headerRight: ReactNode;
    collapsed: boolean;
    onToggle: () => void;
    children: ReactNode;
}

/**
 * Wrap a collapsible group of transactions with the standard themed chrome.
 * The body's `divide-y` lines match the theme, so children should render bare
 * rows (or sub-grouped blocks) without their own outer wrapper.
 */
export function CollapsibleSection({
    theme,
    label,
    count,
    headerRight,
    collapsed,
    onToggle,
    children,
}: CollapsibleSectionProps) {
    const t = THEMES[theme];

    return (
        <div className={`${t.container} rounded-xl overflow-hidden`}>
            <button
                onClick={onToggle}
                className={`w-full px-4 py-3 transition-colors ${t.header}`}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`font-medium ${t.label}`}>{label}</span>
                        {count !== undefined && (
                            <span className={`text-sm ${t.rightText}/80`}>({count})</span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {headerRight}
                        <ChevronIcon expanded={!collapsed} className={t.chevron} />
                    </div>
                </div>
            </button>
            {!collapsed && (
                <div className={t.bodyDivide}>
                    {children}
                </div>
            )}
        </div>
    );
}
