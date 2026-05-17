import { memo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AnyAccount } from '../../../components/Objects/Accounts/models';

export interface BucketDetail {
    id: string;
    name: string;
    accountId: string;
    account: AnyAccount | undefined;
    badge: { label: string; color: string };
    balance: number;
}

interface WithdrawalBucketListProps {
    taxOptimizationEnabled: boolean;
    buckets: BucketDetail[];
    onDragEnd: (result: DropResult) => void;
    formatMoney: (amount: number) => string;
}

function WithdrawalBucketListInner({
    taxOptimizationEnabled,
    buckets,
    onDragEnd,
    formatMoney,
}: WithdrawalBucketListProps) {
    if (taxOptimizationEnabled) {
        return (
            <div className="bg-gray-900/30 border border-gray-800 rounded-xl p-6 text-center">
                <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-gray-400 text-sm">
                    Manual withdrawal ordering is disabled when Tax Optimization is enabled.
                </p>
                <p className="text-gray-500 text-xs mt-2">
                    The system automatically determines the optimal withdrawal order each year based on your tax situation.
                </p>
            </div>
        );
    }

    return (
        <>
            <p className="text-gray-400 mb-6 text-sm">
                Drag to reorder. When expenses exceed income, accounts are drained in the order shown below.
            </p>

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

            {buckets.length === 0 ? (
                <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded-xl px-6 py-12 text-center">
                    <p className="text-gray-400">No savings or investment accounts.</p>
                    <p className="text-gray-400 text-sm mt-2">
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
                                                        ? 'bg-gray-800 border-green-500 shadow-2xl'
                                                        : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                                                }`}>
                                                    <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center mr-3 shrink-0">
                                                        <span className="text-gray-400 font-bold text-sm">{index + 1}</span>
                                                    </div>

                                                    <div
                                                        {...provided.dragHandleProps}
                                                        className="mr-4 cursor-grab text-gray-400 hover:text-white shrink-0"
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
                                                            <span className="font-bold text-gray-200 truncate">
                                                                {bucket.account?.name || bucket.name}
                                                            </span>
                                                            <span className={`px-2 py-0.5 text-xs rounded ${bucket.badge.color}`}>
                                                                {bucket.badge.label}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-gray-400">
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
        </>
    );
}

export const WithdrawalBucketList = memo(WithdrawalBucketListInner);
