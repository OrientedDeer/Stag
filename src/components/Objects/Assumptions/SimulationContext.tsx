import { createContext, useReducer, ReactNode, Dispatch, useMemo, useCallback } from 'react';
import { SimulationYear } from './SimulationEngine';
import { AnyAccount, reconstituteAccount } from '../Accounts/models';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';

// This is a simplified reconstitution. You might need to make this more robust
// based on the actual structure of your simulation data.
const reconstituteSimulationYear = (yearData: any): SimulationYear => {
    return {
        ...yearData,
        accounts: yearData.accounts.map(reconstituteAccount).filter(Boolean) as AnyAccount[],
        incomes: yearData.incomes.map(reconstituteIncome).filter(Boolean) as AnyIncome[],
        expenses: yearData.expenses.map(reconstituteExpense).filter(Boolean) as AnyExpense[],
    };
};


const STORAGE_KEY = 'user_simulation_data';

interface SimulationState {
    simulation: SimulationYear[];
    inputHash: string | null;  // Hash of inputs used for current simulation (for staleness detection)
}

type Action =
    | { type: 'SET_SIMULATION'; payload: SimulationYear[] }
    | { type: 'SET_SIMULATION_WITH_HASH'; payload: { simulation: SimulationYear[]; inputHash: string } };

const initialState: SimulationState = {
    simulation: [],
    inputHash: null,
};

const initializer = (initialState: SimulationState): SimulationState => {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (savedState) {
            const parsed = JSON.parse(savedState);
            const simulation = (parsed.simulation || []).map(reconstituteSimulationYear);
            const inputHash = parsed.inputHash || null;
            return { simulation, inputHash };
        }
    } catch (e) {
        console.error("Could not load simulation state:", e);
    }
    return initialState;
};

const simulationReducer = (state: SimulationState, action: Action): SimulationState => {
    switch (action.type) {
        case 'SET_SIMULATION':
            return { ...state, simulation: action.payload };
        case 'SET_SIMULATION_WITH_HASH':
            return {
                ...state,
                simulation: action.payload.simulation,
                inputHash: action.payload.inputHash
            };
        default:
            return state;
    }
};

interface SimulationContextProps extends SimulationState {
    dispatch: Dispatch<Action>;
}

export const SimulationContext = createContext<SimulationContextProps>({
    ...initialState,
    dispatch: () => null,
});

export const SimulationProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(simulationReducer, initialState, initializer);

    // Debounced localStorage persistence (500ms delay to prevent main thread blocking)
    const serializeState = useCallback((s: SimulationState) => {
        const serializable = {
            ...s,
            simulation: s.simulation.map(year => ({
                ...year,
                accounts: year.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
                incomes: year.incomes.map(inc => ({ ...inc, className: inc.constructor.name })),
                expenses: year.expenses.map(exp => ({ ...exp, className: exp.constructor.name })),
            }))
        };
        return JSON.stringify(serializable);
    }, []);

    useDebouncedLocalStorage(STORAGE_KEY, state, serializeState);

    // Memoize context value to prevent unnecessary re-renders
    const contextValue = useMemo(() => ({
        ...state,
        dispatch
    }), [state, dispatch]);

    return (
        <SimulationContext.Provider value={contextValue}>
            {children}
        </SimulationContext.Provider>
    );
};
