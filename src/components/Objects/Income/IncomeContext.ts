import { createContext, type Dispatch } from 'react';
import { type AnyIncome, reconstituteIncome } from './models';
import { jsonDateReplacer } from '../../../utils/formatters';

type AllKeys<T> = T extends unknown ? keyof T : never;
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

export const STORAGE_KEY = 'user_incomes_data';

export const initialState: IncomeState = {
  incomes: [],
};

export function incomeReducer(state: IncomeState, action: Action): IncomeState {
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

export function hydrateIncomeState(parsed: unknown, initial: IncomeState): IncomeState {
  const data = parsed as { incomes?: unknown[] };
  const incomes = (data.incomes || [])
    .map(reconstituteIncome)
    .filter((inc): inc is AnyIncome => inc !== null);
  return { ...initial, incomes };
}

export function serializeIncomeState(state: IncomeState): string {
  // jsonDateReplacer keeps Date-typed startDate/end_date as local YYYY-MM-DD;
  // bare JSON.stringify would emit a UTC ISO string that reloads a day earlier
  // for UTC+ users (issue #73 on the persistence path).
  return JSON.stringify({
    ...state,
    incomes: state.incomes.map(inc => ({ ...inc, className: inc.className || inc.constructor.name })),
  }, jsonDateReplacer);
}

export const IncomeContext = createContext<IncomeState>({ incomes: [] });
export const IncomeDispatchContext = createContext<Dispatch<Action>>(() => null);