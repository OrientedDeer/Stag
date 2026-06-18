import { memo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AnyAccount } from '../../../components/Objects/Accounts/models';
import { Panel } from "../../../components/Layout/Primitives";
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';
import { AlertBanner } from '../../../components/Layout/AlertBanner';

export interface AccountTimeline {
    tappedYear?: number;
    tappedAge?: number;
    depletedYear?: number;
    depletedAge?: number;
    depletedDrawAmount?: number;
    depletedBalanceBefore?: number;
}

export interface BucketDetail {
    id: string;
    name: string;
    accountId: string;
    account: AnyAccount | undefined;
    badge: { label: string; color: string };
    balance: number;
    /** Derived from the simulation: when this account is first tapped / depletes. */
    timeline?: AccountTimeline;
}

interface WithdrawalBucketListProps {
    taxOptimizationEnabled: boolean;
    buckets: BucketDetail[];
    onDragEnd: (result: DropResult) => void;
    formatMoney: (amount: number) => string;
    /**
     * The withdrawal order the joint optimizer CHOSE (year 0's `chosenWithdrawalOrder`),
     * surfaced so the disabled manual selector is honest about what's running. Only present
     * when Tax Optimization manages the order and the dp-precomputed path ran; undefined otherwise.
     */
    chosenWithdrawalOrder?: { accountId: string; name: string }[];
}

// One-line "Tapped age X → depleted age Y" consequence, derived from the sim.
function TimelineLine({
    timeline,
    formatMoney,
}: {
    timeline: AccountTimeline | undefined;
    formatMoney: (amount: number) => string;
}) {
    if (!timeline || timeline.tappedYear === undefined) {
        return (
            <div className="text-xs text-content-subtle mt-0.5">
                Not tapped within the plan
            </div>
        );
    }

    const { tappedAge, depletedAge, depletedDrawAmount, depletedBalanceBefore } = timeline;

    if (depletedAge === undefined) {
        return (
            <div className="text-xs text-content-subtle mt-0.5">
                Tapped age {tappedAge} → lasts the rest of the plan
            </div>
        );
    }

    const depletionExplain =
        depletedBalanceBefore !== undefined && depletedDrawAmount !== undefined
            ? `Depletes at age ${depletedAge}: ~${formatMoney(depletedBalanceBefore)} balance entering the year vs a ${formatMoney(depletedDrawAmount)} draw drains it to ~$0.`
            : `Depletes at age ${depletedAge}, when the year's draw empties the balance.`;

    return (
        <div className="flex items-center gap-1 text-xs text-content-subtle mt-0.5">
            <span>
                Tapped age {tappedAge} → depleted age {depletedAge}
            </span>
            <Tooltip text={depletionExplain} />
        </div>
    );
}

function WithdrawalBucketListInner({
    taxOptimizationEnabled,
    buckets,
    onDragEnd,
    formatMoney,
    chosenWithdrawalOrder,
}: WithdrawalBucketListProps) {
    if (taxOptimizationEnabled) {
        return (
            <>
                <Panel padding="lg" className="bg-surface-raised/30 text-center">
                    <svg className="w-12 h-12 mx-auto text-content-faint mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <p className="text-content-muted text-sm">
                        Manual withdrawal ordering is disabled when Tax Optimization is enabled.
                    </p>
                    <p className="text-content-subtle text-xs mt-2">
                        The system automatically determines the optimal withdrawal order each year based on your tax situation.
                    </p>
                </Panel>

                {chosenWithdrawalOrder && chosenWithdrawalOrder.length > 0 && (
                    <div className="mt-4">
                        <AlertBanner severity="info" size="sm" title="Tax Optimization chose this withdrawal order">
                            {chosenWithdrawalOrder.map(w => w.name).join(' → ')}
                        </AlertBanner>
                    </div>
                )}
            </>
        );
    }

    return (
        <>
            <p className="text-content-muted mb-6 text-sm">
                Drag to reorder. When expenses exceed income, accounts are drained in the order shown below.
            </p>

            <Panel className="mb-6 bg-surface-raised/50 flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-xs rounded bg-positive-solid">Tax-Free</span>
                    <span className="text-content-muted text-sm">Savings, Roth, HSA</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-xs rounded bg-warning-solid">Taxable</span>
                    <span className="text-content-muted text-sm">Traditional 401k/IRA</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-xs rounded bg-accent">Cap Gains</span>
                    <span className="text-content-muted text-sm">Brokerage</span>
                </div>
            </Panel>

            {buckets.length === 0 ? (
                <div className="bg-surface-raised/50 border border-dashed border-border-default rounded-xl px-6 py-12 text-center">
                    <p className="text-content-muted">No savings or investment accounts.</p>
                    <p className="text-content-muted text-sm mt-2">
                        Add accounts in the Accounts tab to set up your withdrawal order.
                    </p>
                </div>
            ) : (
                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="withdrawal-list">
                        {(provided) => (
                            <div
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                                className="flex flex-col"
                            >
                                {buckets.map((bucket, index) => (
                                    <Draggable
                                        key={bucket.id}
                                        draggableId={bucket.id}
                                        index={index}
                                    >
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                style={provided.draggableProps.style}
                                                className={`pb-2 ${snapshot.isDragging ? 'z-50' : ''}`}
                                            >
                                                <div className={`rounded-xl border px-4 py-3 flex items-center ${
                                                    snapshot.isDragging
                                                        ? 'bg-surface-overlay border-positive-soft shadow-2xl'
                                                        : 'bg-surface-raised border-border-subtle hover:border-border-default'
                                                }`}>
                                                    <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center mr-3 shrink-0">
                                                        <span className="text-content-muted font-bold text-sm">{index + 1}</span>
                                                    </div>

                                                    <div
                                                        {...provided.dragHandleProps}
                                                        className="mr-4 cursor-grab text-content-muted hover:text-white shrink-0"
                                                    >
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <line x1="8" y1="6" x2="21" y2="6"></line>
                                                            <line x1="8" y1="12" x2="21" y2="12"></line>
                                                            <line x1="8" y1="18" x2="21" y2="18"></line>
                                                            <line x1="3" y1="6" x2="3.01" y2="6"></line>
                                                            <line x1="3" y1="12" x2="3.01" y2="12"></line>
                                                            <line x1="3" y1="18" x2="3.01" y2="18"></line>
                                                        </svg>
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-content-emphasis truncate">
                                                                {bucket.account?.name || bucket.name}
                                                            </span>
                                                            <span className={`px-2 py-0.5 text-xs rounded ${bucket.badge.color}`}>
                                                                {bucket.badge.label}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-content-muted">
                                                            Balance: {formatMoney(bucket.balance)}
                                                        </div>
                                                        <TimelineLine timeline={bucket.timeline} formatMoney={formatMoney} />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            )}
        </>
    );
}

export const WithdrawalBucketList = memo(WithdrawalBucketListInner);
