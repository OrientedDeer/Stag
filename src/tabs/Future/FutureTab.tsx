import React, { useState, useContext, useMemo, useEffect, useCallback } from 'react';
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
import { calculateMilestones, formatAge, MilestonesSummary } from '../../services/MilestoneCalculator';
import { LoadingSpinner, LoadingOverlay } from '../../components/Layout/LoadingSpinner';
import { AlertBanner } from '../../components/Layout/AlertBanner';

// --- Charts ---
import { AssetsStreamChart } from '../../components/Charts/AssetsStreamChart';

// --- Tabs ---
import { OverviewTab } from './tabs/OverviewTab';
import { CashflowTab } from './tabs/CashflowTabs';
import { DebtTab } from './tabs/DebtTab';
import { DataTab } from './tabs/DataTab';
import { MonteCarloTab } from './tabs/MonteCarloTab';
import { TaxOptimizationTab } from './tabs/TaxOptimizationTab';
import { ScenarioComparisonTab } from './tabs/ScenarioComparisonTab';
import { FinancialRatiosTab } from './tabs/FinancialRatiosTab';

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

    const colors = useMemo(() => {
        const palette = [
            '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', 
            '#2dd4bf', '#fb7185', '#c084fc', '#a3e635', '#22d3ee'
        ];
        const map: Record<string, string> = {};
        keys.forEach((key, i) => {
            map[key] = palette[i % palette.length];
        });
        return map;
    }, [keys]);

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
        now: 'border-green-500 bg-green-900/20',
        reached: 'border-green-500 bg-green-900/20',
        projected: 'border-blue-500 bg-blue-900/20',
        future: 'border-gray-700 bg-gray-800/50',
    };

    const statusLabels = {
        now: 'NOW',
        reached: 'REACHED',
        projected: 'PROJECTED',
        future: yearsUntil ? `${yearsUntil} yrs` : '',
    };

    return (
        <div className={`rounded-lg border p-2 text-center ${statusColors[status]}`}>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{title}</div>
            <div className="text-lg font-bold text-white leading-tight">Age {formatAge(age)}</div>
            <div className="text-xs text-gray-400">{year}</div>
            <div className={`text-[10px] font-semibold ${status === 'now' || status === 'reached' ? 'text-green-400' : status === 'projected' ? 'text-blue-400' : 'text-gray-400'}`}>
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
        <div className="relative h-5 bg-gray-800 rounded-full overflow-hidden">
            {/* Progress fill */}
            <div
                className="absolute h-full bg-linear-to-r from-green-600 to-green-500 rounded-l-full"
                style={{ width: `${currentPos}%` }}
            />

            {/* Retirement marker */}
            <div
                className="absolute top-0 h-full w-1 bg-amber-400"
                style={{ left: `${retirementPos}%` }}
                title={`Retirement: Age ${retirementAge}`}
            />

            {/* Current position marker */}
            <div
                className="absolute top-0 h-full w-3 bg-white rounded-full shadow-lg transform -translate-x-1/2"
                style={{ left: `${currentPos}%` }}
            />

            {/* Labels */}
            <div className="absolute -bottom-4 left-0 text-xs text-gray-400">0</div>
            <div
                className="absolute -bottom-4 text-xs text-gray-400 transform -translate-x-1/2"
                style={{ left: `${currentPos}%` }}
            >
                {currentAge}
            </div>
            <div
                className="absolute -bottom-4 text-xs text-amber-400 transform -translate-x-1/2"
                style={{ left: `${retirementPos}%` }}
            >
                {retirementAge}
            </div>
            <div className="absolute -bottom-4 right-0 text-xs text-gray-400">{lifeExpectancy}</div>
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
        const currentYear = new Date().getFullYear();
        const startAge = currentYear - getBirthYear(assumptions.milestones);
        return runSimulationWithOptimization(
            getLifeExpectancy(assumptions.milestones) - startAge,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );
    }, [assumptions, accounts, incomes, expenses, taxState]);

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

    if (simulation.length === 0) {
        return (
            <div className="p-4 text-white bg-gray-950 text-center">
                <div className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="md" />
                    <p>Running simulation...</p>
                </div>
            </div>
        );
    }

    // Filter out end-of-year projection points for tabs that don't need them
    const simulationWithoutEOY = useMemo(() =>
        simulation.filter(y => !y.isEndOfYearProjection),
        [simulation]
    );

    // Tab content with CSS visibility to avoid unmounting charts
    // This keeps Nivo charts mounted, preventing expensive re-initialization
    const renderTabContent = () => (
        <>
            <div className={activeTab === 'Overview' ? '' : 'hidden'}>
                <OverviewTab simulationData={simulation} />
            </div>
            <div className={activeTab === 'Cashflow' ? '' : 'hidden'}>
                <CashflowTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Assets' ? '' : 'hidden'}>
                <AssetsTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Debt' ? '' : 'hidden'}>
                <DebtTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Monte Carlo' ? '' : 'hidden'}>
                <MonteCarloTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Tax' ? '' : 'hidden'}>
                <TaxOptimizationTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Scenarios' ? '' : 'hidden'}>
                <ScenarioComparisonTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Ratios' ? '' : 'hidden'}>
                <FinancialRatiosTab simulationData={simulationWithoutEOY} />
            </div>
            <div className={activeTab === 'Data' ? '' : 'hidden'}>
                <DataTab simulationData={simulationWithoutEOY} birthYear={getBirthYear(assumptions.milestones)} />
            </div>
        </>
    );

    return (
        <div className="w-full flex bg-gray-950 justify-center pt-6 pb-24">
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
                <div className="mb-4 p-3 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-base font-bold text-white">Retirement Timeline</h2>
                        {isLoading ? (
                            <span className="px-2 py-1 text-xs bg-blue-600 text-white rounded-full flex items-center gap-1">
                                <LoadingSpinner size="sm" /> Updating...
                            </span>
                        ) : (
                            <button
                                onClick={handleRecalculate}
                                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full transition-colors"
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
                </div>

                {/* Tab System */}
                <div className="bg-gray-900 rounded-lg mb-1 flex border border-gray-800 overflow-x-auto custom-scrollbar">
                    {visible_tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${activeTab === tab
                                ? "text-green-300 bg-gray-800 border-b-2 border-green-300"
                                : "text-gray-400 hover:bg-gray-800 hover:text-white"
                                }`}
                            onClick={() => handleTabChange(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Main Content */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl mb-4 p-6 overflow-visible relative">
                    {isLoading && <LoadingOverlay message="Running simulation..." />}
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
}