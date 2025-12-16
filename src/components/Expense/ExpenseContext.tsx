import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyExpense, 
    DefaultExpense,
    SecondaryExpense
} from './models';

type AllKeys<T> = T extends any ? keyof T : never;
export type AllExpenseKeys = AllKeys<AnyExpense>;

interface AppState {
  expenses: AnyExpense[];
}

type Action =
  | { type: 'ADD_EXPENSE'; payload: AnyExpense }
  | { type: 'DELETE_EXPENSE'; payload: { id: string } }
  | { type: 'UPDATE_EXPENSE_FIELD'; payload: { id: string; field: AllExpenseKeys; value: any } };

const STORAGE_KEY = 'user_Expenses_data';
const initialState: AppState = {
  expenses: [],
};

function reconstituteExpense(expenseData: any): AnyExpense | null {
    if (!expenseData || !expenseData.className) return null;
    
    // Helper to restore Date objects which turn into strings in JSON
    const startDate = new Date(expenseData.startDate);
    const endDate = new Date(expenseData.endDate);

    switch (expenseData.className) {
        case 'DefaultExpense':
            return Object.assign(new DefaultExpense(
                expenseData.id, 
                expenseData.name, 
                expenseData.amount,
                expenseData.frequency,
                endDate,
            ), expenseData);
        case 'SecondaryExpense':
            return Object.assign(new SecondaryExpense(
                expenseData.id, 
                expenseData.name, 
                expenseData.amount,
                expenseData.frequency,
                startDate,
                endDate,
            ), expenseData);
        default:
            console.warn(`Unknown Expense type: ${expenseData.className}`);
            return null;
    }
}

const ExpenseReducer = (state: AppState, action: Action): AppState => {
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
            updatedExpense.className = exp.constructor.name; 
            updatedExpense[action.payload.field] = action.payload.value;
            return updatedExpense;
          }
          return exp;
        }),
      };

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
    const [state, dispatch] = useReducer(ExpenseReducer, initialState, (initial) => {
        try {
            const savedState = localStorage.getItem(STORAGE_KEY);
            if (savedState) {
                const parsedState: AppState = JSON.parse(savedState);
                
                const reconstitutedExpenses = parsedState.expenses
                    .map(reconstituteExpense)
                    .filter((exp): exp is AnyExpense => exp !== null);

                return {
                    ...parsedState,
                    Expenses: reconstitutedExpenses,
                };
            }
        } catch (e) {
            console.error("Could not load state from localStorage:", e);
        }
        return initial;
    });

    useEffect(() => {
        try {
            const serializableState = {
                ...state,
                Expenses: state.expenses.map(exp => ({
                    ...exp,
                    className: exp.constructor.name,
                }))
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
        } catch (e) {
            console.error("Could not save state to localStorage:", e);
        }
    }, [state]);

  return (
    <ExpenseContext.Provider value={{ ...state, dispatch }}>
      {children}
    </ExpenseContext.Provider>
  );
};