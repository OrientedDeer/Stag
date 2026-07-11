import { type ReactElement, type ReactNode, useState } from 'react';
import { ChevronIcon } from './Icons/ChevronIcon';

interface CardSectionProps {
    id: string;
    title: string;
    /** One-line current-state summary, visible while collapsed — the card reads
     *  like a paystub stub without expanding anything. */
    summary?: string;
    defaultOpen?: boolean;
    /** Override the inner field grid (e.g. modals use fewer columns than cards). */
    gridClassName?: string;
    children: ReactNode;
}

/**
 * Collapsible full-width section inside a card's field grid. Heavy field
 * clusters (401k & match, benefits, ESPP, pension) collapse to a summary line
 * so the card stays scannable; expanding reveals the inputs in the same grid
 * layout the host card uses.
 */
export function CardSection({
    id,
    title,
    summary,
    defaultOpen = false,
    gridClassName = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 px-4 pb-4',
    children,
}: CardSectionProps): ReactElement {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="col-span-full border border-border-subtle rounded-lg bg-surface-base/40">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-content`}
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-overlay/40 rounded-lg transition-colors"
            >
                <span className="text-sm font-semibold text-content-default shrink-0">{title}</span>
                <span className="flex items-center gap-3 min-w-0">
                    {summary && <span className="text-xs text-content-muted truncate">{summary}</span>}
                    <ChevronIcon expanded={open} className="shrink-0" />
                </span>
            </button>
            {open && (
                <div id={`${id}-content`} className={gridClassName}>
                    {children}
                </div>
            )}
        </div>
    );
}
