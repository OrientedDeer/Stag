/* @refresh reset */
import { useReducer, type ReactNode, useMemo, useCallback } from 'react';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';
import {
    type MonteCarloConfig,
    type MonteCarloState,
    type MonteCarloAction,
    type MonteCarloSummary,
    defaultMonteCarloConfig,
    initialMonteCarloState,
} from '../../../services/MonteCarloTypes';
import { runMonteCarloSimulation } from '../../../services/MonteCarloEngine';
import { runMonteCarloInWorker } from '../../../services/montecarloRunner';
import { createRandomSeed } from '../../../services/RandomGenerator';
import { type AnyAccount } from '../Accounts/models';
import { type AnyIncome } from '../Income/models';
import { type AnyExpense } from '../Expense/models';
import { type AssumptionsState } from './AssumptionsContext';
import { type TaxState } from '../Taxes/TaxContext';
import { MonteCarloContext } from './MonteCarloContext';

function monteCarloReducer(state: MonteCarloState, action: MonteCarloAction): MonteCarloState {
    switch (action.type) {
        case 'UPDATE_CONFIG':
            return { ...state, config: { ...state.config, ...action.payload } };
        case 'START_SIMULATION':
            return { ...state, isRunning: true, progress: 0, phase: 'solving', error: null };
        case 'UPDATE_PROGRESS':
            return { ...state, progress: action.payload };
        case 'SET_PHASE':
            return { ...state, phase: action.payload };
        case 'COMPLETE_SIMULATION':
            return { ...state, isRunning: false, progress: 100, phase: 'idle', summary: action.payload, error: null };
        case 'SIMULATION_ERROR':
            return { ...state, isRunning: false, progress: 0, phase: 'idle', error: action.payload };
        case 'RESET':
            return { ...initialMonteCarloState, config: state.config };
        default:
            return state;
    }
}

function loadMonteCarloConfig(initial: MonteCarloState): MonteCarloState {
    try {
        const saved = localStorage.getItem('monte_carlo_config');
        if (saved) {
            const parsed = JSON.parse(saved);
            return { ...initial, config: { ...defaultMonteCarloConfig, ...parsed } };
        }
    } catch {
        // Fall through to return initial
    }
    return initial;
}

export function MonteCarloProvider({ children }: { children: ReactNode }): React.ReactElement {
    const [state, dispatch] = useReducer(monteCarloReducer, initialMonteCarloState, loadMonteCarloConfig);

    // Persist config only (not transient simulation state)
    useDebouncedLocalStorage('monte_carlo_config', state.config);

    const runSimulation = useCallback(async (
        accounts: AnyAccount[],
        incomes: AnyIncome[],
        expenses: AnyExpense[],
        assumptions: AssumptionsState,
        taxState: TaxState
    ) => {
        dispatch({ type: 'START_SIMULATION' });
        const onProgress = (progress: number) => dispatch({ type: 'UPDATE_PROGRESS', payload: progress });
        const onPhase = (phase: 'solving' | 'running') => dispatch({ type: 'SET_PHASE', payload: phase });
        try {
            // Run off the main thread (#98) so the ~20s policy solve + path loop
            // don't freeze the UI. Fall back to the main-thread engine if the
            // worker can't be constructed or it errors, so MC always works.
            let summary: MonteCarloSummary;
            try {
                summary = await runMonteCarloInWorker(
                    state.config, accounts, incomes, expenses, assumptions, taxState, onProgress, onPhase,
                );
            } catch (workerErr) {
                // A permanently-broken worker is otherwise invisible (we silently
                // run on the main thread); surface it in dev so it's diagnosable.
                if (import.meta.env.DEV) {
                    console.warn('Monte Carlo worker unavailable; running on the main thread instead:', workerErr);
                }
                // Main-thread fallback blocks the UI, so the phase label can't
                // animate; mark 'running' for correctness.
                dispatch({ type: 'SET_PHASE', payload: 'running' });
                summary = await runMonteCarloSimulation(
                    state.config, accounts, incomes, expenses, assumptions, taxState, onProgress,
                );
            }
            dispatch({ type: 'COMPLETE_SIMULATION', payload: summary });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Simulation failed';
            dispatch({ type: 'SIMULATION_ERROR', payload: message });
        }
    }, [state.config]);

    const updateConfig = useCallback((config: Partial<MonteCarloConfig>) => {
        dispatch({ type: 'UPDATE_CONFIG', payload: config });
    }, []);

    const resetResults = useCallback(() => {
        dispatch({ type: 'RESET' });
    }, []);

    const generateNewSeed = useCallback(() => {
        dispatch({ type: 'UPDATE_CONFIG', payload: { seed: createRandomSeed() } });
    }, []);

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
}
