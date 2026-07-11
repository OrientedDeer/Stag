import { createContext, useContext } from 'react';
import {
    type MonteCarloConfig,
    type MonteCarloState,
    type MonteCarloAction,
    initialMonteCarloState,
} from '../../../services/MonteCarloTypes';
import { type AnyAccount } from '../Accounts/models';
import { type AnyIncome } from '../Income/models';
import { type AnyExpense } from '../Expense/models';
import { type AssumptionsState } from './AssumptionsContext';
import { type TaxState } from '../Taxes/TaxContext';

interface MonteCarloContextProps {
    state: MonteCarloState;
    dispatch: React.Dispatch<MonteCarloAction>;
    runSimulation: (
        accounts: AnyAccount[],
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        assumptions: AssumptionsState,
        taxState: TaxState
    ) => Promise<void>;
    updateConfig: (config: Partial<MonteCarloConfig>) => void;
    resetResults: () => void;
    generateNewSeed: () => void;
    /**
     * Restore a persisted summary after a page refresh (#204). Resolves true
     * when a matching cached summary was restored, false on miss / already-has-
     * results / in-flight run / any failure.
     */
    tryRestoreSummary: (
        accounts: AnyAccount[],
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        assumptions: AssumptionsState,
        taxState: TaxState
    ) => Promise<boolean>;
}

export const MonteCarloContext = createContext<MonteCarloContextProps>({
    state: initialMonteCarloState,
    dispatch: () => null,
    runSimulation: async () => {},
    updateConfig: () => {},
    resetResults: () => {},
    generateNewSeed: () => {},
    tryRestoreSummary: async () => false,
});

/**
 * Custom hook to access Monte Carlo state and actions
 */
export const useMonteCarlo = () => {
    const context = useContext(MonteCarloContext);
    if (!context) {
        throw new Error('useMonteCarlo must be used within a MonteCarloProvider');
    }
    return context;
};

/**
 * Selector hooks for specific pieces of state
 */
export const useMonteCarloConfig = () => {
    const { state, updateConfig, generateNewSeed } = useMonteCarlo();
    return { config: state.config, updateConfig, generateNewSeed };
};

export const useMonteCarloResults = () => {
    const { state, resetResults } = useMonteCarlo();
    return {
        summary: state.summary,
        isRunning: state.isRunning,
        progress: state.progress,
        phase: state.phase,
        error: state.error,
        resetResults,
    };
};
