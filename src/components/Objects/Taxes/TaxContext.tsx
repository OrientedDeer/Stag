import { createContext, ReactNode, useMemo } from 'react';
import { FilingStatus, max_year } from '../../../data/TaxData';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';

export type DeductionMethod = 'Standard' | 'Itemized' | 'Auto';

export interface TaxState {
  filingStatus: FilingStatus;
  stateResidency: string;
  deductionMethod: DeductionMethod;
  /**
   * Dollar tax overrides. These apply to the CURRENT year only (the snapshot
   * and the projection's year 0) — the engine clears them for every future
   * year, so a current-year correction no longer pins a flat amount across the
   * projection. (Carrying a correction forward as a % — calibration — is a
   * planned follow-up.)
   */
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

export const defaultTaxState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Auto',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
};

function taxReducer(state: TaxState, action: Action): TaxState {
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
}

interface TaxContextProps {
  state: TaxState;
  dispatch: React.Dispatch<Action>;
}

export const TaxContext = createContext<TaxContextProps>({
  state: defaultTaxState,
  dispatch: () => null,
});

export function TaxProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(taxReducer, defaultTaxState, {
    storageKey: 'tax_settings',
    // Merge with defaults to ensure new fields exist even with old saved data
  });

  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return <TaxContext.Provider value={contextValue}>{children}</TaxContext.Provider>;
}