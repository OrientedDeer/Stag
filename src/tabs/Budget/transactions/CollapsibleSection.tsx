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
        container: 'bg-yellow-900/20 border border-yellow-700/50',
        header: 'bg-yellow-900/30 border-b border-yellow-700/50 hover:bg-yellow-900/40',
        label: 'text-yellow-400',
        rightText: 'text-yellow-400',
        chevron: 'text-yellow-400',
        bodyDivide: 'divide-y divide-yellow-700/30',
    },
    green: {
        container: 'bg-green-900/20 border border-green-700/50',
        header: 'bg-green-900/30 border-b border-green-700/50 hover:bg-green-900/40',
        label: 'text-green-400',
        rightText: 'text-green-400',
        chevron: 'text-green-400',
        bodyDivide: 'divide-y divide-green-700/30',
    },
    transfers: {
        container: 'bg-gray-800/50 border border-gray-600',
        header: 'bg-gray-700/50 border-b border-gray-600 hover:bg-gray-700/70',
        label: 'text-gray-300',
        rightText: 'text-gray-400',
        chevron: 'text-gray-400',
        bodyDivide: 'divide-y divide-gray-700',
    },
    expense: {
        container: 'bg-gray-800 border border-gray-700',
        header: 'bg-gray-750 border-b border-gray-700 hover:bg-gray-700',
        label: 'text-white',
        rightText: 'text-gray-400',
        chevron: 'text-gray-400',
        bodyDivide: 'divide-y divide-gray-700',
    },
    blue: {
        container: 'bg-blue-900/20 border border-blue-700/50',
        header: 'bg-blue-900/30 border-b border-blue-700/50 hover:bg-blue-900/40',
        label: 'text-blue-400',
        rightText: 'text-blue-400',
        chevron: 'text-blue-400',
        bodyDivide: 'divide-y divide-blue-700/30',
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
