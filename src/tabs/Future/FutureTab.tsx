import React, { useState, useContext, useMemo, useEffect, useCallback } from 'react';
import { useSubTabKeyboardNav } from '../../hooks/useKeyboardShortcuts';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { AssumptionsContext, getLifeExpectancy, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { getSimulationInputHash } from '../../services/simulationHash';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { ESPPAccount, InvestedAccount, PropertyAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { computeEOYBudgetContributions } from '../../services/eoyContributionProjection';
import { calculateMilestones, formatAge, MilestonesSummary } from '../../services/MilestoneCalculator';
import { LoadingSpinner, LoadingOverlay } from '../../components/Layout/LoadingSpinner';
import { AlertBanner } from '../../components/Layout/AlertBanner';

// --- Charts ---
import { AssetsStreamChart } from '../../components/Charts/AssetsStreamChart';
import { colorMapForKeys } from '../../components/Charts/chartColors';

// --- Tabs ---
import { OverviewTab } from './tabs/OverviewTab';
import { CashflowTab } from './tabs/CashflowTabs';
import { DebtTab } from './tabs/DebtTab';
import { DataTab } from './tabs/DataTab';
import { MonteCarloTab } from './tabs/MonteCarloTab';
import { TaxOptimizationTab } from './tabs/TaxOptimizationTab';
import { ScenarioComparisonTab } from './tabs/ScenarioComparisonTab';
import { FinancialRatiosTab } from './tabs/FinancialRatiosTab';
import { Panel } from "../../components/Layout/Primitives";

// All visible tabs
const all_tabs = ["Overview", "Cashflow", "Assets", "Debt", "Monte Carlo", "Tax", "Scenarios", "Ratios", "Data"];

// --- Inline Assets Tab (Memoized) ---
const AssetsTab = React.memo(({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { data, keys } = useMemo(() => {
        const allKeys = new Set<string>();
        const mappedData = simulationData.map(year => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const datum: any = { year: year.year };
            year.accounts.forEach(acc => {
                // Include only asset accounts (Saved, Invested, ESPP, Property)
                if (acc instanceof SavedAccount || acc instanceof InvestedAccount || acc instanceof ESPPAccount || acc instanceof PropertyAccount) {
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
        <div className="h-125 w-full">
            <AssetsStreamChart data={data} keys={keys} colors={colors} />
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
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('stag_future_tab');
        return saved && all_tabs.includes(saved) ? saved : 'Overview';
    });

    // Persist tab selection
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_future_tab', tab);
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

    const executeSimulation = useCallback(() => {
        const today = new Date();
        const currentYear = today.getFullYear();
        const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
        const startAge = currentYear - getBirthYear(assumptions.milestones);
        const remainderGoals = (simulation.find(s => s.year === startYear + 1)?.cashflow.bucketDetail
            ?? simulation.find(s => s.year === startYear)?.cashflow.bucketDetail
            ?? {});
        const { additions, debtReductions, mortgageReductions } = computeEOYBudgetContributions(
            assumptions.priorities, accounts, incomes, expenses, budgetMonths,
            assumptions, taxState, startYear, today, remainderGoals,
        );
        return runSimulationWithOptimization(
            getLifeExpectancy(assumptions.milestones) - startAge,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState,
            undefined,
            undefined,
            additions,
            debtReductions,
            mortgageReductions,
        );
    }, [assumptions, accounts, incomes, expenses, taxState, budgetMonths, simulation]);

    const handleRecalculate = useCallback(() => {
        setIsLoading(true);
        // Use setTimeout to allow the UI to update before running the simulation
        setTimeout(() => {
            const newSimulation = executeSimulation();
            // Store simulation with input hash for staleness detection
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash: currentInputHash }
            });
            setIsLoading(false);
        }, 50);
    }, [executeSimulation, dispatchSimulation, currentInputHash]);

    // Auto-recalculate simulation on mount if we have data but no simulation
    // This fixes the issue where localStorage data loads but simulation is stale/empty
    useEffect(() => {
        const hasData = accounts.length > 0 || incomes.length > 0 || expenses.length > 0;
        const hasNoSimulation = simulation.length === 0;

        if (hasData && hasNoSimulation) {
            setIsLoading(true);
            setTimeout(() => {
                const newSimulation = executeSimulation();
                dispatchSimulation({
                    type: 'SET_SIMULATION_WITH_HASH',
                    payload: { simulation: newSimulation, inputHash: currentInputHash }
                });
                setIsLoading(false);
            }, 50);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run on mount - we want to check localStorage state once

    // Auto-run simulation after 500ms of being stale (inputs changed)
    useEffect(() => {
        if (!isSimulationStale || isLoading) return;

        const timer = setTimeout(() => {
            handleRecalculate();
        }, 500);

        return () => clearTimeout(timer);
    }, [isSimulationStale, currentInputHash, isLoading, handleRecalculate]);

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
            <div data-sub-tab-content className={activeTab === 'Monte Carlo' ? '' : 'hidden'}>
                <MonteCarloTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Tax' ? '' : 'hidden'}>
                <TaxOptimizationTab simulationData={simulationWithoutEOY} />
            </div>
            <div data-sub-tab-content className={activeTab === 'Scenarios' ? '' : 'hidden'}>
                <ScenarioComparisonTab simulationData={simulationWithoutEOY} />
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
                            You do not have a <strong>"Remainder"</strong> bucket set up in your Priorities.
                            Any unallocated cash (surplus income) will disappear from the simulation instead of being saved.
                            <br/>
                            Please go to the <strong>Allocation</strong> tab and create a bucket with Cap Type: <strong>"Remainder"</strong>.
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
                    {isLoading && <LoadingOverlay message="Running simulation..." />}
                    {renderTabContent()}
                </Panel>
            </div>
        </div>
    );
}