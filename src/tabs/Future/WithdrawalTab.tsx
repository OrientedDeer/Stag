import { useContext, useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, AssumptionsState, WithdrawalBucket, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { AnyAccount, ESPPAccount, RSUAccount, SavedAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { formatCompactCurrency } from './tabs/FutureUtils';
import { buildProjection } from './buildProjection';
import { getRMDStartAge } from '../../data/RMDData';
import { SimulationYear } from '../../services/simulation/types';
import { Phase } from '../../services/simulation/TaxOptimizedWithdrawal';
import { getSimulationInputHash } from '../../services/simulationHash';
import { useReceiptToast } from '../../components/Layout/Overlays/ReceiptToast';
import { HelpSection } from './withdrawal/HelpSection';
import { TaxOptimizationControls } from './withdrawal/TaxOptimizationControls';
import { OptimizationSummaryCard, OptimizationSummary, ComparisonResult } from './withdrawal/OptimizationSummaryCard';
import { WithdrawalBucketList, BucketDetail } from './withdrawal/WithdrawalBucketList';
import { buildAccountTimeline } from './withdrawal/accountTimeline';
import { reorderWithdrawalStrategyTaxOptimal } from './withdrawal/reorderWithdrawalStrategy';

// Helper to get tax treatment badge for an account
const getTaxBadge = (account: AnyAccount | undefined): { label: string; color: string } => {
    if (!account) return { label: 'Unknown', color: 'bg-surface-hover' };

    if (account instanceof SavedAccount) {
        return { label: 'Tax-Free', color: 'bg-positive-solid' };
    }

    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Roth 401k':
            case 'Roth IRA':
                return { label: 'Tax-Free', color: 'bg-positive-solid' };
            case 'HSA':
                return { label: 'Tax-Free (HSA)', color: 'bg-positive-solid' };
            case 'Traditional 401k':
            case 'Traditional IRA':
                return { label: 'Taxable', color: 'bg-warning-solid' };
            case 'Brokerage':
                return { label: 'Cap Gains', color: 'bg-accent' };
            default:
                return { label: 'Taxable', color: 'bg-warning-solid' };
        }
    }

    if (account instanceof ESPPAccount) {
        return { label: 'ESPP (Mixed)', color: 'bg-cat-purple-solid' };
    }

    if (account instanceof RSUAccount) {
        return { label: 'RSU (Cap Gains)', color: 'bg-cat-purple-solid' };
    }

    return { label: 'Unknown', color: 'bg-surface-hover' };
};

