import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyExpense, 
    HousingExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
    IncomeDeductionExpense,
    TransportExpense,
    OtherExpense
} from './models';

export type AllExpenseKeys = keyof HousingExpense | keyof LoanExpense | keyof DependentExpense | keyof IncomeDeductionExpense | keyof TransportExpense;

interface AppState {
  expenses: AnyExpense[];
}

type Action =
  | { type: 'ADD_EXPENSE'; payload: AnyExpense }
  | { type: 'DELETE_EXPENSE'; payload: { id: string } }
  | { type: 'UPDATE_EXPENSE_FIELD'; payload: { id: string; field: AllExpenseKeys; value: any } }
  | { type: 'REORDER_EXPENSES'; payload: { startIndex: number; endIndex: number } }

const STORAGE_KEY = 'user_expenses_data';
const initialState: AppState = {
  expenses: [],
};

function reconstituteExpense(expenseData: any): AnyExpense | null {
    if (!expenseData || !expenseData.className) return null;
    
    // Helper to restore Date objects which turn into strings in JSON
    const end_date = new Date(expenseData.end_date);
    const start_date = new Date(expenseData.start_date);

    switch (expenseData.className) {
        case 'HousingExpense':
          return Object.assign(new HousingExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.payment, // Ensure payment is restored
            expenseData.utilities,
            expenseData.property_taxes,
            expenseData.maintenance,
            expenseData.frequency,
          ), expenseData);
        case 'LoanExpense':
          return Object.assign(new LoanExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
            expenseData.apr,
            expenseData.interest_type,
            start_date,
            expenseData.payment,
            expenseData.is_tax_deductible,
            expenseData.tax_deductible,
            expenseData.linkedAccountId
          ), expenseData);
        case 'DependentExpense':
          return Object.assign(new DependentExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
            start_date,
            end_date,
            expenseData.is_tax_deductible,
            expenseData.tax_deductible,
          ), expenseData);
        case 'HealthcareExpense':
          return Object.assign(new HealthcareExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
          ), expenseData);
        case 'VacationExpense':
          return Object.assign(new VacationExpense(
              expenseData.id, 
              expenseData.name, 
              expenseData.amount,
              expenseData.frequency,
          ), expenseData);
        case 'EmergencyExpense':
          return Object.assign(new EmergencyExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
          ), expenseData);
        case 'IncomeDeductionExpense':
          return Object.assign(new IncomeDeductionExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
            expenseData.is_tax_deductible,
            expenseData.tax_deductible,
            expenseData.income,
          ), expenseData);
        case 'TransportExpense':
          return Object.assign(new TransportExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
          ), expenseData);
        case 'OtherExpense':
          return Object.assign(new OtherExpense(
            expenseData.id, 
            expenseData.name, 
            expenseData.amount,
            expenseData.frequency,
          ), expenseData);
        default:
          console.warn(`Unknown expense type: ${expenseData.className}`);
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