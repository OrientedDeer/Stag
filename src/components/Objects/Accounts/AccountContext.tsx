import { createContext, ReactNode, Dispatch, useCallback, useRef } from 'react';
import { AnyAccount, reconstituteAccount } from './models';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import { formatDateForInput } from '../../../utils/formatters';

type AllKeys<T> = T extends unknown ? keyof T : never;
export type AllAccountKeys = AllKeys<AnyAccount>;

const CURRENT_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'user_accounts_data';

export interface AmountHistoryEntry {
  date: string;
  num: number;
}

interface AccountState {
  accounts: AnyAccount[];
  amountHistory: Record<string, AmountHistoryEntry[]>;
}

type Action =
  | { type: 'ADD_ACCOUNT'; payload: AnyAccount }
  | { type: 'DELETE_ACCOUNT'; payload: { id: string } }
  | { type: 'UPDATE_ACCOUNT_FIELD'; payload: { id: string; field: AllAccountKeys; value: unknown } }
  | { type: 'ADD_AMOUNT_SNAPSHOT'; payload: { id: string; amount: number } }
  | { type: 'REORDER_ACCOUNTS'; payload: { startIndex: number; endIndex: number } }
  | { type: 'UPDATE_HISTORY_ENTRY'; payload: { id: string; index: number; date: string; num: number } }
  | { type: 'DELETE_HISTORY_ENTRY'; payload: { id: string; index: number } }
  | { type: 'ADD_HISTORY_ENTRY'; payload: { id: string; date: string; num: number } }
  | { type: 'SET_BULK_DATA'; payload: { accounts: AnyAccount[]; amountHistory: Record<string, AmountHistoryEntry[]> } };

const initialState: AccountState = {
  accounts: [],
  amountHistory: {},
};

function getTodayString(): string {
  // Local date (not toISOString, which is UTC): otherwise a balance recorded in
  // the evening of a negative-offset timezone gets stamped with tomorrow's date
  // and lands in the wrong month for the budget's historicBalance lookups.
  return formatDateForInput(new Date());
}

function accountReducer(state: AccountState, action: Action): AccountState {
  switch (action.type) {
    case 'SET_BULK_DATA':
      return {
        ...state,
        accounts: action.payload.accounts,
        amountHistory: action.payload.amountHistory,
      };

    case 'ADD_ACCOUNT': {
      const today = getTodayString();
      return {
        ...state,
        accounts: [...state.accounts, action.payload],
        amountHistory: {
          ...state.amountHistory,
          [action.payload.id]: [{ date: today, num: action.payload.amount }],
        },
      };
    }

    case 'DELETE_ACCOUNT': {
      const { [action.payload.id]: _, ...remainingHistory } = state.amountHistory;
      return {
        ...state,
        accounts: state.accounts.filter((acc) => acc.id !== action.payload.id),
        amountHistory: remainingHistory,
      };
    }

    case 'UPDATE_ACCOUNT_FIELD':
      return {
        ...state,
        accounts: state.accounts.map((acc) => {
          if (acc.id !== action.payload.id) return acc;
          const updated = Object.assign(Object.create(Object.getPrototypeOf(acc)), acc);
          updated.className = acc.constructor.name;
          updated[action.payload.field] = action.payload.value;
          return updated;
        }),
      };

    case 'ADD_AMOUNT_SNAPSHOT': {
      const { id, amount } = action.payload;
      const today = getTodayString();
      const currentHistory = state.amountHistory[id] || [];
      const lastEntry = currentHistory[currentHistory.length - 1];
      const newEntry: AmountHistoryEntry = { date: today, num: amount };

      // Replace today's entry if it exists, otherwise append
      const newHistory = lastEntry?.date === today
        ? [...currentHistory.slice(0, -1), newEntry]
        : [...currentHistory, newEntry];

      return { ...state, amountHistory: { ...state.amountHistory, [id]: newHistory } };
    }

    case 'REORDER_ACCOUNTS': {
      const result = Array.from(state.accounts);
      const [removed] = result.splice(action.payload.startIndex, 1);
      result.splice(action.payload.endIndex, 0, removed);
      return { ...state, accounts: result };
    }

    case 'UPDATE_HISTORY_ENTRY': {
      const { id, index, date, num } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      if (!history[index]) return state;
      history[index] = { ...history[index], date, num };
      return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    case 'DELETE_HISTORY_ENTRY': {
      const { id, index } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      history.splice(index, 1);
      return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    case 'ADD_HISTORY_ENTRY': {
      const { id, date, num } = action.payload;
      const history = [...(state.amountHistory[id] || []), { date, num }];
      history.sort((a, b) => a.date.localeCompare(b.date));
      return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    default:
      return state;
  }
}

function hydrateAccountState(parsed: unknown, initial: AccountState): AccountState {
  const data = parsed as { accounts?: unknown[]; amountHistory?: Record<string, AmountHistoryEntry[]> };
  const accounts = (data.accounts || [])
    .map(reconstituteAccount)
    .filter((acc): acc is AnyAccount => acc !== null);
  return {
    ...initial,
    accounts,
    amountHistory: data.amountHistory || {},
  };
}

function serializeAccountState(state: AccountState): string {
  return JSON.stringify({
    ...state,
    accounts: state.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
    version: CURRENT_SCHEMA_VERSION,
  });
}

interface AccountDispatch {
  dispatch: Dispatch<Action>;
  exportData: () => void;
  importData: (jsonData: string) => void;
}

export const AccountContext = createContext<AccountState>({
  accounts: [],
  amountHistory: {},
});

export const AccountDispatchContext = createContext<AccountDispatch>({
  dispatch: () => null,
  exportData: () => {},
  importData: () => {},
});

export function AccountProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(accountReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateAccountState,
    serialize: serializeAccountState,
  });

  // Keep latest state in a ref so exportData can read it without re-creating.
  const stateRef = useRef(state);
  stateRef.current = state;

  const exportData = useCallback(() => {
    const data = {
      version: CURRENT_SCHEMA_VERSION,
      accounts: stateRef.current.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
      amountHistory: stateRef.current.amountHistory,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stag_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
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
  }, []);

  const dispatchValue = useRef<AccountDispatch>({ dispatch, exportData, importData });

  return (
    <AccountDispatchContext.Provider value={dispatchValue.current}>
      <AccountContext.Provider value={state}>
        {children}
      </AccountContext.Provider>
    </AccountDispatchContext.Provider>
  );
}