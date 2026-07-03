import React, { useState, useContext, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSubTabKeyboardNav } from '../../hooks/useKeyboardShortcuts';
import { AssumptionsContext, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { getSimulationInputHash } from '../../services/simulationHash';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { ESPPAccount, RSUAccount, InvestedAccount, PropertyAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { getIncomeNonVestingRSUReason, NonVestingRSUReason } from '../../components/Objects/Income/incomeCardUtils';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { calculateMilestones, formatAge, MilestonesSummary } from '../../services/MilestoneCalculator';
import { LoadingSpinner, LoadingOverlay } from '../../components/Layout/LoadingSpinner';
import { AlertBanner } from '../../components/Layout/AlertBanner';

// --- Charts ---
import { AssetsStreamChart } from '../../components/Charts/AssetsStreamChart';
import { colorMapForKeys } from '../../components/Charts/chartColors';

// --- Tabs ---
import { OverviewTab } from './tabs/OverviewTab';
import { buildProjectionAsync } from './buildProjection';
import { JointSearchSupersededError } from '../../services/jointSearchRunner';
import { AfterTaxNetWorthChart } from './tabs/AfterTaxNetWorthChart';
import { CashflowTab } from './tabs/CashflowTabs';
import { DebtTab } from './tabs/DebtTab';
import { DataTab } from './tabs/DataTab';
import { MonteCarloTab } from './tabs/MonteCarloTab';
import { TaxOptimizationTab } from './tabs/TaxOptimizationTab';
import { ScenarioComparisonTab } from './tabs/ScenarioComparisonTab';
import { FinancialRatiosTab } from './tabs/FinancialRatiosTab';
import { Panel } from "../../components/Layout/Primitives";
import { FUTURE_TABS, migrateSavedFutureTab } from './futureTabs';

// All visible tabs. "Risk" wraps Monte Carlo (which nests its own Historical
// Backtest toggle); "Strategy" wraps Tax + Scenarios behind a secondary toggle.
const all_tabs = FUTURE_TABS;

type StrategySubTab = "Tax" | "Scenarios";
const STRATEGY_SUBTAB_KEY = "stag_strategy_subtab";

// --- Inline Assets Tab (Memoized) ---
const AssetsTab = React.memo(({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { data, keys } = useMemo(() => {
        const allKeys = new Set<string>();
        const mappedData = simulationData.map(year => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const datum: any = { year: year.year };
            year.accounts.forEach(acc => {
                // Include only asset accounts (Saved, Invested, ESPP, RSU, Property)
                if (acc instanceof SavedAccount || acc instanceof InvestedAccount || acc instanceof ESPPAccount || acc instanceof RSUAccount || acc instanceof PropertyAccount) {
                    let val = acc.amount;
                    if (acc instanceof PropertyAccount) {
                        val -= (acc.loanAmount || 0);
                    }
                    datum[acc.name] = val;
                    allKeys.add(acc.name);
                }
            });
            return datum;
        });
        return { data: mappedData, keys: Array.from(allKeys) };
    }, [simulationData]);

    const colors = useMemo(() => colorMapForKeys(keys), [keys]);

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="h-125 w-full">
                <AssetsStreamChart data={data} keys={keys} colors={colors} />
            </div>
            <AfterTaxNetWorthChart simulationData={simulationData} />
        </div>
    );
});

// --- Milestone Card Component (Memoized) ---
interface MilestoneCardProps {
    title: string;
    age: number;
    year: number;
    status: 'now' | 'future' | 'projected' | 'reached';
    yearsUntil?: number;
}

const MilestoneCard = React.memo(({ title, age, year, status, yearsUntil }: MilestoneCardProps) => {
    const statusColors = {
        now: 'border-positive-soft bg-positive-tint/20',
        reached: 'border-positive-soft bg-positive-tint/20',
        projected: 'border-accent-soft bg-info-tint/20',
        future: 'border-border-default bg-surface-overlay/50',
    };

    const statusLabels = {
        now: 'NOW',
        reached: 'REACHED',
        projected: 'PROJECTED',
        future: yearsUntil ? `${yearsUntil} yrs` : '',
    };

    return (
        <div className={`rounded-lg border p-2 text-center ${statusColors[status]}`}>
            <div className="text-[10px] text-content-muted uppercase tracking-wide">{title}</div>
            <div className="text-lg font-bold text-white leading-tight">Age {formatAge(age)}</div>
            <div className="text-xs text-content-muted">{year}</div>
            <div className={`text-[10px] font-semibold ${status === 'now' || status === 'reached' ? 'text-positive' : status === 'projected' ? 'text-info' : 'text-content-muted'}`}>
                {statusLabels[status]}
            </div>
        </div>
    );
});

// --- Progress Timeline Component (Memoized) ---
interface ProgressTimelineProps {
    milestones: MilestonesSummary;
}

const ProgressTimeline = React.memo(({ milestones }: ProgressTimelineProps) => {
    const { currentAge, retirementAge, lifeExpectancy } = milestones;

    // Calculate positions as percentages
    const startAge = 0;
    const range = lifeExpectancy - startAge;
    const currentPos = ((currentAge - startAge) / range) * 100;
    const retirementPos = ((retirementAge - startAge) / range) * 100;

    return (
        <div className="relative h-5 bg-surface-overlay rounded-full overflow-hidden">
            {/* Progress fill */}
            <div
                className="absolute h-full bg-linear-to-r from-positive-solid to-positive-soft rounded-l-full"
                style={{ width: `${currentPos}%` }}
            />

            {/* Retirement marker */}
            <div
                className="absolute top-0 h-full w-1 bg-warning"
                style={{ left: `${retirementPos}%` }}
                title={`Retirement: Age ${retirementAge}`}
            />

            {/* Current position marker */}
            <div
                className="absolute top-0 h-full w-3 bg-white rounded-full shadow-lg transform -translate-x-1/2"
                style={{ left: `${currentPos}%` }}
            />

            {/* Labels */}
            <div className="absolute -bottom-4 left-0 text-xs text-content-muted">0</div>
            <div
                className="absolute -bottom-4 text-xs text-content-muted transform -translate-x-1/2"
                style={{ left: `${currentPos}%` }}
            >
                {currentAge}
            </div>
            <div
                className="absolute -bottom-4 text-xs text-warning transform -translate-x-1/2"
                style={{ left: `${retirementPos}%` }}
            >
                {retirementAge}
            </div>
            <div className="absolute -bottom-4 right-0 text-xs text-content-muted">{lifeExpectancy}</div>
        </div>
    );
});

// --- Main Component ---
export default function FutureTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation, inputHash: storedInputHash, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { months: budgetMonths } = useContext(BudgetContext);
    const [activeTab, setActiveTab] = useState(() =>
        migrateSavedFutureTab(localStorage.getItem('stag_future_tab'))
    );
    const [strategySubTab, setStrategySubTab] = useState<StrategySubTab>(() => {
        const saved = localStorage.getItem(STRATEGY_SUBTAB_KEY);
        if (saved === 'Tax' || saved === 'Scenarios') return saved;
        // First run after the regroup: land on the panel the user last used.
        return localStorage.getItem('stag_future_tab') === 'Scenarios' ? 'Scenarios' : 'Tax';
    });

    // Persist tab selections
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_future_tab', tab);
    };
    const handleStrategySubTabChange = (tab: StrategySubTab) => {
        setStrategySubTab(tab);
        localStorage.setItem(STRATEGY_SUBTAB_KEY, tab);
    };
    const [isLoading, setIsLoading] = useState(false);

    useSubTabKeyboardNav(all_tabs, activeTab, handleTabChange);

    const visible_tabs = all_tabs;

    // Compute current input hash for staleness detection
    const currentInputHash = useMemo(() =>
        getSimulationInputHash(accounts, incomes, expenses, assumptions, taxState),
        [accounts, incomes, expenses, assumptions, taxState]
    );

    // Check if simulation results are stale (inputs changed since last run)
    const isSimulationStale = useMemo(() => {
        if (simulation.length === 0) return false; // No simulation yet, not "stale"
        if (!storedInputHash) return true; // Have simulation but no hash, consider stale
        return storedInputHash !== currentInputHash;
    }, [storedInputHash, currentInputHash, simulation.length]);

    // 1. Check for Missing Remainder Bucket
    const hasRemainderBucket = useMemo(() => {
        return assumptions.priorities.some(p => p.capType === 'REMAINDER');
    }, [assumptions.priorities]);

    // 1b. Non-vesting RSU grants (#132). A configured RSU grant that can't be
    // valued — no anchor (neither a start date nor a milestone), no linked account,
    // or no current share price — makes the engine recognize $0 ordinary income at
    // vest (see processRSUVesting's `!anchorDate`, `!rsuAccount`, and `fmvAtVest <= 0`
    // skips). The only existing cues were card-level/display-only, so the misleading
    // $0 could silently land in these headline numbers. Surface a top-level warning
    // naming each affected income and WHY. Derived via the same shared classifier the
    // card uses, so the banner can't disagree with the card or the engine. Carry the
    // income `id` so the list key is unique even for two same-named incomes (a
    // `name-reason` key collided and silently dropped a row — finding [3]).
    const nonVestingRSUWarnings = useMemo(() => {
        const rsuAccounts = accounts.filter((acc): acc is RSUAccount => acc instanceof RSUAccount);
        return incomes
            .map((inc) => ({ id: inc.id, name: inc.name, reason: getIncomeNonVestingRSUReason(inc, rsuAccounts) }))
            .filter((w): w is { id: string; name: string; reason: NonVestingRSUReason } => w.reason !== null);
    }, [accounts, incomes]);

    // Cause-complete remediation hints for the banner footer: one per DISTINCT cause
    // actually present, so the guidance never mentions only the price fix while an
    // un-anchored / unlinked grant goes unaddressed (finding [4]). Empty when the only
    // remedy is "fix it on the income card" with no cause-specific step to add.
    const rsuFixHints = useMemo(() => {
        const reasons = new Set(nonVestingRSUWarnings.map((w) => w.reason));
        const hints: string[] = [];
        if (reasons.has('no-anchor')) hints.push('set a start date or start milestone');
        if (reasons.has('no-account')) hints.push('link an RSU account');
        if (reasons.has('no-price')) hints.push('set a Current Share Price on the linked RSU account');
        return hints;
    }, [nonVestingRSUWarnings]);

    // #158: the joint search runs in a Web Worker (buildProjectionAsync), so a
    // recalc no longer freezes the main thread — the spinner actually spins and
    // edits made mid-run take effect (the runner supersedes the in-flight
    // worker). Two refs implement the staleness contract:
    //   latestHashRef        — the hash of the inputs as of the LAST render;
    //                          a resolved result whose request-time hash no
    //                          longer matches is DROPPED (never dispatched).
    //   lastRequestedHashRef — the hash the most recent request was started
    //                          for; the debounce effect keys off it instead of
    //                          `isLoading` so a mid-run edit schedules a new
    //                          request (superseding the old one) rather than
    //                          waiting for the doomed run to finish.
    const latestHashRef = useRef(currentInputHash);
    useEffect(() => { latestHashRef.current = currentInputHash; }, [currentInputHash]);
    const lastRequestedHashRef = useRef<string | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('Running simulation...');

    const handleRecalculate = useCallback(() => {
        const hashAtRequest = currentInputHash;
        lastRequestedHashRef.current = hashAtRequest;
        setIsLoading(true);
        setLoadingMessage('Running simulation...');
        buildProjectionAsync(
            assumptions, accounts, incomes, expenses, taxState, budgetMonths, simulation,
            setLoadingMessage,
        ).then(newSimulation => {
            if (latestHashRef.current !== hashAtRequest) {
                // Inputs changed while this (sync-fallback or worker) run was in
                // flight — drop the stale result; the debounce effect below has
                // already scheduled/started a run for the new inputs.
                setIsLoading(false);
                return;
            }
            // Store simulation with input hash for staleness detection
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash: hashAtRequest }
            });
            setIsLoading(false);
        }).catch(err => {
            // Superseded → the newer request owns the spinner; anything else is
            // unexpected (buildProjectionAsync already swallowed worker failures
            // into the sync fallback) — release the spinner so the UI can't hang.
            if (err instanceof JointSearchSupersededError) return;
            setIsLoading(false);
        });
    }, [assumptions, accounts, incomes, expenses, taxState, budgetMonths, simulation,
        dispatchSimulation, currentInputHash]);

    // Auto-recalculate simulation on mount if we have data but no simulation
    // This fixes the issue where localStorage data loads but simulation is stale/empty
    useEffect(() => {
        const hasData = accounts.length > 0 || incomes.length > 0 || expenses.length > 0;
        const hasNoSimulation = simulation.length === 0;

        if (hasData && hasNoSimulation) {
            handleRecalculate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run on mount - we want to check localStorage state once

    // Auto-run simulation after 500ms of being stale (inputs changed). Keyed on
    // lastRequestedHashRef (not isLoading): a request for THESE inputs must only
    // be started once, but an edit while an older run is still in flight should
    // start (and supersede into) a new run immediately after the debounce.
    useEffect(() => {
        if (!isSimulationStale) return;
        if (lastRequestedHashRef.current === currentInputHash) return;

        const timer = setTimeout(() => {
            handleRecalculate();
        }, 500);

        return () => clearTimeout(timer);
    }, [isSimulationStale, currentInputHash, handleRecalculate]);

    // Calculate milestones using the centralized service
    const milestones = useMemo(() =>
        calculateMilestones(assumptions, simulation),
        [assumptions, simulation]
    );

    // Filter out end-of-year projection points for tabs that don't need them
    const simulationWithoutEOY = useMemo(() =>
        simulation.filter(y => !y.isEndOfYearProjection),
        [simulation]
    );

    if (simulation.length === 0) {
        return (
            <div className="p-4 text-white bg-surface-base text-center">
                <div className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="md" />
                    <p>Running simulation...</p>
                </div>
            </div>
        );
    }

    // Tab content with CSS visibility to avoid unmounting charts
    // This keeps Nivo charts mounted, preventing expensive re-initialization
    const renderTabContent = () => (
        <>
            <div data-sub-tab-content className={activeTab === 'Overview' ? '' : 'hidden'}>
                <OverviewTab simulationData={simulation} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Cashflow' ? '' : 'hidden'}>
                <CashflowTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Assets' ? '' : 'hidden'}>
                <AssetsTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Debt' ? '' : 'hidden'}>
                <DebtTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Risk' ? '' : 'hidden'}>
                {/* Monte Carlo nests its own Monte Carlo / Historical Backtest toggle */}
                <MonteCarloTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Strategy' ? '' : 'hidden'}>
                {/* Secondary toggle — same pill idiom as MonteCarloTab's sub-tabs */}
                <div className="flex gap-1 bg-surface-overlay/50 rounded-lg p-1 w-fit mb-4">
                    {(['Tax', 'Scenarios'] as const).map((tab) => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={strategySubTab === tab}
                            onClick={() => handleStrategySubTabChange(tab)}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                strategySubTab === tab
                                    ? 'bg-positive-solid text-white'
                                    : 'text-content-muted hover:text-white hover:bg-surface-input'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                {/* CSS-hidden (not unmounted) so charts stay initialized */}
                <div className={strategySubTab === 'Tax' ? '' : 'hidden'}>
                    <TaxOptimizationTab simulationData={simulationWithoutEOY} />
                </div>
                <div className={strategySubTab === 'Scenarios' ? '' : 'hidden'}>
                    <ScenarioComparisonTab simulationData={simulationWithoutEOY} />
                </div>
            </div>
            <div data-sub-tab-content className={activeTab === 'Ratios' ? '' : 'hidden'}>
                <FinancialRatiosTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Data' ? '' : 'hidden'}>
                <DataTab simulationData={simulationWithoutEOY} birthYear={getBirthYear(assumptions.milestones)} />
            </div>
        </>
    );

    return (
        <div className="w-full flex bg-surface-base justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                
                {/* 2. Warning Banner */}
                {!hasRemainderBucket && (
                    <AlertBanner severity="warning" title="Warning: Disappearing Money" className="mb-6">
                        <p className="text-sm">
                            You do not have a <strong>"Remainder"</strong> bucket set up in Allocation.
                            Any unallocated cash (surplus income) will disappear from the simulation instead of being saved.
                            <br/>
                            Please go to the <strong>Allocation</strong> page and create a bucket with Cap Type: <strong>"Remainder"</strong>.
                        </p>
                    </AlertBanner>
                )}

                {/* Milestone Cards */}
                <Panel padding="sm" className="mb-4 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-base font-bold text-white">Retirement Timeline</h2>
                        {isLoading ? (
                            <span className="px-2 py-1 text-xs bg-accent text-white rounded-full flex items-center gap-1">
                                <LoadingSpinner size="sm" /> Updating...
                            </span>
                        ) : (
                            <button
                                onClick={handleRecalculate}
                                className="px-2 py-1 text-xs bg-surface-input hover:bg-surface-hover text-content-default rounded-full transition-colors"
                            >
                                ↻ Recalculate
                            </button>
                        )}
                    </div>

                    {/* Milestone Cards Grid */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <MilestoneCard
                            title="Current"
                            age={milestones.currentAge}
                            year={milestones.currentYear}
                            status="now"
                        />
                        <MilestoneCard
                            title="Retirement"
                            age={milestones.retirementAge}
                            year={milestones.retirementYear}
                            status={milestones.currentAge >= milestones.retirementAge ? 'reached' : 'future'}
                            yearsUntil={milestones.retirementAge - milestones.currentAge}
                        />
                        <MilestoneCard
                            title="Plan End"
                            age={milestones.lifeExpectancy}
                            year={milestones.lifeExpectancyYear}
                            status="future"
                            yearsUntil={milestones.lifeExpectancy - milestones.currentAge}
                        />
                    </div>

                    {/* Progress Timeline */}
                    <div>
                        <ProgressTimeline milestones={milestones} />
                    </div>
                </Panel>

                {/* Non-vesting RSU grant warning (#132). A configured grant that
                    can't be valued recognizes $0 ordinary income at vest, silently
                    landing in the headline numbers. Surface it with the results
                    (below the retirement timeline) so it can't be missed by
                    collapsing/scrolling past the income card. */}
                {nonVestingRSUWarnings.length > 0 && (
                    <AlertBanner severity="warning" title="RSU Grant Won't Vest" className="mb-4">
                        <p className="text-sm">
                            One or more income sources have a configured RSU grant that the
                            projection can&apos;t value, so each affected vest recognizes
                            <strong> $0</strong> of income:
                        </p>
                        <ul className="mt-2 list-disc list-inside text-sm space-y-1">
                            {nonVestingRSUWarnings.map((w) => (
                                <li key={w.id}>
                                    <strong>{w.name}</strong>
                                    {w.reason === 'no-price'
                                        ? "'s RSU grant won't vest — its linked RSU account has no current share price set."
                                        : w.reason === 'no-account'
                                            ? "'s RSU grant won't vest — it isn't linked to an RSU account, so vesting recognizes $0."
                                            : "'s RSU grant won't vest — it has neither a start date nor a start milestone, so there's no anchor to vest against."}
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-sm">
                            Fix it on the income card in the <strong>Income</strong> tab
                            {rsuFixHints.length > 0 ? ` (${rsuFixHints.join('; ')})` : ''}
                            {' '}so the vest value reaches your projection.
                        </p>
                    </AlertBanner>
                )}

                {/* Tab System */}
                <Panel padding="none" className="rounded-lg mb-1 flex overflow-x-auto custom-scrollbar">
                    {visible_tabs.map((tab) => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${activeTab === tab
                                ? "text-positive-bright bg-surface-overlay border-b-2 border-positive-bright"
                                : "text-content-muted hover:bg-surface-overlay hover:text-white"
                                }`}
                            onClick={() => handleTabChange(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </Panel>

                {/* Main Content */}
                <Panel padding="lg" className="shadow-2xl mb-4 overflow-visible relative">
                    {isLoading && <LoadingOverlay message={loadingMessage} />}
                    {renderTabContent()}
                </Panel>
            </div>
        </div>
    );
}