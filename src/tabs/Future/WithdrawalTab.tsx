import { useContext, useEffect, useCallback, useState, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, WithdrawalBucket } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { AnyAccount, SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { formatCompactCurrency } from './tabs/FutureUtils';
import {
    calculateFixedRealWithdrawal,
    calculatePercentageWithdrawal,
    calculateGuytonKlingerWithdrawal,
    WithdrawalResult
} from '../../services/WithdrawalStrategies';

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

// Withdrawal Debug Panel Component
const WithdrawalDebugPanel: React.FC<{
    totalPortfolio: number;
    withdrawalRate: number;
    inflationRate: number;
    strategy: string;
    formatMoney: (amount: number) => string;
}> = ({ totalPortfolio, withdrawalRate, inflationRate, strategy, formatMoney }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate sample withdrawals for first 10 years of retirement
    const sampleYears = useMemo(() => {
        const years: Array<{
            year: number;
            portfolio: number;
            withdrawal: number;
            rate: number;
            guardrail: string;
        }> = [];

        let currentPortfolio = totalPortfolio;
        let previousWithdrawal: WithdrawalResult | undefined;
        const returnRate = 0.07; // Assume 7% nominal returns for illustration

        for (let i = 0; i < 10; i++) {
            let result: WithdrawalResult;

            if (strategy === 'Fixed Real') {
                result = calculateFixedRealWithdrawal(
                    totalPortfolio,
                    withdrawalRate,
                    inflationRate,
                    i,
                    currentPortfolio
                );
            } else if (strategy === 'Percentage') {
                result = calculatePercentageWithdrawal(currentPortfolio, withdrawalRate);
            } else {
                // Guyton-Klinger
                result = calculateGuytonKlingerWithdrawal({
                    currentPortfolio,
                    baseWithdrawal: previousWithdrawal?.baseAmount || 0,
                    withdrawalRate,
                    inflationRate,
                    isFirstYear: i === 0,
                    yearsRemaining: 30 - i,
                });
            }

            years.push({
                year: i + 1,
                portfolio: currentPortfolio,
                withdrawal: result.amount,
                rate: result.currentWithdrawalRate,
                guardrail: result.guardrailTriggered === 'none' ? '-' :
                    result.guardrailTriggered === 'capital-preservation' ? '⚠️ Cut' : '📈 Raise',
            });

            // Simulate portfolio for next year (growth - withdrawal)
            currentPortfolio = (currentPortfolio - result.amount) * (1 + returnRate);
            previousWithdrawal = result;
        }

        return years;
    }, [totalPortfolio, withdrawalRate, inflationRate, strategy]);

    if (totalPortfolio <= 0) return null;

    return (
        <div className="mt-6 border border-gray-800 rounded-xl overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 bg-gray-900/50 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
            >
                <span className="text-sm font-medium text-gray-300">
                    🔧 Withdrawal Strategy Debug Panel
                </span>
                <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isExpanded && (
                <div className="p-4 bg-gray-900/30 space-y-4">
                    {/* Current Settings */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-gray-400 text-xs uppercase">Strategy</div>
                            <div className="text-white font-medium">{strategy}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-gray-400 text-xs uppercase">Portfolio</div>
                            <div className="text-white font-medium">{formatMoney(totalPortfolio)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-gray-400 text-xs uppercase">Rate</div>
                            <div className="text-white font-medium">{withdrawalRate}%</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-gray-400 text-xs uppercase">Year 1 Withdrawal</div>
                            <div className="text-emerald-400 font-medium">
                                {formatMoney(totalPortfolio * (withdrawalRate / 100))}
                            </div>
                        </div>
                    </div>

                    {/* Sample Year-by-Year Table */}
                    <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2">
                            Sample 10-Year Projection (assuming 7% returns)
                        </h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-gray-400 text-xs uppercase">
                                        <th className="text-left py-2 px-2">Year</th>
                                        <th className="text-right py-2 px-2">Portfolio</th>
                                        <th className="text-right py-2 px-2">Withdrawal</th>
                                        <th className="text-right py-2 px-2">Rate</th>
                                        {strategy === 'Guyton Klinger' && (
                                            <th className="text-center py-2 px-2">Guardrail</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sampleYears.map(row => (
                                        <tr key={row.year} className="border-t border-gray-800">
                                            <td className="py-2 px-2 text-gray-300">{row.year}</td>
                                            <td className="py-2 px-2 text-right text-gray-300">
                                                {formatMoney(row.portfolio)}
                                            </td>
                                            <td className="py-2 px-2 text-right text-emerald-400">
                                                {formatMoney(row.withdrawal)}
                                            </td>
                                            <td className="py-2 px-2 text-right text-gray-400">
                                                {row.rate.toFixed(1)}%
                                            </td>
                                            {strategy === 'Guyton Klinger' && (
                                                <td className="py-2 px-2 text-center">{row.guardrail}</td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Strategy Explanation */}
                    <div className="text-xs text-gray-400 bg-gray-800/30 rounded-lg p-3">
                        {strategy === 'Fixed Real' && (
                            <p>
                                <strong>Fixed Real:</strong> Year 1 withdrawal is {withdrawalRate}% of initial portfolio.
                                Each subsequent year, the same dollar amount is withdrawn, adjusted for {inflationRate}% inflation.
                                This maintains purchasing power but may deplete portfolio in bad markets.
                            </p>
                        )}
                        {strategy === 'Percentage' && (
                            <p>
                                <strong>Percentage:</strong> Each year, withdraw {withdrawalRate}% of current portfolio value.
                                Income varies with market performance. Portfolio mathematically never depletes,
                                but income can drop significantly in bad years.
                            </p>
                        )}
                        {strategy === 'Guyton Klinger' && (
                            <p>
                                <strong>Guyton-Klinger:</strong> Dynamic strategy with guardrails.
                                If withdrawal rate exceeds {(withdrawalRate * 1.2).toFixed(1)}% (upper guardrail),
                                cut withdrawal by 10%. If rate drops below {(withdrawalRate * 0.8).toFixed(1)}% (lower guardrail),
                                increase withdrawal by 10%. Otherwise, adjust for inflation.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default function WithdrawalTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const forceExact = state.display?.useCompactCurrency === false;

    // Currency formatter that respects user display settings
    const formatMoney = useCallback((amount: number) =>
        formatCompactCurrency(amount, { forceExact }), [forceExact]);

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

    // Calculate total portfolio value for debug panel
    const totalPortfolio = bucketsWithDetails.reduce((sum, b) => sum + b.balance, 0);
    const withdrawalRate = state.investments?.withdrawalRate || 4;
    const inflationRate = state.macro?.inflationRate || 3;
    const withdrawalStrategyType = state.investments?.withdrawalStrategy || 'Fixed Real';

    const [showHelp, setShowHelp] = useState(false);

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-24 text-white">
            <div className="w-full px-4 sm:px-8 max-w-4xl">
                <div className="flex items-center justify-between mb-2 border-b border-gray-800 pb-2">
                    <h2 className="text-2xl font-bold">Withdrawal Order</h2>
                    <button
                        onClick={() => setShowHelp(!showHelp)}
                        className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {showHelp ? 'Hide help' : 'How this works'}
                    </button>
                </div>

                {/* Expandable Help Section */}
                {showHelp && (
                    <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 text-sm">
                        <h3 className="font-semibold text-blue-300 mb-2">Understanding Withdrawal Order</h3>
                        <p className="text-gray-300 mb-3">
                            In retirement, when your expenses exceed your income, money is withdrawn from your accounts to cover the gap. The order you set here determines which accounts get drained first.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-gray-200">Tax Treatment:</h4>
                                <ul className="text-gray-400 space-y-1">
                                    <li><span className="text-green-400">Tax-Free</span> — Roth, HSA, Cash: No tax on withdrawals</li>
                                    <li><span className="text-yellow-400">Taxable</span> — Traditional 401k/IRA: Adds to taxable income</li>
                                    <li><span className="text-blue-400">Cap Gains</span> — Brokerage: Only gains are taxed</li>
                                </ul>
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-semibold text-gray-200">Common Strategies:</h4>
                                <ul className="text-gray-400 space-y-1">
                                    <li><span className="text-white">Tax-efficient:</span> Taxable → Tax-deferred → Tax-free</li>
                                    <li><span className="text-white">Roth ladder:</span> Convert Traditional to Roth over time</li>
                                    <li><span className="text-white">Bracket filling:</span> Withdraw Traditional up to tax bracket</li>
                                </ul>
                            </div>
                        </div>
                        <p className="text-gray-400 mt-3 text-xs">
                            <span className="text-gray-300">Tip:</span> Consider withdrawing from taxable accounts first to let tax-advantaged accounts grow longer. Early withdrawal from Traditional accounts before 59½ incurs a 10% penalty.
                        </p>
                    </div>
                )}

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

                {/* Withdrawal Debug Panel */}
                <WithdrawalDebugPanel
                    totalPortfolio={totalPortfolio}
                    withdrawalRate={withdrawalRate}
                    inflationRate={inflationRate}
                    strategy={withdrawalStrategyType}
                    formatMoney={formatMoney}
                />
            </div>
        </div>
    );
}