export default function WithdrawalTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { show: showReceipt } = useReceiptToast();
    const forceExact = state.display?.useCompactCurrency === false;

    const taxOptimizationEnabled = state.investments.taxOptimizationEnabled;

    const { simulation, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { months: budgetMonths } = useContext(BudgetContext);
    const [isRecalculating, setIsRecalculating] = useState(false);

    // Refs to the latest state/simulation so the recalc + Auto-sort callbacks stay
    // referentially STABLE — capturing `state`/`simulation` in their deps would flip
    // their identity on every recalc and defeat memo() on the bucket list / controls.
    const stateRef = useRef(state);
    useEffect(() => { stateRef.current = state; }, [state]);
    const simulationRef = useRef(simulation);
    useEffect(() => { simulationRef.current = simulation; }, [simulation]);

    // Pure builder: run the full sim for a given assumptions object and return the
    // timeline + its input hash. Shared by the recalc path and the Auto-sort button.
    const buildSimulation = useCallback((assumptionsOverride: AssumptionsState): { sim: SimulationYear[]; hash: string } => {
        const sim = buildProjection(assumptionsOverride, accounts, incomes, expenses, taxState, budgetMonths, simulationRef.current);
        const hash = getSimulationInputHash(accounts, incomes, expenses, assumptionsOverride, taxState);
        return { sim, hash };
    }, [accounts, incomes, expenses, taxState, budgetMonths]);

    // Re-run simulation and update SimulationContext so summary fields refresh.
    // Always called with an explicit override (the caller already built the
    // updated assumptions), so we don't need `state` in the dep array.
    const recalculateSimulation = useCallback((assumptionsOverride: AssumptionsState) => {
        setIsRecalculating(true);
        // Yield to the event loop so the "recalculating" spinner can paint
        // before the synchronous simulation (~50-200ms) blocks the main
        // thread. Without this, React batches setIsRecalculating(true) with
        // the dispatch below and the spinner never appears.
        setTimeout(() => {
            const { sim, hash } = buildSimulation(assumptionsOverride);
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: sim, inputHash: hash }
            });
            setIsRecalculating(false);
        }, 50);
    }, [buildSimulation, dispatchSimulation]);

    // #154 "Auto sort": apply the engine's tax-efficient withdrawal ORDER for the user's
    // current age — penalty-free accounts before early-withdrawal-penalized ones, and
    // within each group by tax type (cash → taxable → tax-deferred → tax-free). So an
    // early-retirement "Traditional first" gets Traditional deferred (penalty) AND a
    // "Roth before brokerage" gets the taxable brokerage pulled ahead of the tax-free
    // Roth. Then the literal-order execution (Tax Opt off) runs exactly what's now shown.
    const onAutoSort = useCallback(() => {
        setIsRecalculating(true);
        setTimeout(() => {
            try {
                const current = stateRef.current;
                const currentAge = new Date().getFullYear() - getBirthYear(current.milestones);

                // Findings [5]/[6]: seed the ranker from the user's CURRENT strategy order
                // (so equal-rank accounts keep their visible sequence) and group buckets by
                // accountId (so duplicate buckets survive). Extracted to a pure function so
                // the test pins the REAL algorithm rather than a hand-maintained copy.
                const reordered = reorderWithdrawalStrategyTaxOptimal(
                    current.withdrawalStrategy,
                    accounts,
                    currentAge,
                );

                const changed = reordered.some((w, i) => w.accountId !== current.withdrawalStrategy[i]?.accountId);
                if (!changed) {
                    showReceipt({ message: 'Already in the tax-optimized withdrawal order.' });
                    return;
                }
                // Build the projection BEFORE committing the order: if buildSimulation throws,
                // the existing order + simulation stay intact rather than leaving the new order
                // showing against stale numbers.
                const { sim, hash } = buildSimulation({ ...current, withdrawalStrategy: reordered });
                dispatch({ type: 'SET_WITHDRAWAL_STRATEGY', payload: reordered });
                dispatchSimulation({ type: 'SET_SIMULATION_WITH_HASH', payload: { simulation: sim, inputHash: hash } });
                showReceipt({ message: 'Reordered to the tax-optimized withdrawal order.' });
            } catch {
                showReceipt({ message: 'Could not reorder the withdrawal order — please try again.' });
            } finally {
                setIsRecalculating(false);
            }
        }, 50);
    }, [accounts, dispatch, dispatchSimulation, buildSimulation, showReceipt]);

    const onUpdateInvestments = useCallback((payload: Partial<AssumptionsState['investments']>) => {
        const current = stateRef.current;
        const updated = { ...current, investments: { ...current.investments, ...payload } };
        dispatch({ type: 'UPDATE_INVESTMENTS', payload });
        recalculateSimulation(updated);
    }, [dispatch, recalculateSimulation]);

    const formatMoney = useCallback((amount: number) =>
        formatCompactCurrency(amount, { forceExact }), [forceExact]);

    // After-tax-wealth comparison (#94): both the strategy's and the std-ded baseline's
    // AFTER-TAX terminal net worth are computed once per recalc inside
    // runSimulationWithOptimization (one situation-based Traditional valuation, applied to
    // both, with the baseline invariant to the selected strategy) and stashed on year 0.
    // The old metric measured lifetime-tax-saved, which only sees the conversion's COST and
    // mis-ranked the max-wealth DP below the conservative (now std-ded-only) alternative.
    const comparisonResult = useMemo<ComparisonResult | null>(() => {
        if (simulation.length === 0) return null;
        const strategyAfterTax = simulation[0].strategyTerminalAfterTaxNW;
        const baselineAfterTax = simulation[0].stdDedBaselineTerminalAfterTaxNW;
        if (strategyAfterTax === undefined || baselineAfterTax === undefined) return null;
        return {
            afterTaxWithStrategy: strategyAfterTax,
            afterTaxStdDedOnly: baselineAfterTax,
            gain: strategyAfterTax - baselineAfterTax,
        };
    }, [simulation]);

    const optimizationSummary = useMemo<OptimizationSummary | null>(() => {
        if (!taxOptimizationEnabled) return null;

        const currentYear = new Date().getFullYear();
        const birthYear = getBirthYear(state.milestones);
        const rmdAge = getRMDStartAge(birthYear);
        const currentAge = currentYear - birthYear;
        const yearsUntilRMD = Math.max(0, rmdAge - currentAge);

        const currentTraditionalBalance = accounts
            .filter(acc =>
                acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
            )
            .reduce((sum, acc) => sum + acc.amount, 0);

        const rmdYear = birthYear + rmdAge;
        const rmdSimYear = simulation.find(s => s.year === rmdYear);
        const projectedBalance = rmdSimYear
            ? rmdSimYear.accounts
                .filter(acc => 'taxType' in acc && (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0)
            : currentTraditionalBalance;

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
            projectedBalance,
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
    }, [taxOptimizationEnabled, state.milestones, accounts, expenses, simulation]);

    // Filter to only withdrawal-eligible accounts (SavedAccount, InvestedAccount, ESPPAccount, RSUAccount)
    const eligibleAccounts = useMemo(() => accounts.filter(
        acc => acc instanceof SavedAccount || acc instanceof InvestedAccount || acc instanceof ESPPAccount || acc instanceof RSUAccount
    ), [accounts]);

    // Sync withdrawal strategy with accounts: add new eligible accounts, drop
    // buckets pointing at deleted accounts.
    useEffect(() => {
        const currentStrategy = state.withdrawalStrategy;

        const missingAccounts = eligibleAccounts.filter(
            acc => !currentStrategy.some(bucket => bucket.accountId === acc.id)
        );

        const validBuckets = currentStrategy.filter(
            bucket => eligibleAccounts.some(acc => acc.id === bucket.accountId)
        );

        const hasNewAccounts = missingAccounts.length > 0;
        const hasDeletedAccounts = validBuckets.length !== currentStrategy.length;

        if (hasNewAccounts || hasDeletedAccounts) {
            const newBuckets: WithdrawalBucket[] = missingAccounts.map(acc => ({
                id: `withdrawal-${acc.id}`,
                name: acc.name,
                accountId: acc.id,
            }));

            dispatch({
                type: 'SET_WITHDRAWAL_STRATEGY',
                payload: [...validBuckets, ...newBuckets]
            });
        }
    }, [eligibleAccounts, state.withdrawalStrategy, dispatch]);

    const onDragEnd = useCallback((result: DropResult) => {
        if (!result.destination) return;
        if (result.destination.index === result.source.index) return;
        const items = Array.from(state.withdrawalStrategy);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        dispatch({ type: 'SET_WITHDRAWAL_STRATEGY', payload: items });
        showReceipt({ message: 'Withdrawal order changed — projection updated' });
    }, [state.withdrawalStrategy, dispatch, showReceipt]);

    // Derive, per account, the year it is first tapped and the year it depletes,
    // directly from the cached simulation — this is what makes the burn-order
    // drag have a visible consequence. The derivation lives in a pure helper so
    // it's unit-testable (the key-mismatch bug behind #142 was invisible inline).
    const accountTimeline = useMemo(
        () => buildAccountTimeline(simulation, accounts, state.milestones),
        [simulation, accounts, state.milestones],
    );

    // Build a Map once so the lookup is O(1) per bucket instead of accounts.find() per bucket.
    const bucketsWithDetails = useMemo<BucketDetail[]>(() => {
        const byId = new Map(accounts.map(acc => [acc.id, acc]));
        return state.withdrawalStrategy.map(bucket => {
            const account = byId.get(bucket.accountId);
            const badge = getTaxBadge(account);
            return {
                ...bucket,
                account,
                badge,
                balance: account?.amount || 0,
                timeline: accountTimeline.get(bucket.accountId),
            };
        });
    }, [state.withdrawalStrategy, accounts, accountTimeline]);

    const [showHelp, setShowHelp] = useState(false);
    const toggleHelp = useCallback(() => setShowHelp(h => !h), []);

    return (
        <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24 text-white">
            <div className="w-full px-4 sm:px-8 max-w-4xl">
                <div className="flex items-center justify-between mb-2 border-b border-border-subtle pb-2">
                    <h2 className="text-2xl font-bold">Withdrawal Order</h2>
                    <button
                        onClick={toggleHelp}
                        className="text-xs text-content-muted hover:text-white flex items-center gap-1 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {showHelp ? 'Hide help' : 'How this works'}
                    </button>
                </div>

                {showHelp && <HelpSection taxOptimizationEnabled={taxOptimizationEnabled} />}

                <TaxOptimizationControls
                    investments={state.investments}
                    onUpdateInvestments={onUpdateInvestments}
                />

                {taxOptimizationEnabled && optimizationSummary && (
                    <OptimizationSummaryCard
                        summary={optimizationSummary}
                        comparisonResult={comparisonResult}
                        isRecalculating={isRecalculating}
                        formatMoney={formatMoney}
                    />
                )}

                <WithdrawalBucketList
                    taxOptimizationEnabled={taxOptimizationEnabled}
                    buckets={bucketsWithDetails}
                    onDragEnd={onDragEnd}
                    onAutoSort={onAutoSort}
                    isBusy={isRecalculating}
                    formatMoney={formatMoney}
                />
            </div>
        </div>
    );
}
