// src/components/Taxes/TaxContext.tsx
import { createContext, useReducer, ReactNode, useEffect } from 'react';
import { FilingStatus } from './TaxData';

export type DeductionMethod = 'Standard' | 'Itemized';

interface TaxState {
  filingStatus: FilingStatus;
  stateResidency: string;
  deductionMethod: DeductionMethod;
  fedOverride: number | null;
  ficaOverride: number | null;
  stateOverride: number | null;
}

type Action = 
  | { type: 'SET_STATUS'; payload: FilingStatus }
  | { type: 'SET_STATE'; payload: string }
  | { type: 'SET_DEDUCTION_METHOD'; payload: DeductionMethod }
  | { type: 'SET_FED_OVERRIDE'; payload: number | null }
  | { type: 'SET_FICA_OVERRIDE'; payload: number | null }
  | { type: 'SET_STATE_OVERRIDE'; payload: number | null }
  | { type: 'SET_BULK_DATA'; payload: TaxState };

const initialState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Standard',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
};

const taxReducer = (state: TaxState, action: Action): TaxState => {
  switch (action.type) {
    case 'SET_STATUS': return { ...state, filingStatus: action.payload };
    case 'SET_STATE': return { ...state, stateResidency: action.payload };
    case 'SET_DEDUCTION_METHOD': return { ...state, deductionMethod: action.payload };
    case 'SET_FED_OVERRIDE': return { ...state, fedOverride: action.payload };
    case 'SET_FICA_OVERRIDE': return { ...state, ficaOverride: action.payload };
    case 'SET_STATE_OVERRIDE': return { ...state, stateOverride: action.payload };
    case 'SET_BULK_DATA': return { ...action.payload };
    default: return state;
  }
};

export const TaxContext = createContext<{ state: TaxState; dispatch: React.Dispatch<Action> } | undefined>(undefined);

export const TaxProvider = ({ children }: { children: ReactNode }) => {
  // FIXED: Pass taxReducer as the first argument
  const [state, dispatch] = useReducer(taxReducer, initialState, (initial) => {
    const saved = localStorage.getItem('tax_settings');
    if (saved) {
        // We merge with initial to ensure new fields (like overrides) exist 
        // even if the user has an old state saved in their browser
        return { ...initial, ...JSON.parse(saved) };
    }
    return initial;
  });

  useEffect(() => {
    localStorage.setItem('tax_settings', JSON.stringify(state));
  }, [state]);

  return <TaxContext.Provider value={{ state, dispatch }}>{children}</TaxContext.Provider>;
};