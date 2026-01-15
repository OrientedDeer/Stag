import React, { useState, useContext, useRef } from 'react';
import { useScenarios } from './ScenarioContext';
import { ScenarioCard } from './ScenarioCard';
import { AccountContext } from '../Accounts/AccountContext';
import { IncomeContext } from '../Income/IncomeContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../Taxes/TaxContext';
import { useAssumptions } from '../Assumptions/AssumptionsContext';
import { AlertBanner } from '../../Layout/AlertBanner';

/**
 * Manager component for listing, saving, and importing scenarios
 */
export const ScenarioManager: React.FC = () => {
    const {
        state,
        saveCurrentAsScenario,
        deleteScenario,
        renameScenario,
        updateScenarioAssumptions,
        exportScenario,
        importScenario,
        selectBaseline,
        selectComparison
    } = useScenarios();

    const { accounts, amountHistory } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { assumptions } = useAssumptions();

    const [showSaveForm, setShowSaveForm] = useState(false);
    const [scenarioName, setScenarioName] = useState('');
    const [scenarioDescription, setScenarioDescription] = useState('');
    const [saveError, setSaveError] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        if (!scenarioName.trim()) {
            setSaveError('Please enter a name for the scenario');
            return;
        }

        saveCurrentAsScenario(
            scenarioName.trim(),
            scenarioDescription.trim() || undefined,
            accounts,
            amountHistory,
            incomes,
            expenses,
            taxState,
            assumptions
        );

        // Reset form
        setScenarioName('');
        setScenarioDescription('');
        setShowSaveForm(false);
        setSaveError(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await importScenario(file);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleSelectBaseline = (id: string) => {
        if (state.selectedBaseline === id) {
            selectBaseline(null);
        } else {
            selectBaseline(id);
        }
    };

    const handleSelectComparison = (id: string) => {
        if (state.selectedComparison === id) {
            selectComparison(null);
        } else {
            selectComparison(id);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Header with actions */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-white font-semibold">Saved Scenarios</h3>
                    <p className="text-sm text-gray-400">
                        Save your current plan to compare different financial strategies
                    </p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setShowSaveForm(true)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Save Current
                    </button>
                    <button
                        onClick={handleImportClick}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Import
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                </div>
            </div>

            {/* Error display */}
            {state.error && (
                <AlertBanner severity="error" size="sm">
                    {state.error}
                </AlertBanner>
            )}

            {/* Save form */}
            {showSaveForm && (
                <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4">
                    <h4 className="text-white font-medium mb-3">Save Current Plan as Scenario</h4>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">
                                Scenario Name *
                            </label>
                            <input
                                type="text"
                                value={scenarioName}
                                onChange={(e) => {
                                    setScenarioName(e.target.value);
                                    setSaveError(null);
                                }}
                                placeholder="e.g., Retire at 55, Max 401k"
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">
                                Description (optional)
                            </label>
                            <textarea
                                value={scenarioDescription}
                                onChange={(e) => setScenarioDescription(e.target.value)}
                                placeholder="Brief description of this scenario..."
                                rows={2}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none resize-none"
                            />
                        </div>

                        {saveError && (
                            <p className="text-red-400 text-sm">{saveError}</p>
                        )}

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => {
                                    setShowSaveForm(false);
                                    setScenarioName('');
                                    setScenarioDescription('');
                                    setSaveError(null);
                                }}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                Save Scenario
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Scenarios list */}
            {state.scenarios.length === 0 ? (
                <div className="bg-gray-800/30 rounded-xl border border-gray-700 border-dashed p-8 text-center">
                    <div className="text-gray-400 mb-2">No saved scenarios yet</div>
                    <p className="text-sm text-gray-400">
                        Save your current plan to create your first scenario for comparison
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.scenarios.map(scenario => (
                        <ScenarioCard
                            key={scenario.metadata.id}
                            scenario={scenario}
                            isBaseline={state.selectedBaseline === scenario.metadata.id}
                            isComparison={state.selectedComparison === scenario.metadata.id}
                            onSelectBaseline={() => handleSelectBaseline(scenario.metadata.id)}
                            onSelectComparison={() => handleSelectComparison(scenario.metadata.id)}
                            onDelete={() => deleteScenario(scenario.metadata.id)}
                            onExport={() => exportScenario(scenario.metadata.id)}
                            onRename={(newName) => renameScenario(scenario.metadata.id, newName)}
                            onUpdateAssumptions={(assumptions) => updateScenarioAssumptions(scenario.metadata.id, assumptions)}
                        />
                    ))}
                </div>
            )}

            {/* Current selection summary */}
            {(state.selectedBaseline || state.selectedComparison) && (
                <div className="bg-gray-800/30 rounded-xl border border-gray-700 p-4">
                    <div className="flex flex-wrap gap-4 items-center text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">Baseline:</span>
                            {state.selectedBaseline ? (
                                <span className="text-blue-400 font-medium">
                                    {state.scenarios.find(s => s.metadata.id === state.selectedBaseline)?.metadata.name || 'Unknown'}
                                </span>
                            ) : (
                                <span className="text-gray-400 italic">Not selected</span>
                            )}
                        </div>
                        <div className="text-gray-400">vs</div>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">Compare:</span>
                            {state.selectedComparison ? (
                                <span className="text-orange-400 font-medium">
                                    {state.scenarios.find(s => s.metadata.id === state.selectedComparison)?.metadata.name || 'Unknown'}
                                </span>
                            ) : (
                                <span className="text-gray-400 italic">Not selected</span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScenarioManager;
