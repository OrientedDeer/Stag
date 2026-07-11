import { createContext, Dispatch } from 'react';
import {
    AnyExpense,
    RentExpense,
    MortgageExpense,
    LoanExpense,
    DependentExpense,
    TransportExpense,
    reconstituteExpense
} from './models';
import { jsonDateReplacer } from '../../../utils/formatters';

export type AllExpenseKeys = keyof RentExpense | keyof MortgageExpense | keyof LoanExpense | keyof DependentExpense | keyof TransportExpense | 'startDate' | 'endDate';

interface ExpenseState {
  expenses: AnyExpense[];
}

type Action =
  | { type: 'ADD_EXPENSE'; payload: AnyExpense }
  | { type: 'DELETE_EXPENSE'; payload: { id: string } }
  | { type: 'UPDATE_EXPENSE_FIELD'; payload: { id: string; field: AllExpenseKeys; value: unknown } }
  | { type: 'REORDER_EXPENSES'; payload: { startIndex: number; endIndex: number } }
  | { type: 'SET_BULK_DATA'; payload: { expenses: AnyExpense[] } };

export const STORAGE_KEY = 'user_expenses_data';

export const initialState: ExpenseState = {
  expenses: [],
};

export function expenseReducer(state: ExpenseState, action: Action): ExpenseState {
  switch (action.type) {
    case 'ADD_EXPENSE':
      return { ...state, expenses: [...state.expenses, action.payload] };

    case 'DELETE_EXPENSE':
      return { ...state, expenses: state.expenses.filter((exp) => exp.id !== action.payload.id) };

    case 'UPDATE_EXPENSE_FIELD':
      return {
        ...state,
        expenses: state.expenses.map((exp) => {
          if (exp.id !== action.payload.id) return exp;

          const updated = Object.assign(Object.create(Object.getPrototypeOf(exp)), exp);
          updated[action.payload.field] = action.payload.value;

          // Recalculate derived amount for housing expenses
          if (updated instanceof RentExpense) {
            updated.amount = (updated.payment || 0) + (updated.utilities || 0);
          } else if (updated instanceof MortgageExpense) {
            updated.amount = updated.payment || 0;
          }

          return updated;
        }),
      };

    case 'REORDER_EXPENSES': {
      const result = Array.from(state.expenses);
      const [removed] = result.splice(action.payload.startIndex, 1);
      result.splice(action.payload.endIndex, 0, removed);
      return { ...state, expenses: result };
    }

    case 'SET_BULK_DATA':
      return { ...state, expenses: action.payload.expenses };

    default:
      return state;
  }
}

export function hydrateExpenseState(parsed: unknown, initial: ExpenseState): ExpenseState {
  const data = parsed as { expenses?: unknown[] };
  const expenses = (data.expenses || [])
    .map(reconstituteExpense)
    .filter((exp): exp is AnyExpense => exp !== null);
  return { ...initial, expenses };
}

export function serializeExpenseState(state: ExpenseState): string {
  // jsonDateReplacer keeps Date-typed startDate/endDate (incl. goal targetDate) as
  // local YYYY-MM-DD; bare JSON.stringify would emit a UTC ISO string that reloads
  // a day earlier for UTC+ users (issue #73 on the persistence path).
  return JSON.stringify({
    ...state,
    expenses: state.expenses.map(exp => ({ ...exp, className: exp.constructor.name })),
  }, jsonDateReplacer);
}

export const ExpenseContext = createContext<ExpenseState>({ expenses: [] });
export const ExpenseDispatchContext = createContext<Dispatch<Action>>(() => null);