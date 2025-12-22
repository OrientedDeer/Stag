import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyExpense, 
    HousingExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
    TransportExpense,
    FoodExpense,
    OtherExpense
} from './models';

export type AllExpenseKeys = keyof HousingExpense | keyof LoanExpense | keyof DependentExpense | keyof TransportExpense;

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

export function reconstituteExpense(data: any): AnyExpense | null {
    if (!data || !data.className) return null;
    
    const base = {
        id: data.id,
        name: data.name || "Unnamed Expense",
        amount: Number(data.amount) || 0,
        frequency: data.frequency || 'Monthly',
    };

    switch (data.className) {
        case 'HousingExpense':
            return new HousingExpense(base.id, base.name, data.payment || 0, data.utilities || 0, data.property_taxes || 0, data.maintenance || 0, base.frequency);
        case 'LoanExpense':
            return new LoanExpense(base.id, base.name, base.amount, base.frequency, data.apr || 0, data.interest_type || 'Simple', new Date(data.start_date || Date.now()), data.payment || 0, data.is_tax_deductible || 'No', data.tax_deductible || 0, data.linkedAccountId || '');
        case 'DependentExpense':
            return new DependentExpense(base.id, base.name, base.amount, base.frequency, new Date(data.start_date || Date.now()), new Date(data.end_date || Date.now()), data.is_tax_deductible || 'No', data.tax_deductible || 0);
        case 'HealthcareExpense':
            return new HealthcareExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'No', data.tax_deductible || 0);
        case 'VacationExpense': return new VacationExpense(base.id, base.name, base.amount, base.frequency);
        case 'EmergencyExpense': return new EmergencyExpense(base.id, base.name, base.amount, base.frequency);
        case 'TransportExpense': return new TransportExpense(base.id, base.name, base.amount, base.frequency);
        case 'FoodExpense': return new FoodExpense(base.id, base.name, base.amount, base.frequency);
        case 'OtherExpense': return new OtherExpense(base.id, base.name, base.amount, base.frequency);
        default:
            return null;
    }
}

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

                if (updatedExpense instanceof HousingExpense) {
                    updatedExpense.amount = 
                        (updatedExpense.payment || 0) + 
                        (updatedExpense.utilities || 0) + 
                        (updatedExpense.property_taxes || 0) + 
                        (updatedExpense.maintenance || 0);
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

    useEffect(() => {
        try {
            const serializableState = {
                ...state,
                expenses: state.expenses.map(exp => ({
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