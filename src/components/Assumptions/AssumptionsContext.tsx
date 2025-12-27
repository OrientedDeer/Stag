import { createContext, useReducer, ReactNode, useEffect } from 'react';

export interface AssumptionsState {
  macro: {
    inflationRate: number;       // e.g., 3.0
    healthcareInflation: number; // e.g., 5.0
    inflationAdjusted: boolean;   // usually true (pegged to inflation)
  };
  income: {
    salaryGrowth: number;        // e.g., 3.0
    socialSecurityStartAge: number;
  };
  expenses: {
    lifestyleCreep: number;      // e.g., 50.0 (% of raise spent)
    housingAppreciation: number; // e.g., 3.5
    rentInflation: number;       // e.g., 4.0
  };
      investments: {
      returnRates: {
        ror: number;   // e.g., 10.0
      };
      withdrawalStrategy: 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
      withdrawalRate: number; // e.g., 4.0
    };  demographics: {
    retirementAge: number;
    lifeExpectancy: number;
  };
}

export const defaultAssumptions: AssumptionsState = {
  macro: {
    inflationRate: 3.0,
    healthcareInflation: 5.0,
    inflationAdjusted: true,
  },
  income: {
    salaryGrowth: 3.0,
    socialSecurityStartAge: 67,
  },
  expenses: {
    lifestyleCreep: 20.0,
    housingAppreciation: 3.0,
    rentInflation: 3.5,
  },
  investments: {
    returnRates: { ror: 7 },
    withdrawalStrategy: 'Fixed Real',
    withdrawalRate: 4.0,
  },
  demographics: {
    retirementAge: 65,
    lifeExpectancy: 90,
  },
};

type Action =
  | { type: 'UPDATE_MACRO'; payload: Partial<AssumptionsState['macro']> }
  | { type: 'UPDATE_INCOME'; payload: Partial<AssumptionsState['income']> }
  | { type: 'UPDATE_EXPENSES'; payload: Partial<AssumptionsState['expenses']> }
  | { type: 'UPDATE_INVESTMENTS'; payload: Partial<AssumptionsState['investments']> }
  | { type: 'UPDATE_INVESTMENT_RATES'; payload: Partial<AssumptionsState['investments']['returnRates']> }
  | { type: 'UPDATE_DEMOGRAPHICS'; payload: Partial<AssumptionsState['demographics']> }
  | { type: 'RESET_DEFAULTS' }
  | { type: 'SET_BULK_DATA'; payload: AssumptionsState };

const assumptionsReducer = (state: AssumptionsState, action: Action): AssumptionsState => {
  switch (action.type) {
    case 'UPDATE_MACRO':
      return { ...state, macro: { ...state.macro, ...action.payload } };
    case 'UPDATE_INCOME':
      return { ...state, income: { ...state.income, ...action.payload } };
    case 'UPDATE_EXPENSES':
      return { ...state, expenses: { ...state.expenses, ...action.payload } };
    case 'UPDATE_INVESTMENTS':
      return { ...state, investments: { ...state.investments, ...action.payload } };
    case 'UPDATE_INVESTMENT_RATES':
      return {
        ...state,
        investments: {
          ...state.investments,
          returnRates: { ...state.investments.returnRates, ...action.payload },
        },
      };
    case 'UPDATE_DEMOGRAPHICS':
      return { ...state, demographics: { ...state.demographics, ...action.payload } };
    case 'RESET_DEFAULTS':
      return defaultAssumptions;
    case 'SET_BULK_DATA':
      return action.payload;
    default:
      return state;
  }
};

interface AssumptionsContextProps {
    state: AssumptionsState;
    dispatch: React.Dispatch<Action>;
}

export const AssumptionsContext = createContext<AssumptionsContextProps>({
  state: defaultAssumptions,
  dispatch: () => null,
})

export const AssumptionsProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(assumptionsReducer, defaultAssumptions, (initial) => {
    const saved = localStorage.getItem('assumptions_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge parsed data with initial to ensure structure integrity
        return { ...initial, ...parsed };
      } catch (e) {
        console.error("Failed to parse assumptions settings", e);
      }
    }
    return initial;
  });

  useEffect(() => {
    localStorage.setItem('assumptions_settings', JSON.stringify(state));
  }, [state]);

  return <AssumptionsContext.Provider value={{ state, dispatch }}>{children}</AssumptionsContext.Provider>;
};
