import { ReactNode } from 'react';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import {
  IncomeContext,
  IncomeDispatchContext,
  incomeReducer,
  initialState,
  STORAGE_KEY,
  hydrateIncomeState,
  serializeIncomeState,
} from './IncomeContext';

export function IncomeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(incomeReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateIncomeState,
    serialize: serializeIncomeState,
  });

  return (
    <IncomeDispatchContext.Provider value={dispatch}>
      <IncomeContext.Provider value={state}>
        {children}
      </IncomeContext.Provider>
    </IncomeDispatchContext.Provider>
  );
}
