import { createContext, useContext } from 'react';
import {
    MonteCarloConfig,
    MonteCarloState,
    MonteCarloAction,
    initialMonteCarloState,
} from '../../../services/MonteCarloTypes';
import { AnyAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { AssumptionsState } from './AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';

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
}

export const MonteCarloContext = createContext<MonteCarloContextProps>({
    state: initialMonteCarloState,
    dispatch: () => null,
    runSimulation: async () => {},
    updateConfig: () => {},
    resetResults: () => {},
    generateNewSeed: () => {},
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
