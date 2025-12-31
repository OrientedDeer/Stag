import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyExpense, 
    RentExpense,
    MortgageExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
    TransportExpense,
    FoodExpense,
    OtherExpense
} from './models';

export type AllExpenseKeys = keyof RentExpense | keyof MortgageExpense | keyof LoanExpense | keyof DependentExpense | keyof TransportExpense | 'startDate' | 'endDate';

export function reconstituteExpense(data: any): AnyExpense | null {
    if (!data || !data.className) return null;
    
    // For startDate, if it's a string, create a local date. Otherwise, treat as already a Date object (or Date.now())
    const startDateValue = data.startDate || Date.now();
    const startDate = typeof startDateValue === 'string' ? new Date(startDateValue) : new Date(startDateValue);

    // For endDate, if it's a string, create a local date. Otherwise, treat as already a Date object.
    const endDateValue = data.end_date;
    const endDate = endDateValue ? (typeof endDateValue === 'string' ? new Date(endDateValue) : new Date(endDateValue)) : undefined;

    const base = {
        id: data.id,
        name: data.name || "Unnamed Expense",
        amount: Number(data.amount) || 0,
        frequency: data.frequency || 'Monthly',
        startDate: startDate,
        endDate: endDate
    };

    switch (data.className) {
        case 'HousingExpense':
            return new RentExpense(base.id, base.name, data.payment || 0, data.utilities || 0, base.frequency, base.startDate, base.endDate);
        case 'RentExpense':
            return new RentExpense(base.id, base.name, data.payment || 0, data.utilities || 0, base.frequency, base.startDate, base.endDate);
        case 'MortgageExpense': {
            return new MortgageExpense(base.id, base.name, base.frequency, data.valuation || 0, data.loan_balance || 0, data.starting_loan_balance || 0, data.apr || 0, data.term_length || 0, data.property_taxes || 0, data.valuation_deduction || 0, data.maintenance || 0, data.utilities || 0, data.home_owners_insurance || 0, data.pmi || 0, data.hoa_fee || 0, data.is_tax_deductible || 'No', data.tax_deductible || 0, data.linkedAccountId || '', base.startDate, data.payment || 0, data.extra_payment || 0, base.endDate);
        }
        case 'LoanExpense':
            return new LoanExpense(base.id, base.name, base.amount, base.frequency, data.apr || 0, data.interest_type || 'Simple', data.payment || 0, data.is_tax_deductible || 'No', data.tax_deductible || 0, data.linkedAccountId || '', base.startDate, base.endDate);
        case 'DependentExpense': {
            return new DependentExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'No', data.tax_deductible || 0, base.startDate, base.endDate);
        }
        case 'HealthcareExpense':
            return new HealthcareExpense(base.id, base.name, base.amount, base.frequency, data.is_tax_deductible || 'No', data.tax_deductible || 0, base.startDate, base.endDate);
        case 'VacationExpense': return new VacationExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
        case 'EmergencyExpense': return new EmergencyExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
        case 'TransportExpense': return new TransportExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
        case 'FoodExpense': return new FoodExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
        case 'OtherExpense': return new OtherExpense(base.id, base.name, base.amount, base.frequency, base.startDate, base.endDate);
        default:
            return null;
    }
}

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