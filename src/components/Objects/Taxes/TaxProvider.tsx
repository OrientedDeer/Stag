import { ReactNode, useMemo } from 'react';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import { TaxContext, taxReducer, defaultTaxState } from './TaxContext';

export function TaxProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(taxReducer, defaultTaxState, {
    storageKey: 'tax_settings',
    // Merge with defaults to ensure new fields exist even with old saved data
  });

  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return <TaxContext.Provider value={contextValue}>{children}</TaxContext.Provider>;
}
