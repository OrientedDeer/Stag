import { createContext, useReducer, useContext, ReactNode, useMemo, useCallback, useEffect } from 'react';
import {
    ScenarioState,
    ScenarioAction,
    SavedScenario,
    LoadedScenario
} from '../../../services/ScenarioTypes';
import {
    loadScenariosFromStorage,
    saveScenarioToStorage,
    deleteScenarioFromStorage,
    captureCurrentState,
    createScenario,
    exportScenarioToFile,
    importScenarioFromFile,
    calculateMilestones,
    compareScenarios,
    createLoadedScenarioFromSimulation
} from '../../../services/ScenarioService';
import { SimulationYear } from '../Assumptions/SimulationEngine';
import { runSimulation } from '../Assumptions/useSimulation';
import { AnyAccount, reconstituteAccount } from '../Accounts/models';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { AssumptionsState, defaultAssumptions } from '../Assumptions/AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';
import { AmountHistoryEntry } from '../Accounts/AccountContext';

// ============================================================================
// Initial State
// ============================================================================

const initialScenarioState: ScenarioState = {
    scenarios: [],
    selectedBaseline: null,
    selectedComparison: null,
    comparisonResult: null,
    isLoading: false,
    error: null
};

// ============================================================================
// Reducer
// ============================================================================

const scenarioReducer = (state: ScenarioState, action: ScenarioAction): ScenarioState => {
    switch (action.type) {
        case 'LOAD_SCENARIOS':
            return {
                ...state,
                scenarios: action.payload,
                error: null
            };

        case 'SAVE_SCENARIO':
            const existingIndex = state.scenarios.findIndex(
                s => s.metadata.id === action.payload.metadata.id
            );
            if (existingIndex >= 0) {
                const updated = [...state.scenarios];
                updated[existingIndex] = action.payload;
                return { ...state, scenarios: updated, error: null };
            }
            return {
                ...state,
                scenarios: [...state.scenarios, action.payload],
                error: null
            };

        case 'DELETE_SCENARIO':
            return {
                ...state,
                scenarios: state.scenarios.filter(s => s.metadata.id !== action.payload),
                selectedBaseline: state.selectedBaseline === action.payload ? null : state.selectedBaseline,
                selectedComparison: state.selectedComparison === action.payload ? null : state.selectedComparison,
                comparisonResult: state.comparisonResult &&
                    (state.comparisonResult.baseline.metadata.id === action.payload ||
                     state.comparisonResult.comparison.metadata.id === action.payload)
                    ? null
                    : state.comparisonResult,
                error: null
            };

        case 'UPDATE_SCENARIO':
            return {
                ...state,
                scenarios: state.scenarios.map(s =>
                    s.metadata.id === action.payload.metadata.id ? action.payload : s
                ),
                error: null
            };

        case 'IMPORT_SCENARIO':
            return {
                ...state,
                scenarios: [...state.scenarios, action.payload],
                error: null
            };

        case 'SELECT_BASELINE':
            return {
                ...state,
                selectedBaseline: action.payload,
                comparisonResult: null // Clear comparison when selection changes
            };

        case 'SELECT_COMPARISON':
            return {
                ...state,
                selectedComparison: action.payload,
                comparisonResult: null // Clear comparison when selection changes
            };

        case 'SET_COMPARISON_RESULT':
            return {
                ...state,
                comparisonResult: action.payload,
                isLoading: false
            };

        case 'SET_LOADING':
            return {
                ...state,
                isLoading: action.payload
            };

        case 'SET_ERROR':
            return {
                ...state,
                error: action.payload,
                isLoading: false
            };

        case 'CLEAR_COMPARISON':
            return {
                ...state,
                selectedBaseline: null,
                selectedComparison: null,
                comparisonResult: null
            };

        default:
            return state;
    }
};

// ============================================================================
// Context Interface
// ============================================================================

interface ScenarioContextProps {
    state: ScenarioState;
    dispatch: React.Dispatch<ScenarioAction>;
    // Actions
    saveCurrentAsScenario: (
        name: string,
        description: string | undefined,
        accounts: AnyAccount[],
        amountHistory: Record<string, AmountHistoryEntry[]>,
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        taxSettings: TaxState,
        assumptions: AssumptionsState,
        tags?: string[]
    ) => void;
    deleteScenario: (id: string) => void;
    renameScenario: (id: string, newName: string) => void;
    updateScenarioAssumptions: (id: string, assumptions: any) => void;
    exportScenario: (id: string) => void;
    importScenario: (file: File) => Promise<void>;
    selectBaseline: (id: string | null) => void;
    selectComparison: (id: string | null) => void;
    runComparison: (
        baselineId: string,
        comparisonId: string,
        currentSimulation: SimulationYear[],
        currentAssumptions: AssumptionsState,
        currentTaxState: TaxState
    ) => Promise<void>;
    clearComparison: () => void;
}

// ============================================================================
// Context
// ============================================================================

