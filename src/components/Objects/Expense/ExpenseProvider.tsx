import { type ReactNode } from 'react';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import {
  ExpenseContext,
  ExpenseDispatchContext,
  expenseReducer,
  initialState,
  STORAGE_KEY,
  hydrateExpenseState,
  serializeExpenseState,
} from './ExpenseContext';

export function ExpenseProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(expenseReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateExpenseState,
    serialize: serializeExpenseState,
  });

  return (
    <ExpenseDispatchContext.Provider value={dispatch}>
      <ExpenseContext.Provider value={state}>
        {children}
      </ExpenseContext.Provider>
    </ExpenseDispatchContext.Provider>
  );
}
