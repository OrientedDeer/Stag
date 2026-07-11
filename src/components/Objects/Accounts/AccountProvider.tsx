import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { AnyAccount, reconstituteAccount } from './models';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import { formatDateForInput, jsonDateReplacer } from '../../../utils/formatters';
import {
  AccountContext,
  AccountDispatchContext,
  AccountDispatch,
  accountReducer,
  initialState,
  STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
  hydrateAccountState,
  serializeAccountState,
} from './AccountContext';

export function AccountProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(accountReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateAccountState,
    serialize: serializeAccountState,
  });

  // Keep latest state in a ref so exportData can read it without re-creating.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const exportData = useCallback(() => {
    const data = {
      version: CURRENT_SCHEMA_VERSION,
      accounts: stateRef.current.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
      amountHistory: stateRef.current.amountHistory,
    };
    const blob = new Blob([JSON.stringify(data, jsonDateReplacer, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Local date (not toISOString, which is UTC): an evening export in a
    // negative-offset timezone would otherwise be stamped with tomorrow's date.
    a.download = `stag_backup_${formatDateForInput(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importData = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      const accounts = (parsed.accounts || [])
        .map(reconstituteAccount)
        .filter((acc: AnyAccount | null): acc is AnyAccount => acc !== null);

      dispatch({
        type: 'SET_BULK_DATA',
        payload: { accounts, amountHistory: parsed.amountHistory || {} },
      });
      alert('Import successful!');
    } catch {
      alert('Failed to import data. Check file format.');
    }
  }, [dispatch]);

  const dispatchValue = useMemo<AccountDispatch>(
    () => ({ dispatch, exportData, importData }),
    [dispatch, exportData, importData],
  );

  return (
    <AccountDispatchContext.Provider value={dispatchValue}>
      <AccountContext.Provider value={state}>
        {children}
      </AccountContext.Provider>
    </AccountDispatchContext.Provider>
  );
}