export const ScenarioContext = createContext<ScenarioContextProps>({
    state: initialScenarioState,
    dispatch: () => null,
    saveCurrentAsScenario: () => {},
    deleteScenario: () => {},
    renameScenario: () => {},
    updateScenarioAssumptions: () => {},
    exportScenario: () => {},
    importScenario: async () => {},
    selectBaseline: () => {},
    selectComparison: () => {},
    runComparison: async () => {},
    clearComparison: () => {}
});

// ============================================================================
// Provider
// ============================================================================

export const ScenarioProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(scenarioReducer, initialScenarioState);

    // Load scenarios from localStorage on mount
    useEffect(() => {
        const scenarios = loadScenariosFromStorage();
        dispatch({ type: 'LOAD_SCENARIOS', payload: scenarios });
    }, []);

    // Save to localStorage whenever scenarios change
    useEffect(() => {
        // Skip initial empty state
        if (state.scenarios.length > 0) {
            // This is handled by individual save/delete operations
        }
    }, [state.scenarios]);

    /**
     * Save current application state as a new scenario
     */
    const saveCurrentAsScenario = useCallback((
        name: string,
        description: string | undefined,
        accounts: AnyAccount[],
        amountHistory: Record<string, AmountHistoryEntry[]>,
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        taxSettings: TaxState,
        assumptions: AssumptionsState,
        tags?: string[]
    ) => {
        try {
            const inputs = captureCurrentState(
                accounts,
                amountHistory,
                incomes,
                expenses,
                taxSettings,
                assumptions
            );

            const scenario = createScenario(name, description, inputs, tags);

            // Save to localStorage
            saveScenarioToStorage(scenario);

            // Update state
            dispatch({ type: 'SAVE_SCENARIO', payload: scenario });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to save scenario';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, []);

    /**
     * Delete a scenario
     */
    const deleteScenario = useCallback((id: string) => {
        try {
            deleteScenarioFromStorage(id);
            dispatch({ type: 'DELETE_SCENARIO', payload: id });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to delete scenario';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, []);

    /**
     * Rename a scenario
     */
    const renameScenario = useCallback((id: string, newName: string) => {
        try {
            const scenario = state.scenarios.find(s => s.metadata.id === id);
            if (!scenario) {
                throw new Error('Scenario not found');
            }

            const updatedScenario: SavedScenario = {
                ...scenario,
                metadata: {
                    ...scenario.metadata,
                    name: newName.trim()
                }
            };

            // Save to localStorage (this will overwrite the existing one)
            saveScenarioToStorage(updatedScenario);

            // Update state
            dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to rename scenario';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, [state.scenarios]);

    /**
     * Update a scenario's assumptions
     */
    const updateScenarioAssumptions = useCallback((id: string, assumptions: any) => {
        try {
            const scenario = state.scenarios.find(s => s.metadata.id === id);
            if (!scenario) {
                throw new Error('Scenario not found');
            }

            const updatedScenario: SavedScenario = {
                ...scenario,
                inputs: {
                    ...scenario.inputs,
                    assumptions: assumptions
                },
                metadata: {
                    ...scenario.metadata,
                    updatedAt: new Date().toISOString()
                }
            };

            // Save to localStorage
            saveScenarioToStorage(updatedScenario);

            // Update state
            dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });

            // Clear comparison if this scenario was being compared (assumptions changed)
            if (state.selectedBaseline === id || state.selectedComparison === id) {
                dispatch({ type: 'SET_COMPARISON_RESULT', payload: null });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to update scenario assumptions';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, [state.scenarios, state.selectedBaseline, state.selectedComparison]);

    /**
     * Export a scenario to file
     */
    const exportScenario = useCallback((id: string) => {
        const scenario = state.scenarios.find(s => s.metadata.id === id);
        if (scenario) {
            exportScenarioToFile(scenario);
        }
    }, [state.scenarios]);

    /**
     * Import a scenario from file
     */
    const importScenario = useCallback(async (file: File) => {
        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            const scenario = await importScenarioFromFile(file);

            // Save to localStorage
            saveScenarioToStorage(scenario);

            // Update state
            dispatch({ type: 'IMPORT_SCENARIO', payload: scenario });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to import scenario';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, []);

    /**
     * Select baseline scenario
     */
    const selectBaseline = useCallback((id: string | null) => {
        dispatch({ type: 'SELECT_BASELINE', payload: id });
    }, []);

    /**
     * Select comparison scenario
     */
    const selectComparison = useCallback((id: string | null) => {
        dispatch({ type: 'SELECT_COMPARISON', payload: id });
    }, []);

    /**
     * Reconstitute a scenario's inputs and run simulation
     */
    const loadAndSimulateScenario = useCallback(async (
        scenario: SavedScenario,
        taxState: TaxState
    ): Promise<LoadedScenario> => {
        const inputs = scenario.inputs;

        // Reconstitute objects from JSON
        const accounts = inputs.accounts
            .map(reconstituteAccount)
            .filter(Boolean) as AnyAccount[];
        const incomes = inputs.incomes
            .map(reconstituteIncome)
            .filter(Boolean) as AnyIncome[];
        const expenses = inputs.expenses
            .map(reconstituteExpense)
            .filter(Boolean) as AnyExpense[];

        // Merge assumptions with defaults
        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            ...inputs.assumptions,
            macro: { ...defaultAssumptions.macro, ...(inputs.assumptions?.macro || {}) },
            income: { ...defaultAssumptions.income, ...(inputs.assumptions?.income || {}) },
            expenses: { ...defaultAssumptions.expenses, ...(inputs.assumptions?.expenses || {}) },
            investments: {
                ...defaultAssumptions.investments,
                ...(inputs.assumptions?.investments || {}),
                returnRates: {
                    ...defaultAssumptions.investments.returnRates,
                    ...((inputs.assumptions?.investments && inputs.assumptions.investments.returnRates) || {}),
                },
            },
            demographics: { ...defaultAssumptions.demographics, ...(inputs.assumptions?.demographics || {}) },
            priorities: inputs.assumptions?.priorities || defaultAssumptions.priorities
        };

        // Run simulation (use 50 years to ensure full lifetime coverage)
        const yearsToRun = 50;
        const simulation = runSimulation(
            yearsToRun,
            accounts,
            incomes,
            expenses,
            assumptions,
            inputs.taxSettings || taxState
        );

        // Calculate milestones
        const milestones = calculateMilestones(simulation, assumptions);

        return {
            metadata: scenario.metadata,
            simulation,
            milestones
        };
    }, []);

    /**
     * Run comparison between two scenarios
     */
    const runComparison = useCallback(async (
        baselineId: string,
        comparisonId: string,
        currentSimulation: SimulationYear[],
        currentAssumptions: AssumptionsState,
        currentTaxState: TaxState
    ) => {
        dispatch({ type: 'SET_LOADING', payload: true });

        try {
            let baseline: LoadedScenario;
            let comparison: LoadedScenario;

            // Handle "current" as a special case
            if (baselineId === 'current') {
                baseline = createLoadedScenarioFromSimulation(
                    'Current Plan',
                    currentSimulation,
                    currentAssumptions
                );
            } else {
                const baselineScenario = state.scenarios.find(s => s.metadata.id === baselineId);
                if (!baselineScenario) {
                    throw new Error('Baseline scenario not found');
                }
                baseline = await loadAndSimulateScenario(baselineScenario, currentTaxState);
            }

            if (comparisonId === 'current') {
                comparison = createLoadedScenarioFromSimulation(
                    'Current Plan',
                    currentSimulation,
                    currentAssumptions
                );
            } else {
                const comparisonScenario = state.scenarios.find(s => s.metadata.id === comparisonId);
                if (!comparisonScenario) {
                    throw new Error('Comparison scenario not found');
                }
                comparison = await loadAndSimulateScenario(comparisonScenario, currentTaxState);
            }

            // Calculate comparison
            const result = compareScenarios(baseline, comparison);
            dispatch({ type: 'SET_COMPARISON_RESULT', payload: result });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to run comparison';
            dispatch({ type: 'SET_ERROR', payload: message });
        }
    }, [state.scenarios, loadAndSimulateScenario]);

    /**
     * Clear comparison state
     */
    const clearComparison = useCallback(() => {
        dispatch({ type: 'CLEAR_COMPARISON' });
    }, []);

    // Memoize context value
    const contextValue = useMemo(() => ({
        state,
        dispatch,
        saveCurrentAsScenario,
        deleteScenario,
        renameScenario,
        updateScenarioAssumptions,
        exportScenario,
        importScenario,
        selectBaseline,
        selectComparison,
        runComparison,
        clearComparison
    }), [
        state,
        saveCurrentAsScenario,
        deleteScenario,
        renameScenario,
        updateScenarioAssumptions,
        exportScenario,
        importScenario,
        selectBaseline,
        selectComparison,
        runComparison,
        clearComparison
    ]);

    return (
        <ScenarioContext.Provider value={contextValue}>
            {children}
        </ScenarioContext.Provider>
    );
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Custom hook to access scenario state and actions
 */
export const useScenarios = () => {
    const context = useContext(ScenarioContext);
    if (!context) {
        throw new Error('useScenarios must be used within a ScenarioProvider');
    }
    return context;
};

/**
 * Hook to get just the scenarios list
 */
export const useScenariosList = () => {
    const { state } = useScenarios();
    return state.scenarios;
};

/**
 * Hook to get comparison state
 */
export const useScenarioComparison = () => {
    const { state, selectBaseline, selectComparison, runComparison, clearComparison } = useScenarios();
    return {
        selectedBaseline: state.selectedBaseline,
        selectedComparison: state.selectedComparison,
        comparisonResult: state.comparisonResult,
        isLoading: state.isLoading,
        error: state.error,
        selectBaseline,
        selectComparison,
        runComparison,
        clearComparison
    };
};
