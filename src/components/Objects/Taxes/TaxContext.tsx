// src/components/Taxes/TaxContext.tsx
import { createContext, useReducer, ReactNode, useMemo } from 'react';
import { FilingStatus, max_year } from '../../../data/TaxData';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';

export type DeductionMethod = 'Standard' | 'Itemized' | 'Auto';

export interface TaxState {
  filingStatus: FilingStatus;
  stateResidency: string;
  deductionMethod: DeductionMethod;
  fedOverride: number | null;
  ficaOverride: number | null;
  stateOverride: number | null;
  year: number;
}

type Action = 
  | { type: 'SET_STATUS'; payload: FilingStatus }
  | { type: 'SET_STATE'; payload: string }
  | { type: 'SET_DEDUCTION_METHOD'; payload: DeductionMethod }
  | { type: 'SET_FED_OVERRIDE'; payload: number | null }
  | { type: 'SET_FICA_OVERRIDE'; payload: number | null }
  | { type: 'SET_STATE_OVERRIDE'; payload: number | null }
  | { type: 'SET_YEAR'; payload: number }
  | { type: 'SET_BULK_DATA'; payload: TaxState };

const initialState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Auto',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
};

const taxReducer = (state: TaxState, action: Action): TaxState => {
  switch (action.type) {
    case 'SET_STATUS': return { ...state, filingStatus: action.payload };
    case 'SET_STATE': return { ...state, stateResidency: action.payload };
    case 'SET_DEDUCTION_METHOD': return { ...state, deductionMethod: action.payload };
    case 'SET_FED_OVERRIDE': return { ...state, fedOverride: action.payload };
    case 'SET_FICA_OVERRIDE': return { ...state, ficaOverride: action.payload };
    case 'SET_STATE_OVERRIDE': return { ...state, stateOverride: action.payload };
    case 'SET_YEAR': return { ...state, year: action.payload };
    case 'SET_BULK_DATA': return { ...action.payload };
    default: return state;
  }
};

interface TaxContextProps {
    state: TaxState;
    dispatch: React.Dispatch<Action>;
}


export const TaxContext = createContext<TaxContextProps>({
    state: initialState,
    dispatch: () => null,
});


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

  // Debounced localStorage persistence (500ms delay to prevent main thread blocking)
  useDebouncedLocalStorage('tax_settings', state);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    state,
    dispatch
  }), [state, dispatch]);

  return <TaxContext.Provider value={contextValue}>{children}</TaxContext.Provider>;
};