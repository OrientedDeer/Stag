import { createContext, useContext } from 'react';
import {
    type ScenarioState,
    type ScenarioAction,
} from '../../../services/ScenarioTypes';
import { type SimulationYear } from '../Assumptions/SimulationEngine';
import { type AnyAccount } from '../Accounts/models';
import { type AnyIncome } from '../Income/models';
import { type AnyExpense } from '../Expense/models';
import { type AssumptionsState } from '../Assumptions/AssumptionsContext';
import { type TaxState } from '../Taxes/TaxContext';
import { type AmountHistoryEntry } from '../Accounts/AccountContext';

// ============================================================================
// Initial State
// ============================================================================

export const initialScenarioState: ScenarioState = {
    scenarios: [],
    selectedBaseline: null,
    selectedComparison: null,
    comparisonResult: null,
    isLoading: false,
    error: null
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
    updateScenarioAssumptions: (id: string, assumptions: Partial<AssumptionsState>) => void;
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
