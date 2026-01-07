
import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { SimulationYear } from './SimulationEngine';
import { AnyAccount } from '../Accounts/models';
import { reconstituteAccount } from '../Accounts/models';
import { AnyIncome } from '../Income/models';
import { reconstituteIncome } from '../Income/models';
import { AnyExpense } from '../Expense/models';
import { reconstituteExpense } from '../Expense/models';

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
}

type Action = { type: 'SET_SIMULATION'; payload: SimulationYear[] };

const initialState: SimulationState = {
    simulation: [],
};

const initializer = (initialState: SimulationState): SimulationState => {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (savedState) {
            const parsed = JSON.parse(savedState);
            const simulation = (parsed.simulation || []).map(reconstituteSimulationYear);
            return { simulation };
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

    useEffect(() => {
        // To save to local storage, we need to add the className to each object
        const serializable = {
            ...state,
            simulation: state.simulation.map(year => ({
                ...year,
                accounts: year.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
                incomes: year.incomes.map(inc => ({ ...inc, className: inc.constructor.name })),
                expenses: year.expenses.map(exp => ({ ...exp, className: exp.constructor.name })),
            }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    }, [state]);

    return (
        <SimulationContext.Provider value={{ ...state, dispatch }}>
            {children}
        </SimulationContext.Provider>
    );
};
