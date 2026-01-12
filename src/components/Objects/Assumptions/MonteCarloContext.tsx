import { createContext, useReducer, useContext, ReactNode, useMemo, useCallback } from 'react';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';
import {
    MonteCarloConfig,
    MonteCarloState,
    MonteCarloAction,
    defaultMonteCarloConfig,
    initialMonteCarloState,
} from '../../../services/MonteCarloTypes';
import { runMonteCarloSimulation } from '../../../services/MonteCarloEngine';
import { createRandomSeed } from '../../../services/RandomGenerator';
import { AnyAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { AssumptionsState } from './AssumptionsContext';
import { TaxState } from '../Taxes/TaxContext';

/**
 * Reducer for Monte Carlo state management
 */
const monteCarloReducer = (state: MonteCarloState, action: MonteCarloAction): MonteCarloState => {
    switch (action.type) {
        case 'UPDATE_CONFIG':
            return {
                ...state,
                config: { ...state.config, ...action.payload },
            };
        case 'START_SIMULATION':
            return {
                ...state,
                isRunning: true,
                progress: 0,
                error: null,
            };
        case 'UPDATE_PROGRESS':
            return {
                ...state,
                progress: action.payload,
            };
        case 'COMPLETE_SIMULATION':
            return {
                ...state,
                isRunning: false,
                progress: 100,
                summary: action.payload,
                error: null,
            };
        case 'SIMULATION_ERROR':
            return {
                ...state,
                isRunning: false,
                progress: 0,
                error: action.payload,
            };
        case 'RESET':
            return {
                ...initialMonteCarloState,
                config: state.config, // Keep the config
            };
        default:
            return state;
    }
};

/**
 * Context value interface
 */
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

/**
 * Create context with default values
 */
export const MonteCarloContext = createContext<MonteCarloContextProps>({
    state: initialMonteCarloState,
    dispatch: () => null,
    runSimulation: async () => {},
    updateConfig: () => {},
    resetResults: () => {},
    generateNewSeed: () => {},
});

/**
 * Provider component for Monte Carlo state
 */
export const MonteCarloProvider = ({ children }: { children: ReactNode }) => {
    // Initialize state from localStorage if available
    const [state, dispatch] = useReducer(monteCarloReducer, initialMonteCarloState, (initial) => {
        const saved = localStorage.getItem('monte_carlo_config');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return {
                    ...initial,
                    config: { ...defaultMonteCarloConfig, ...parsed },
                };
            } catch (e) {
                console.error('Failed to parse Monte Carlo config', e);
            }
        }
        return initial;
    });

    // Debounced localStorage persistence for config only
    useDebouncedLocalStorage('monte_carlo_config', state.config);

    /**
     * Run the Monte Carlo simulation
     */
    const runSimulation = useCallback(async (
        accounts: AnyAccount[],
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        assumptions: AssumptionsState,
        taxState: TaxState
    ) => {
        dispatch({ type: 'START_SIMULATION' });

        try {
            const summary = await runMonteCarloSimulation(
                state.config,
                accounts,
                incomes,
                expenses,
                assumptions,
                taxState,
                (progress) => dispatch({ type: 'UPDATE_PROGRESS', payload: progress })
            );

            dispatch({ type: 'COMPLETE_SIMULATION', payload: summary });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Simulation failed';
            dispatch({ type: 'SIMULATION_ERROR', payload: message });
        }
    }, [state.config]);

    /**
     * Update configuration
     */
    const updateConfig = useCallback((config: Partial<MonteCarloConfig>) => {
        dispatch({ type: 'UPDATE_CONFIG', payload: config });
    }, []);

    /**
     * Reset results (keep config)
     */
    const resetResults = useCallback(() => {
        dispatch({ type: 'RESET' });
    }, []);

    /**
     * Generate a new random seed
     */
    const generateNewSeed = useCallback(() => {
        dispatch({ type: 'UPDATE_CONFIG', payload: { seed: createRandomSeed() } });
    }, []);

    // Memoize context value to prevent unnecessary re-renders
    const contextValue = useMemo(() => ({
        state,
        dispatch,
        runSimulation,
        updateConfig,
        resetResults,
        generateNewSeed,
    }), [state, runSimulation, updateConfig, resetResults, generateNewSeed]);

    return (
        <MonteCarloContext.Provider value={contextValue}>
            {children}
        </MonteCarloContext.Provider>
    );
};

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
        error: state.error,
        resetResults,
    };
};
