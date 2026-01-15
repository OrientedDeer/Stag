import React, { useState, useContext, useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { useAssumptions } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext } from '../../../components/Objects/Taxes/TaxContext';
import { useScenarios, useScenarioComparison } from '../../../components/Objects/Scenarios/ScenarioContext';
import { ScenarioManager } from '../../../components/Objects/Scenarios/ScenarioManager';
import { SideBySideView } from './SideBySideView';
import { OverlaidChartView } from './OverlaidChartView';
import { DifferenceSummary } from './DifferenceSummary';
import { LoadingSpinner } from '../../../components/Layout/LoadingSpinner';

type ComparisonView = 'side-by-side' | 'overlaid' | 'differences';

interface ScenarioComparisonTabProps {
    simulationData: SimulationYear[];
}

/**
 * Main Scenario Comparison Tab component
 */
export const ScenarioComparisonTab: React.FC<ScenarioComparisonTabProps> = ({ simulationData }) => {
    const { assumptions } = useAssumptions();
    const { state: taxState } = useContext(TaxContext);
    const { state } = useScenarios();
    const {
        selectedBaseline,
        selectedComparison,
        comparisonResult,
        isLoading,
        error,
        runComparison,
        clearComparison
    } = useScenarioComparison();

    const [activeView, setActiveView] = useState<ComparisonView>('side-by-side');

    // Check if we can run a comparison
    const canCompare = useMemo(() => {
        // Need either two different scenarios selected, or one scenario + current
        if (selectedBaseline && selectedComparison) {
            return selectedBaseline !== selectedComparison;
        }
        // Can also compare one scenario against current
        return selectedBaseline !== null || selectedComparison !== null;
    }, [selectedBaseline, selectedComparison]);

    const handleRunComparison = async () => {
        const baseline = selectedBaseline || 'current';
        const comparison = selectedComparison || 'current';

        if (baseline === comparison) {
            return;
        }

        await runComparison(
            baseline,
            comparison,
            simulationData,
            assumptions,
            taxState
        );
    };

    // Get scenario names for display
    const getScenarioName = (id: string | null) => {
        if (id === null || id === 'current') return 'Current Plan';
        const scenario = state.scenarios.find(s => s.metadata.id === id);
        return scenario?.metadata.name || 'Unknown';
    };

    return (
        <div className="flex flex-col gap-6 p-4">
            {/* Scenario Manager */}
            <ScenarioManager />

            {/* Comparison Controls */}
            {state.scenarios.length > 0 && (
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                    <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-white font-semibold">Compare Scenarios</h3>
                            <p className="text-sm text-gray-400">
                                {!selectedBaseline && !selectedComparison
                                    ? 'Select a baseline and comparison scenario above'
                                    : `Comparing: ${getScenarioName(selectedBaseline)} vs ${getScenarioName(selectedComparison || 'current')}`
                                }
                            </p>
                        </div>

                        <div className="flex gap-2">
                            {comparisonResult && (
                                <button
                                    onClick={clearComparison}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                            <button
                                onClick={handleRunComparison}
                                disabled={!canCompare || isLoading}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                                    canCompare && !isLoading
                                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                        : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                }`}
                            >
                                {isLoading && <LoadingSpinner size="sm" />}
                                {isLoading ? 'Comparing...' : 'Run Comparison'}
                            </button>
                        </div>
                    </div>

                    {/* Error display */}
                    {error && (
                        <div className="mt-3 bg-red-900/20 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
                            {error}
                        </div>
                    )}
                </div>
            )}

            {/* Comparison Results */}
            {comparisonResult && (
                <>
                    {/* View Toggle */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setActiveView('side-by-side')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                activeView === 'side-by-side'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            Side by Side
                        </button>
                        <button
                            onClick={() => setActiveView('overlaid')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                activeView === 'overlaid'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            Overlaid Chart
                        </button>
                        <button
                            onClick={() => setActiveView('differences')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                activeView === 'differences'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                        >
                            Key Differences
                        </button>
                    </div>

                    {/* View Content */}
                    <div className={activeView === 'side-by-side' ? '' : 'hidden'}>
                        <SideBySideView comparison={comparisonResult} />
                    </div>
                    <div className={activeView === 'overlaid' ? '' : 'hidden'}>
                        <OverlaidChartView comparison={comparisonResult} />
                    </div>
                    <div className={activeView === 'differences' ? '' : 'hidden'}>
                        <DifferenceSummary comparison={comparisonResult} />
                    </div>
                </>
            )}

            {/* Empty state when no comparison */}
            {!comparisonResult && state.scenarios.length > 0 && (
                <div className="bg-gray-800/30 rounded-xl border border-gray-700 border-dashed p-8 text-center">
                    <div className="text-gray-400 mb-2">No comparison results yet</div>
                    <p className="text-sm text-gray-400">
                        Select scenarios and click "Run Comparison" to see how different plans compare
                    </p>
                </div>
            )}
        </div>
    );
};

export default ScenarioComparisonTab;
