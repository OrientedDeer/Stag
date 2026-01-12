import { useContext, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, WithdrawalBucket } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { AnyAccount, SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';

// Helper to get tax treatment badge for an account
const getTaxBadge = (account: AnyAccount | undefined): { label: string; color: string } => {
    if (!account) return { label: 'Unknown', color: 'bg-gray-600' };

    if (account instanceof SavedAccount) {
        return { label: 'Tax-Free', color: 'bg-green-600' };
    }

    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Roth 401k':
            case 'Roth IRA':
                return { label: 'Tax-Free', color: 'bg-green-600' };
            case 'HSA':
                return { label: 'Tax-Free (HSA)', color: 'bg-green-600' };
            case 'Traditional 401k':
            case 'Traditional IRA':
                return { label: 'Taxable', color: 'bg-yellow-600' };
            case 'Brokerage':
                return { label: 'Cap Gains', color: 'bg-blue-600' };
            default:
                return { label: 'Taxable', color: 'bg-yellow-600' };
        }
    }

    return { label: 'Unknown', color: 'bg-gray-600' };
};

// Helper to format currency
const formatMoney = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

export default function WithdrawalTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);

    // Filter to only withdrawal-eligible accounts (SavedAccount, InvestedAccount)
    const eligibleAccounts = accounts.filter(
        acc => acc instanceof SavedAccount || acc instanceof InvestedAccount
    );

    // Sync withdrawal strategy with accounts:
    // - Add any new eligible accounts that aren't in the strategy
    // - Remove any buckets that reference deleted accounts
    useEffect(() => {
        const currentStrategy = state.withdrawalStrategy;

        // Find accounts not in strategy
        const missingAccounts = eligibleAccounts.filter(
            acc => !currentStrategy.some(bucket => bucket.accountId === acc.id)
        );

        // Find buckets that reference deleted accounts
        const validBuckets = currentStrategy.filter(
            bucket => eligibleAccounts.some(acc => acc.id === bucket.accountId)
        );

        // Only update if there are changes
        const hasNewAccounts = missingAccounts.length > 0;
        const hasDeletedAccounts = validBuckets.length !== currentStrategy.length;

        if (hasNewAccounts || hasDeletedAccounts) {
            // Create buckets for new accounts
            const newBuckets: WithdrawalBucket[] = missingAccounts.map(acc => ({
                id: `withdrawal-${acc.id}`,
                name: acc.name,
                accountId: acc.id,
            }));

            // Append new accounts to the end of valid buckets
            dispatch({
                type: 'SET_WITHDRAWAL_STRATEGY',
                payload: [...validBuckets, ...newBuckets]
            });
        }
    }, [accounts, eligibleAccounts, state.withdrawalStrategy, dispatch]);

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const items = Array.from(state.withdrawalStrategy);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        dispatch({ type: 'SET_WITHDRAWAL_STRATEGY', payload: items });
    };

    // Get account details for each bucket
    const bucketsWithDetails = state.withdrawalStrategy.map(bucket => {
        const account = accounts.find(acc => acc.id === bucket.accountId);
        const badge = getTaxBadge(account);
        return {
            ...bucket,
            account,
            badge,
            balance: account?.amount || 0,
        };
    });

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 text-white">
            <div className="w-full px-4 sm:px-8 max-w-4xl">
                <h2 className="text-2xl font-bold mb-2 border-b border-gray-800 pb-2">
                    Withdrawal Order
                </h2>
                <p className="text-gray-400 mb-6 text-sm">
                    Drag to reorder. When expenses exceed income, accounts are drained in the order shown below.
                </p>

                {/* Tax Treatment Legend */}
                <div className="mb-6 p-4 bg-gray-900/50 rounded-xl border border-gray-800 flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs rounded bg-green-600">Tax-Free</span>
                        <span className="text-gray-400 text-sm">Savings, Roth, HSA</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs rounded bg-yellow-600">Taxable</span>
                        <span className="text-gray-400 text-sm">Traditional 401k/IRA</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs rounded bg-blue-600">Cap Gains</span>
                        <span className="text-gray-400 text-sm">Brokerage</span>
                    </div>
                </div>

                {bucketsWithDetails.length === 0 ? (
                    <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded-xl px-6 py-12 text-center">
                        <p className="text-gray-500">No savings or investment accounts.</p>
                        <p className="text-gray-600 text-sm mt-2">
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
                                    {bucketsWithDetails.map((bucket, index) => (
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
                                                            ? 'bg-gray-800 border-green-500 shadow-2xl'
                                                            : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                                                    }`}>
                                                        {/* Order Number */}
                                                        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center mr-3 shrink-0">
                                                            <span className="text-gray-400 font-bold text-sm">{index + 1}</span>
                                                        </div>

                                                        {/* Drag Handle */}
                                                        <div
                                                            {...provided.dragHandleProps}
                                                            className="mr-4 cursor-grab text-gray-600 hover:text-white shrink-0"
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

                                                        {/* Account Info */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-gray-200 truncate">
                                                                    {bucket.account?.name || bucket.name}
                                                                </span>
                                                                <span className={`px-2 py-0.5 text-xs rounded ${bucket.badge.color}`}>
                                                                    {bucket.badge.label}
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-gray-500">
                                                                Balance: {formatMoney(bucket.balance)}
                                                            </div>
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

                {/* Explanation Footer */}
                <div className="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-xl">
                    <h4 className="font-semibold text-gray-300 mb-2">How Withdrawals Work</h4>
                    <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
                        <li>When expenses exceed income, accounts are drained in the order shown above.</li>
                        <li>Each account is fully drained before moving to the next.</li>
                        <li>Tax-free accounts (Roth, Savings) have no tax impact on withdrawal.</li>
                        <li>Traditional accounts add to taxable income; 10% penalty if under 59.5.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
