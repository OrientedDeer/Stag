import { createContext, useReducer, ReactNode, Dispatch, useEffect } from 'react';
import { 
    AnyAccount, 
    SavedAccount, 
    InvestedAccount, 
    PropertyAccount, 
    DebtAccount 
} from './models';

type AllKeys<T> = T extends any ? keyof T : never;
export type AllAccountKeys = AllKeys<AnyAccount>;

// Increment this whenever you make breaking changes to the data structure
const CURRENT_SCHEMA_VERSION = 1;

export interface AmountHistoryEntry {
  date: string;
  num: number;
  loan_balance?: number;
}

interface AppState {
  accounts: AnyAccount[];
  amountHistory: Record<string, AmountHistoryEntry[]>;
}

type Action =
  | { type: 'ADD_ACCOUNT'; payload: AnyAccount }
  | { type: 'DELETE_ACCOUNT'; payload: { id: string } }
  | { type: 'UPDATE_ACCOUNT_FIELD'; payload: { id: string; field: AllAccountKeys; value: any } }
  | { type: 'ADD_AMOUNT_SNAPSHOT'; payload: { id: string; amount: number } }
  | { type: 'REORDER_ACCOUNTS'; payload: { startIndex: number; endIndex: number } }
  | { type: 'UPDATE_HISTORY_ENTRY'; payload: { id: string; index: number; date: string; num: number, loan_balance?: number } }
  | { type: 'DELETE_HISTORY_ENTRY'; payload: { id: string; index: number } }
  | { type: 'ADD_HISTORY_ENTRY'; payload: { id: string; date: string; num: number, loan_balance?: number } }
  | { type: 'SET_BULK_DATA'; payload: { accounts: AnyAccount[]; amountHistory: Record<string, AmountHistoryEntry[]> } };

const getTodayString = () => new Date().toISOString().split('T')[0];
const STORAGE_KEY = 'user_accounts_data';

const initialState: AppState = {
  accounts: [],
  amountHistory: {},
};

/**
 * Robustly creates class instances from raw JSON.
 * Instead of Object.assign, we map fields explicitly and provide defaults for missing fields.
 */
export function reconstituteAccount(data: any): AnyAccount | null {
    if (!data || !data.className) return null;

    // Common base fields with defaults
    const id = data.id;
    const name = data.name || "Unnamed Account";
    const amount = Number(data.amount) || 0;

    switch (data.className) {
        case 'SavedAccount':
            return new SavedAccount(id, name, amount);
            
        case 'InvestedAccount':
            return new InvestedAccount(
                id, 
                name, 
                amount, 
                data.NonVestedAmount || 0 // Default for new field
            );
            
                case 'PropertyAccount':
                    return new PropertyAccount(
                        id,
                        name,
                        amount,
                        data.ownershipType || 'Owned',
                        data.loanAmount || 0,
                        data.startingLoanBalance || 0,
                        data.linkedAccountId
                    );            
        case 'DebtAccount':
            return new DebtAccount(
                id, 
                name, 
                amount,
                data.linkedAccountId || ''
            );
            
        default:
            console.warn(`Unknown account type: ${data.className}`);
            return null;
    }
}

const initializer = (initialState: AppState): AppState => {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (savedState) {
            const parsed = JSON.parse(savedState);
            const accounts = (parsed.accounts || [])
                .map(reconstituteAccount)
                .filter((acc: AnyAccount): acc is AnyAccount => acc !== null);

            return {
                accounts,
                amountHistory: parsed.amountHistory || {},
            };
        }
    } catch (e) {
        console.error("Could not load state:", e);
    }
    return initialState;
};

const accountReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'SET_BULK_DATA':
        return {
            ...state,
            accounts: action.payload.accounts,
            amountHistory: action.payload.amountHistory,
        };
    
    // ... (rest of your existing cases: ADD_ACCOUNT, DELETE_ACCOUNT, etc.)
    case 'ADD_ACCOUNT':
      return {
        ...state,
        accounts: [...state.accounts, action.payload],
        amountHistory: {
          ...state.amountHistory,
          [action.payload.id]: [],
        },
      };

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
          if (acc.id === action.payload.id) {
            const updatedAccount = Object.assign(Object.create(Object.getPrototypeOf(acc)), acc);
            updatedAccount.className = acc.constructor.name; 
            updatedAccount[action.payload.field] = action.payload.value;
            return updatedAccount;
          }
          return acc;
        }),
      };

    case 'ADD_AMOUNT_SNAPSHOT': {
      const { id, amount } = action.payload;
      const today = getTodayString();
      const currentHistory = state.amountHistory[id] || [];
      const lastEntry = currentHistory[currentHistory.length - 1];
      
      const newEntry: AmountHistoryEntry = { date: today, num: amount };
      const account = state.accounts.find(acc => acc.id === id);
      if (account instanceof PropertyAccount && lastEntry) {
          newEntry.loan_balance = lastEntry.loan_balance;
      }
      
      let newHistory: AmountHistoryEntry[];
      if (lastEntry && lastEntry.date === today) {
        newHistory = [...currentHistory.slice(0, -1), newEntry];
      } else {
        newHistory = [...currentHistory, newEntry];
      }
      return { ...state, amountHistory: { ...state.amountHistory, [id]: newHistory } };
    }

    case 'REORDER_ACCOUNTS': {
      const result = Array.from(state.accounts);
      const [removed] = result.splice(action.payload.startIndex, 1);
      result.splice(action.payload.endIndex, 0, removed);
      return { ...state, accounts: result };
    }

    case 'UPDATE_HISTORY_ENTRY': {
      const { id, index, date, num, loan_balance } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      if (history[index]) {
        history[index] = { ...history[index], date, num, loan_balance };
        return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
      }
      return state;
    }

    case 'DELETE_HISTORY_ENTRY': {
      const { id, index } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      history.splice(index, 1);
      return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    case 'ADD_HISTORY_ENTRY': {
        const { id, date, num, loan_balance } = action.payload;
        const newEntry: AmountHistoryEntry = { date, num };
        if (loan_balance !== undefined) {
            newEntry.loan_balance = loan_balance;
        }
        const history = [...(state.amountHistory[id] || []), newEntry];
        history.sort((a, b) => a.date.localeCompare(b.date));
        return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    default:
      return state;
  }
};

interface AccountContextProps extends AppState {
  dispatch: Dispatch<Action>;
  exportData: () => void;
  importData: (jsonData: string) => void;
}

export const AccountContext = createContext<AccountContextProps>({
  accounts: [],
  amountHistory: {},
  dispatch: () => null,
  exportData: () => {},
  importData: () => {},
});

export const AccountProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(accountReducer, initialState, initializer);

  useEffect(() => {
    const serializable = {
      ...state,
      accounts: state.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
      version: CURRENT_SCHEMA_VERSION
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }, [state]);

  const exportData = () => {
    const data = {
      version: CURRENT_SCHEMA_VERSION,
      accounts: state.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
      amountHistory: state.amountHistory,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stag_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const importData = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      // Migration logic could go here if parsed.version < CURRENT_SCHEMA_VERSION
      const accounts = (parsed.accounts || [])
        .map(reconstituteAccount)
        .filter((acc: AnyAccount | null): acc is AnyAccount => acc !== null);

      dispatch({ 
        type: 'SET_BULK_DATA', 
        payload: { accounts, amountHistory: parsed.amountHistory || {} } 
      });
      alert("Import successful!");
    } catch (e) {
      alert("Failed to import data. Check file format.");
    }
  };

  return (
    <AccountContext.Provider value={{ ...state, dispatch, exportData, importData }}>
      {children}
    </AccountContext.Provider>
  );
};