import { createContext, ReactNode, Dispatch, useMemo } from 'react';
import { SimulationYear } from './SimulationEngine';
import { AnyAccount, reconstituteAccount } from '../Accounts/models';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';

const STORAGE_KEY = 'user_simulation_data';

interface SimulationState {
  simulation: SimulationYear[];
  inputHash: string | null;
}

type Action =
  | { type: 'SET_SIMULATION'; payload: SimulationYear[] }
  | { type: 'SET_SIMULATION_WITH_HASH'; payload: { simulation: SimulationYear[]; inputHash: string } };

const initialState: SimulationState = {
  simulation: [],
  inputHash: null,
};

function simulationReducer(state: SimulationState, action: Action): SimulationState {
  switch (action.type) {
    case 'SET_SIMULATION':
      return { ...state, simulation: action.payload };
    case 'SET_SIMULATION_WITH_HASH':
      return {
        ...state,
        simulation: action.payload.simulation,
        inputHash: action.payload.inputHash,
      };
    default:
      return state;
  }
}

function reconstituteSimulationYear(yearData: unknown): SimulationYear {
  const data = yearData as {
    accounts?: unknown[];
    incomes?: unknown[];
    expenses?: unknown[];
    [key: string]: unknown;
  };
  return {
    ...data,
    accounts: (data.accounts || []).map(reconstituteAccount).filter(Boolean) as AnyAccount[],
    incomes: (data.incomes || []).map(reconstituteIncome).filter(Boolean) as AnyIncome[],
    expenses: (data.expenses || []).map(reconstituteExpense).filter(Boolean) as AnyExpense[],
  } as SimulationYear;
}

function hydrateSimulationState(parsed: unknown, initial: SimulationState): SimulationState {
  const data = parsed as { simulation?: unknown[]; inputHash?: string | null };
  const simulation = (data.simulation || []).map(reconstituteSimulationYear);
  return { ...initial, simulation, inputHash: data.inputHash || null };
}

function serializeSimulationState(state: SimulationState): string {
  return JSON.stringify({
    ...state,
    simulation: state.simulation.map((year) => ({
      ...year,
      accounts: year.accounts.map((acc) => ({ ...acc, className: acc.constructor.name })),
      incomes: year.incomes.map((inc) => ({ ...inc, className: inc.constructor.name })),
      expenses: year.expenses.map((exp) => ({ ...exp, className: exp.constructor.name })),
    })),
  });
}

interface SimulationContextProps extends SimulationState {
  dispatch: Dispatch<Action>;
}

export const SimulationContext = createContext<SimulationContextProps>({
  ...initialState,
  dispatch: () => null,
});

export function SimulationProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(simulationReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateSimulationState,
    serialize: serializeSimulationState,
  });

  const contextValue = useMemo(() => ({ ...state, dispatch }), [state, dispatch]);

  return (
    <SimulationContext.Provider value={contextValue}>
      {children}
    </SimulationContext.Provider>
  );
}
