import { createContext, ReactNode, Dispatch } from 'react';
import { AnyIncome, reconstituteIncome } from './models';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';

type AllKeys<T> = T extends any ? keyof T : never;
export type AllIncomeKeys = AllKeys<AnyIncome>;

interface IncomeState {
  incomes: AnyIncome[];
}

type Action =
  | { type: 'ADD_INCOME'; payload: AnyIncome }
  | { type: 'DELETE_INCOME'; payload: { id: string } }
  | { type: 'UPDATE_INCOME_FIELD'; payload: { id: string; field: AllIncomeKeys; value: unknown } }
  | { type: 'REORDER_INCOMES'; payload: { startIndex: number; endIndex: number } }
  | { type: 'SET_BULK_DATA'; payload: { incomes: AnyIncome[] } };

const STORAGE_KEY = 'user_incomes_data';

const initialState: IncomeState = {
  incomes: [],
};

function incomeReducer(state: IncomeState, action: Action): IncomeState {
  switch (action.type) {
    case 'ADD_INCOME':
      return { ...state, incomes: [...state.incomes, action.payload] };

    case 'DELETE_INCOME':
      return { ...state, incomes: state.incomes.filter((inc) => inc.id !== action.payload.id) };

    case 'UPDATE_INCOME_FIELD':
      return {
        ...state,
        incomes: state.incomes.map((inc) => {
          if (inc.id !== action.payload.id) return inc;
          const updated = Object.assign(Object.create(Object.getPrototypeOf(inc)), inc);
          updated.className = inc.className || inc.constructor.name;
          updated[action.payload.field] = action.payload.value;
          return updated;
        }),
      };

    case 'REORDER_INCOMES': {
      const result = Array.from(state.incomes);
      const [removed] = result.splice(action.payload.startIndex, 1);
      result.splice(action.payload.endIndex, 0, removed);
      return { ...state, incomes: result };
    }

    case 'SET_BULK_DATA':
      return { ...state, incomes: action.payload.incomes };

    default:
      return state;
  }
}

function hydrateIncomeState(parsed: unknown, initial: IncomeState): IncomeState {
  const data = parsed as { incomes?: unknown[] };
  const incomes = (data.incomes || [])
    .map(reconstituteIncome)
    .filter((inc): inc is AnyIncome => inc !== null);
  return { ...initial, incomes };
}

function serializeIncomeState(state: IncomeState): string {
  return JSON.stringify({
    ...state,
    incomes: state.incomes.map(inc => ({ ...inc, className: inc.className || inc.constructor.name })),
  });
}

export const IncomeContext = createContext<IncomeState>({ incomes: [] });
export const IncomeDispatchContext = createContext<Dispatch<Action>>(() => null);

export function IncomeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(incomeReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateIncomeState,
    serialize: serializeIncomeState,
  });

  return (
    <IncomeDispatchContext.Provider value={dispatch}>
      <IncomeContext.Provider value={state}>
        {children}
      </IncomeContext.Provider>
    </IncomeDispatchContext.Provider>
  );
}