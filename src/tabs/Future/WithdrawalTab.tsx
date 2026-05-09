import { useContext, useEffect, useCallback, useState, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, WithdrawalBucket, getBirthYear, getLifeExpectancy } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AnyAccount, ESPPAccount, SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { formatCompactCurrency } from './tabs/FutureUtils';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { getRMDStartAge } from '../../data/RMDData';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { SimulationYear } from '../../services/simulation/types';
import { Phase } from '../../services/simulation/TaxOptimizedWithdrawal';
import { getSimulationInputHash } from '../../services/simulationHash';

// Helper to calculate lifetime taxes from simulation
function calculateLifetimeTaxes(simulation: SimulationYear[]): number {
    return simulation.reduce((total, year) => {
        const yearTaxes = year.taxDetails.fed + year.taxDetails.state +
                         year.taxDetails.fica + year.taxDetails.capitalGains;
        return total + yearTaxes;
    }, 0);
}

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

    if (account instanceof ESPPAccount) {
        // ESPP has mixed tax treatment: discount is ordinary income, gains are capital gains
        return { label: 'ESPP (Mixed)', color: 'bg-purple-600' };
    }

    return { label: 'Unknown', color: 'bg-gray-600' };
};

export default function WithdrawalTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const forceExact = state.display?.useCompactCurrency === false;

    // Tax optimization toggle state
    const taxOptimizationEnabled = state.investments.taxOptimizationEnabled;

    // Need simulation context to get projected balances at retirement
    const { simulation, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const [isRecalculating, setIsRecalculating] = useState(false);

    // Re-run simulation and update SimulationContext so summary fields refresh
    const recalculateSimulation = useCallback((assumptionsOverride?: typeof state) => {
        setIsRecalculating(true);
        setTimeout(() => {
            const assumptions = assumptionsOverride ?? state;
            const birthYear = getBirthYear(assumptions.milestones);
            const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
            const currentYear = new Date().getFullYear();
            const currentAge = currentYear - birthYear;
            const yearsToRun = Math.max(1, lifeExpectancy - currentAge);

            const newSimulation = runSimulationWithOptimization(yearsToRun, accounts, incomes, expenses, assumptions, taxState);
            const inputHash = getSimulationInputHash(accounts, incomes, expenses, assumptions, taxState);
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash }
            });
            setIsRecalculating(false);
        }, 50);
    }, [state, accounts, incomes, expenses, taxState, dispatchSimulation]);

    const setTaxOptimization = (enabled: boolean) => {
        const updatedState = {
            ...state,
            investments: { ...state.investments, taxOptimizationEnabled: enabled }
        };
        dispatch({
            type: 'UPDATE_INVESTMENTS',
            payload: { taxOptimizationEnabled: enabled }
        });
        // Re-run simulation with the new setting so summary fields update immediately
        recalculateSimulation(updatedState);
    };

    // Currency formatter that respects user display settings
    const formatMoney = useCallback((amount: number) =>
        formatCompactCurrency(amount, { forceExact }), [forceExact]);

    // Calculate optimization summary when enabled

    // Tax comparison state
    const [comparisonResult, setComparisonResult] = useState<{
        taxesWithOptimization: number;
        taxesWithoutOptimization: number;
        savings: number;
    } | null>(null);
    const [isCalculatingComparison, setIsCalculatingComparison] = useState(false);

    // Calculate tax comparison by running simulations with both settings
    const calculateComparison = useCallback(() => {
        setIsCalculatingComparison(true);

        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            const birthYear = getBirthYear(state.milestones);
            const lifeExpectancy = getLifeExpectancy(state.milestones);
            const currentYear = new Date().getFullYear();
            const currentAge = currentYear - birthYear;
            const yearsToRun = Math.max(1, lifeExpectancy - currentAge);

            // Create assumptions with tax optimization ON
            const assumptionsWithOpt = {
                ...state,
                investments: {
                    ...state.investments,
                    taxOptimizationEnabled: true,
                },
            };

            // Create assumptions with tax optimization OFF
            const assumptionsWithoutOpt = {
                ...state,
                investments: {
                    ...state.investments,
                    taxOptimizationEnabled: false,
                },
            };

            // Run both simulations
            const simWithOpt = runSimulationWithOptimization(yearsToRun, accounts, incomes, expenses, assumptionsWithOpt, taxState);
            const simWithoutOpt = runSimulationWithOptimization(yearsToRun, accounts, incomes, expenses, assumptionsWithoutOpt, taxState);

            // Calculate lifetime taxes for both
            const taxesWithOptimization = calculateLifetimeTaxes(simWithOpt);
            const taxesWithoutOptimization = calculateLifetimeTaxes(simWithoutOpt);

            setComparisonResult({
                taxesWithOptimization,
                taxesWithoutOptimization,
                savings: taxesWithoutOptimization - taxesWithOptimization,
            });

            // Update SimulationContext with the optimized simulation so summary fields refresh
            const activeSimulation = taxOptimizationEnabled ? simWithOpt : simWithoutOpt;
            const inputHash = getSimulationInputHash(accounts, incomes, expenses, state, taxState);
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: activeSimulation, inputHash }
            });

            setIsCalculatingComparison(false);
        }, 50);
    }, [state, accounts, incomes, expenses, taxState, taxOptimizationEnabled, dispatchSimulation]);

    const optimizationSummary = useMemo(() => {
        if (!taxOptimizationEnabled) return null;

        const currentYear = new Date().getFullYear();
        const birthYear = getBirthYear(state.milestones);
        const rmdAge = getRMDStartAge(birthYear);
        const currentAge = currentYear - birthYear;
        const yearsUntilRMD = Math.max(0, rmdAge - currentAge);

        // Get current Traditional balance
        const currentTraditionalBalance = accounts
            .filter(acc =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
            )
            .reduce((sum, acc) => sum + acc.amount, 0);

        // Projected Traditional balance at RMD age (the simulation's actual outcome).
        const rmdYear = birthYear + rmdAge;
        const rmdSimYear = simulation.find(s => s.year === rmdYear);
        const projectedBalance = rmdSimYear
            ? rmdSimYear.accounts
                .filter(acc => 'taxType' in acc && (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0)
            : currentTraditionalBalance;

        // Count conversions from simulation
        let totalConversions = 0;
        let conversionYearsCount = 0;
        let firstConversionAmount = 0;
        let maxConversionAmount = 0;
        for (const year of simulation) {
            const conversion = year.rothConversion?.amount || 0;
            if (conversion > 0) {
                totalConversions += conversion;
                conversionYearsCount++;
                if (firstConversionAmount === 0) {
                    firstConversionAmount = conversion;
                }
                if (conversion > maxConversionAmount) {
                    maxConversionAmount = conversion;
                }
            }
        }
        const avgConversionAmount = conversionYearsCount > 0 ? totalConversions / conversionYearsCount : 0;

        // Phase indicator based on account depletion state (independent of conversion logic).
        const brokerageBalance = accounts
            .filter(acc => acc instanceof InvestedAccount && acc.taxType === 'Brokerage')
            .reduce((sum, acc) => sum + acc.amount, 0);
        const rothBalance = accounts
            .filter(acc => acc instanceof InvestedAccount && (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA'))
            .reduce((sum, acc) => sum + acc.amount, 0);
        const totalExpenses = expenses.reduce((sum, e) => sum + (e.getAnnualAmount?.() || 0), 0);

        let phase: Phase = 'BROKERAGE_AVAILABLE';
        const brokerageYears = totalExpenses > 0 ? brokerageBalance / totalExpenses : 999;
        const rothYears = totalExpenses > 0 ? rothBalance / totalExpenses : 999;

        if (brokerageYears < 0.5) {
            phase = rothYears < 0.5 ? 'ROTH_DEPLETED' : 'BROKERAGE_DEPLETED';
        } else if (brokerageYears < 2) {
            phase = 'BROKERAGE_TRANSITION';
        }

        return {
            projectedBalance,             // Simulation outcome at RMD age
            avgConversionPerYear: avgConversionAmount,
            maxConversionInPlan: maxConversionAmount,
            firstYearConversion: firstConversionAmount,
            currentTraditionalBalance,
            totalConversions,
            conversionYearsCount,
            rmdAge,
            yearsUntilRMD,
            phase,
        };
    }, [taxOptimizationEnabled, state, accounts, expenses, simulation]);

    // Filter to only withdrawal-eligible accounts (SavedAccount, InvestedAccount, ESPPAccount)
    const eligibleAccounts = accounts.filter(
        acc => acc instanceof SavedAccount || acc instanceof InvestedAccount || acc instanceof ESPPAccount
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

                {/* Tax Optimization Toggle */}
                <div className="mb-6 p-4 bg-gray-900/50 rounded-xl border border-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-200">Tax Optimization</h3>
                            <p className="text-sm text-gray-400 mt-1">
                                {taxOptimizationEnabled
                                    ? 'Automatically optimizes withdrawals and Roth conversions to minimize lifetime taxes.'
                                    : 'Enable to automatically manage withdrawals and Roth conversions for tax efficiency.'}
                            </p>
                        </div>
                        <ToggleInput
                            label=""
                            enabled={taxOptimizationEnabled}
                            setEnabled={setTaxOptimization}
                        />
                    </div>
                    {taxOptimizationEnabled && (
                        <div className="mt-4 pt-4 border-t border-gray-800">
                            <label className="block mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-200">
                                        Conversion algorithm
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    {(['rate-match', 'dp-precomputed'] as const).map(option => {
                                        const active = (state.investments.rothConversionStrategy ?? 'rate-match') === option;
                                        const optionLabel = option === 'rate-match' ? 'Rate match' : 'Dynamic programming';
                                        const optionDesc = option === 'rate-match'
                                            ? 'Per-year bracket walk vs. projected RMD-age rate.'
                                            : 'Backward-induction DP over the full horizon (experimental).';
                                        return (
                                            <button
                                                key={option}
                                                type="button"
                                                onClick={() => {
                                                    const updated = {
                                                        ...state,
                                                        investments: { ...state.investments, rothConversionStrategy: option }
                                                    };
                                                    dispatch({
                                                        type: 'UPDATE_INVESTMENTS',
                                                        payload: { rothConversionStrategy: option }
                                                    });
                                                    recalculateSimulation(updated);
                                                }}
                                                className={`flex-1 text-left px-3 py-2 rounded-md border transition-colors ${
                                                    active
                                                        ? 'bg-blue-900/30 border-blue-700/50 text-blue-200'
                                                        : 'bg-gray-900/40 border-gray-800 text-gray-300 hover:border-gray-700'
                                                }`}
                                            >
                                                <div className="text-sm font-medium">{optionLabel}</div>
                                                <div className="text-xs text-gray-400 mt-0.5">{optionDesc}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </label>
                            {(state.investments.rothConversionStrategy ?? 'rate-match') === 'rate-match' && (
                            <label className="block">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium text-gray-200">
                                        Conversion aggressiveness
                                    </span>
                                    <span className="text-sm text-gray-400 tabular-nums">
                                        {((state.investments.rothConversionMinRateGap ?? 0.05) * 100).toFixed(1)}pp gap
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={20}
                                    step={1}
                                    value={(state.investments.rothConversionMinRateGap ?? 0.05) * 100}
                                    onChange={(e) => {
                                        const newGap = Number(e.target.value) / 100;
                                        const updated = {
                                            ...state,
                                            investments: { ...state.investments, rothConversionMinRateGap: newGap }
                                        };
                                        dispatch({
                                            type: 'UPDATE_INVESTMENTS',
                                            payload: { rothConversionMinRateGap: newGap }
                                        });
                                        recalculateSimulation(updated);
                                    }}
                                    className="w-full"
                                />
                            </label>
                            )}
                            {(state.investments.rothConversionStrategy ?? 'rate-match') === 'rate-match' && (
                            <details className="mt-2 group">
                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 select-none list-none flex items-center gap-1">
                                    More info
                                    <svg
                                        className="w-3 h-3 transition-transform duration-200 group-open:rotate-180"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                </summary>
                                <p className="text-xs text-gray-500 mt-2">
                                    Minimum percentage-point savings between today's rate and projected RMD-age rate
                                    required to convert. Lower = more aggressive (converts even when small savings).
                                    Higher = more conservative (only converts on big savings). Default 5pp.
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    Risks of a lower gap:
                                </p>
                                <ul className="text-xs text-gray-500 mt-1 ml-5 list-disc space-y-0.5">
                                    <li>
                                        <span className="text-gray-400">Sequence of returns:</span> a market
                                        crash after a conversion locks in tax paid on dollars that may never
                                        recover.
                                    </li>
                                    <li>
                                        <span className="text-gray-400">Growth too high:</span> lower real
                                        returns mean a smaller future RMD bracket than projected, so you save
                                        less.
                                    </li>
                                    <li>
                                        <span className="text-gray-400">Future tax brackets drop:</span> if
                                        rates fall, today's conversion was overpriced.
                                    </li>
                                </ul>
                            </details>
                            )}
                            {(state.investments.rothConversionStrategy ?? 'rate-match') === 'dp-precomputed' && (
                            <p className="text-xs text-gray-500 mt-2">
                                DP solves a backward-induction over the full retirement horizon, picking
                                the per-year conversion that minimizes lifetime tax. The aggressiveness
                                slider doesn't apply — DP does its own bracket comparison and includes a
                                small back-load preference (δ = 1.5%/yr).
                            </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Tax Optimization Summary (when enabled) */}
                {taxOptimizationEnabled && optimizationSummary && (
                    <div className={`mb-6 bg-green-900/20 border border-green-700/50 rounded-xl p-4 relative ${isRecalculating ? 'opacity-60' : ''}`}>
                        {isRecalculating && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/40 rounded-xl z-10">
                                <div className="flex items-center gap-2 text-green-300 text-sm">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Recalculating...
                                </div>
                            </div>
                        )}
                        {/* Header with Phase Badge */}
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-green-300 flex items-center gap-2">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Tax Optimization Active
                            </h3>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                                optimizationSummary.phase === 'BROKERAGE_AVAILABLE' ? 'bg-blue-600' :
                                optimizationSummary.phase === 'BROKERAGE_TRANSITION' ? 'bg-yellow-600' :
                                optimizationSummary.phase === 'BROKERAGE_DEPLETED' ? 'bg-orange-600' :
                                'bg-red-600'
                            }`}>
                                {optimizationSummary.phase === 'BROKERAGE_AVAILABLE' ? 'Accumulation' :
                                 optimizationSummary.phase === 'BROKERAGE_TRANSITION' ? 'Transition' :
                                 optimizationSummary.phase === 'BROKERAGE_DEPLETED' ? 'Roth Phase' :
                                 'Traditional Only'}
                            </span>
                        </div>

                        {/* Main Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Projected Traditional at RMD:</span>
                                    <span className="text-white font-semibold">{formatMoney(optimizationSummary.projectedBalance)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Current Traditional:</span>
                                    <span className="text-white">{formatMoney(optimizationSummary.currentTraditionalBalance)}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Years Until RMD:</span>
                                    <span className="text-white">{optimizationSummary.yearsUntilRMD} years (age {optimizationSummary.rmdAge})</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Avg. Conversion/Year:</span>
                                    <span className="text-white">{formatMoney(optimizationSummary.avgConversionPerYear)}</span>
                                </div>
                                {optimizationSummary.maxConversionInPlan > optimizationSummary.avgConversionPerYear * 1.2 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Peak Conversion:</span>
                                        <span className="text-yellow-300">{formatMoney(optimizationSummary.maxConversionInPlan)}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* First Year Conversion */}
                        {optimizationSummary.firstYearConversion > 0 && (
                            <div className="mt-4 pt-4 border-t border-green-800/50">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-300">First Year Conversion</h4>
                                        <p className="text-xs text-gray-500">Starts the conversion ladder to reduce future RMDs</p>
                                    </div>
                                    <span className="text-lg font-bold text-green-400">{formatMoney(optimizationSummary.firstYearConversion)}</span>
                                </div>
                            </div>
                        )}

                        {/* Tax Savings Comparison */}
                        <div className="mt-4 pt-4 border-t border-green-800/50">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold text-gray-300">Lifetime Tax Comparison</h4>
                                <button
                                    onClick={calculateComparison}
                                    disabled={isCalculatingComparison}
                                    className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-wait rounded-lg transition-colors flex items-center gap-1"
                                >
                                    {isCalculatingComparison ? (
                                        <>
                                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Calculating...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                            </svg>
                                            Calculate Savings
                                        </>
                                    )}
                                </button>
                            </div>

                            {comparisonResult ? (
                                <div className="bg-gray-800/50 rounded-lg p-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">With Optimization:</span>
                                        <span className="text-white">{formatMoney(comparisonResult.taxesWithOptimization)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Without Optimization:</span>
                                        <span className="text-white">{formatMoney(comparisonResult.taxesWithoutOptimization)}</span>
                                    </div>
                                    <div className="flex justify-between pt-2 border-t border-gray-700">
                                        <span className="text-gray-300 font-medium">Lifetime Tax Savings:</span>
                                        <span className={`font-bold ${comparisonResult.savings > 0 ? 'text-green-400' : comparisonResult.savings < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                            {comparisonResult.savings > 0 ? '+' : ''}{formatMoney(comparisonResult.savings)}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-gray-500">
                                    Click "Calculate Savings" to run full simulations with and without tax optimization and compare lifetime taxes.
                                </p>
                            )}
                        </div>

                        <p className="mt-4 text-xs text-gray-500">
                            Roth conversions are sized by rate-match: each year, fill brackets where today's
                            rate is at least the configured gap below the projected RMD-age rate. Conversions
                            taper naturally as the projected RMD bracket drops. Withdrawals are automatically
                            ordered to minimize taxes.
                        </p>
                    </div>
                )}

                {/* Expandable Help Section */}
                {showHelp && (
                    <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 text-sm">
                        <h3 className="font-semibold text-blue-300 mb-2">Understanding Withdrawal Order</h3>
                        <p className="text-gray-300 mb-3">
                            In retirement, when your expenses exceed your income, money is withdrawn from your accounts to cover the gap.
                            {taxOptimizationEnabled
                                ? ' With Tax Optimization enabled, the system automatically determines the best order each year.'
                                : ' The order you set here determines which accounts get drained first.'}
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
                                <h4 className="font-semibold text-gray-200">{taxOptimizationEnabled ? 'Tax Optimization Strategy:' : 'Common Strategies:'}</h4>
                                <ul className="text-gray-400 space-y-1">
                                    {taxOptimizationEnabled ? (
                                        <>
                                            <li><span className="text-white">Bracket filling:</span> Fill lower brackets with Traditional first</li>
                                            <li><span className="text-white">Smart ordering:</span> Use Roth for excess, preserve tax-free growth</li>
                                            <li><span className="text-white">CG optimization:</span> Prefer long-term gains when rates are lower</li>
                                        </>
                                    ) : (
                                        <>
                                            <li><span className="text-white">Tax-efficient:</span> Taxable → Tax-deferred → Tax-free</li>
                                            <li><span className="text-white">Roth ladder:</span> Convert Traditional to Roth over time</li>
                                            <li><span className="text-white">Bracket filling:</span> Withdraw Traditional up to tax bracket</li>
                                        </>
                                    )}
                                </ul>
                            </div>
                        </div>
                        <p className="text-gray-400 mt-3 text-xs">
                            {taxOptimizationEnabled ? (
                                <><span className="text-gray-300">Note:</span> Tax Optimization automatically manages Roth conversions and withdrawal ordering. Manual ordering below is disabled.</>
                            ) : (
                                <><span className="text-gray-300">Tip:</span> Consider withdrawing from taxable accounts first to let tax-advantaged accounts grow longer. Early withdrawal from Traditional accounts before 59½ incurs a 10% penalty.</>
                            )}
                        </p>
                    </div>
                )}

                {/* Manual Ordering Section - disabled when tax optimization is on */}
                {taxOptimizationEnabled ? (
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
                ) : (
                    <>
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
                    </>
                )}

            </div>
        </div>
    );
}
