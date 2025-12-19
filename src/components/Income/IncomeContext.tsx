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
  | { type: 'REORDER_INCOMES'; payload: { startIndex: number; endIndex: number } };

const STORAGE_KEY = 'user_incomes_data';
const initialState: AppState = {
  incomes: [],
};

function reconstituteIncome(incomeData: any): AnyIncome | null {
    if (!incomeData || !incomeData.className) return null;
    
    // Helper to restore Date objects which turn into strings in JSON
    const end_date = new Date(incomeData.end_date);
    const receipt_date = new Date(incomeData.receipt_date);

    switch (incomeData.className) {
        case 'WorkIncome':
            return Object.assign(new WorkIncome(
                incomeData.id, 
                incomeData.name, 
                incomeData.amount,
                incomeData.frequency,
                end_date,
            ), incomeData);
        case 'SocialSecurityIncome':
            return Object.assign(new SocialSecurityIncome(
                incomeData.id, 
                incomeData.name, 
                incomeData.amount, 
                incomeData.frequency,
                end_date,
                incomeData.claimingAge
            ), incomeData);
        case 'PassiveIncome':
            return Object.assign(new PassiveIncome(
                incomeData.id, 
                incomeData.name, 
                incomeData.amount,
                incomeData.frequency, 
                end_date,
                incomeData.sourceType
            ), incomeData);
        case 'WindfallIncome':
            return Object.assign(new WindfallIncome(
                incomeData.id, 
                incomeData.name, 
                incomeData.amount, 
                incomeData.frequency,
                end_date,
                receipt_date
            ), incomeData);
        default:
            console.warn(`Unknown income type: ${incomeData.className}`);
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