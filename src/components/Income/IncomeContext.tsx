import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyIncome, 
    WorkIncome, 
    SocialSecurityIncome, 
    PassiveIncome, 
    WindfallIncome
} from './models';

type AllKeys<T> = T extends any ? keyof T : never;
export type AllIncomeKeys = AllKeys<AnyIncome>;

interface AppState {
  incomes: AnyIncome[];
}

type Action =
  | { type: 'ADD_INCOME'; payload: AnyIncome }
  | { type: 'DELETE_INCOME'; payload: { id: string } }
  | { type: 'UPDATE_INCOME_FIELD'; payload: { id: string; field: AllIncomeKeys; value: any } }
  | { type: 'REORDER_INCOMES'; payload: { startIndex: number; endIndex: number } }
  | { type: 'SET_BULK_DATA'; payload: { incomes: AnyIncome[] } };

const STORAGE_KEY = 'user_incomes_data';
const initialState: AppState = {
  incomes: [],
};

export function reconstituteIncome(data: any): AnyIncome | null {
    if (!data || !data.className) return null;
    
    const endDateValue = data.end_date || Date.now();
    const endDate = new Date(typeof endDateValue === 'string' && !endDateValue.includes('T') ? `${endDateValue}T00:00:00.000Z` : endDateValue);

    // Explicitly mapping fields ensures old saves don't break with new class structures
    const base = {
        id: data.id,
        name: data.name || "Unnamed Income",
        amount: Number(data.amount) || 0,
        frequency: data.frequency || 'Monthly',
        end_date: endDate,
        earned_income: data.earned_income || "No"
    };

    switch (data.className) {
        case 'WorkIncome':
            return new WorkIncome(base.id, base.name, base.amount, base.frequency, base.end_date, base.earned_income, 
                data.preTax401k || 0, data.insurance || 0, data.roth401k || 0);
        case 'SocialSecurityIncome':
            return new SocialSecurityIncome(base.id, base.name, base.amount, base.frequency, base.end_date, 
                data.claimingAge || 67);
        case 'PassiveIncome':
            return new PassiveIncome(base.id, base.name, base.amount, base.frequency, base.end_date, base.earned_income, 
                data.sourceType || 'Other');
        case 'WindfallIncome':
            return new WindfallIncome(base.id, base.name, base.amount, base.frequency, base.end_date, base.earned_income);
        default:
            return null;
    }
}

const incomeReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'ADD_INCOME':
      return {
        ...state,
        incomes: [...state.incomes, action.payload],
      };

    case 'DELETE_INCOME': {
      return {
        ...state,
        incomes: state.incomes.filter((inc) => inc.id !== action.payload.id),
      };
    }

    case 'UPDATE_INCOME_FIELD':
      return {
        ...state,
        incomes: state.incomes.map((inc) => {
          if (inc.id === action.payload.id) {
            const updatedIncome = Object.assign(Object.create(Object.getPrototypeOf(inc)), inc);
            updatedIncome.className = inc.constructor.name; 
            updatedIncome[action.payload.field] = action.payload.value;
            return updatedIncome;
          }
          return inc;
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
};

interface IncomeContextProps extends AppState {
  dispatch: Dispatch<Action>;
}

export const IncomeContext = createContext<IncomeContextProps>({
  incomes: [],
  dispatch: () => null,
});

export const IncomeProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(incomeReducer, initialState, (initial) => {
        try {
            const savedState = localStorage.getItem(STORAGE_KEY);
            if (savedState) {
                const parsedState: AppState = JSON.parse(savedState);
                
                const reconstitutedIncomes = parsedState.incomes
                    .map(reconstituteIncome)
                    .filter((inc): inc is AnyIncome => inc !== null);

                return {
                    ...parsedState,
                    incomes: reconstitutedIncomes,
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
                incomes: state.incomes.map(inc => ({
                    ...inc,
                    className: inc.constructor.name,
                }))
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
        } catch (e) {
            console.error("Could not save state to localStorage:", e);
        }
    }, [state]);

  return (
    <IncomeContext.Provider value={{ ...state, dispatch }}>
      {children}
    </IncomeContext.Provider>
  );
};