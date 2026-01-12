import { createContext, useReducer, ReactNode, Dispatch, useMemo, useCallback } from 'react';
import {
    AnyExpense,
    RentExpense,
    MortgageExpense,
    LoanExpense,
    DependentExpense,
    TransportExpense,
    reconstituteExpense
} from './models';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';

export type AllExpenseKeys = keyof RentExpense | keyof MortgageExpense | keyof LoanExpense | keyof DependentExpense | keyof TransportExpense | 'startDate' | 'endDate';



interface AppState {
  expenses: AnyExpense[];
}

type Action =
  | { type: 'ADD_EXPENSE'; payload: AnyExpense }
  | { type: 'DELETE_EXPENSE'; payload: { id: string } }
  | { type: 'UPDATE_EXPENSE_FIELD'; payload: { id: string; field: AllExpenseKeys; value: any } }
  | { type: 'REORDER_EXPENSES'; payload: { startIndex: number; endIndex: number } }
  | { type: 'SET_BULK_DATA'; payload: { expenses: AnyExpense[] } };

const STORAGE_KEY = 'user_expenses_data';
const initialState: AppState = {
  expenses: [],
};


const expenseReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'ADD_EXPENSE':
      return {
        ...state,
        expenses: [...state.expenses, action.payload],
      };

    case 'DELETE_EXPENSE': {
      return {
        ...state,
        expenses: state.expenses.filter((exp) => exp.id !== action.payload.id),
      };
    }

    case 'UPDATE_EXPENSE_FIELD':
    return {
        ...state,
        expenses: state.expenses.map((exp) => {
            if (exp.id === action.payload.id) {
                const updatedExpense = Object.assign(Object.create(Object.getPrototypeOf(exp)), exp);
                updatedExpense[action.payload.field] = action.payload.value;

                if (updatedExpense instanceof RentExpense) {
                    updatedExpense.amount = 
                        (updatedExpense.payment || 0) + 
                        (updatedExpense.utilities || 0);
                }
                else if (updatedExpense instanceof MortgageExpense) {
                    updatedExpense.amount = 
                        (updatedExpense.payment || 0);
                }
                return updatedExpense;
            }
            return exp;
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
};

interface ExpenseContextProps extends AppState {
  dispatch: Dispatch<Action>;
}

export const ExpenseContext = createContext<ExpenseContextProps>({
  expenses: [],
  dispatch: () => null,
});

export const ExpenseProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(expenseReducer, initialState, (initial) => {
        try {
            const savedState = localStorage.getItem(STORAGE_KEY);
            if (savedState) {
                const parsedState: AppState = JSON.parse(savedState);
                
                const reconstitutedExpenses = parsedState.expenses
                    .map(reconstituteExpense)
                    .filter((exp): exp is AnyExpense => exp !== null);

                return {
                    ...parsedState,
                    expenses: reconstitutedExpenses,
                };
            }
        } catch (e) {
            console.error("Could not load state from localStorage:", e);
        }
        return initial;
    });

    // Debounced localStorage persistence (500ms delay to prevent main thread blocking)
    const serializeState = useCallback((s: AppState) => {
        const serializableState = {
            ...s,
            expenses: s.expenses.map(exp => ({
                ...exp,
                className: exp.constructor.name,
            }))
        };
        return JSON.stringify(serializableState);
    }, []);

    useDebouncedLocalStorage(STORAGE_KEY, state, serializeState);

    // Memoize context value to prevent unnecessary re-renders
    const contextValue = useMemo(() => ({
        ...state,
        dispatch
    }), [state, dispatch]);

    return (
        <ExpenseContext.Provider value={contextValue}>
            {children}
        </ExpenseContext.Provider>
    );
};