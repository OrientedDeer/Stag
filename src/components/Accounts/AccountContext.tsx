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

interface AmountHistoryEntry {
  date: string;
  num: number;
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
  | { type: 'UPDATE_HISTORY_ENTRY'; payload: { id: string; index: number; date: string; num: number } }
  | { type: 'DELETE_HISTORY_ENTRY'; payload: { id: string; index: number } }
  | { type: 'ADD_HISTORY_ENTRY'; payload: { id: string; date: string; num: number } };

const getTodayString = () => new Date().toISOString().split('T')[0];

const STORAGE_KEY = 'user_accounts_data';
const initialState: AppState = {
  accounts: [],
  amountHistory: {},
};

function reconstituteAccount(accountData: any): AnyAccount | null {
    if (!accountData || !accountData.className) return null;
    switch (accountData.className) {
        case 'SavedAccount':
            return Object.assign(new SavedAccount(
                accountData.id, 
                accountData.name, 
                accountData.amount
            ), accountData);
        case 'InvestedAccount':
            return Object.assign(new InvestedAccount(
                accountData.id, 
                accountData.name, 
                accountData.amount, 
                accountData.vestedAmount
            ), accountData);
        case 'PropertyAccount':
            return Object.assign(new PropertyAccount(
                accountData.id, 
                accountData.name, 
                accountData.amount, 
                accountData.ownershipType, 
                accountData.loanAmount, 
            ), accountData);
        case 'DebtAccount':
            return Object.assign(new DebtAccount(
                accountData.id, 
                accountData.name, 
                accountData.amount,
                accountData.linkedAccountId
            ), accountData);
        default:
            console.warn(`Unknown account type: ${accountData.className}`);
            return null;
    }
}

const initializer = (initialState: AppState): AppState => {
    try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        if (savedState) {
            const parsedState: AppState = JSON.parse(savedState);
            
            const reconstitutedAccounts = parsedState.accounts
                .map(reconstituteAccount)
                .filter((acc): acc is AnyAccount => acc !== null);

            return {
                ...parsedState,
                accounts: reconstitutedAccounts,
            };
        }
    } catch (e) {
        console.error("Could not load state from localStorage:", e);
    }
    return initialState;
};

const accountReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
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

      let newHistory: AmountHistoryEntry[];

      if (lastEntry && lastEntry.date === today) {
        newHistory = [
          ...currentHistory.slice(0, -1),
          { date: today, num: amount }
        ];
      } else {
        newHistory = [
          ...currentHistory,
          { date: today, num: amount }
        ];
      }

      return {
        ...state,
        amountHistory: {
          ...state.amountHistory,
          [id]: newHistory,
        },
      };
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
      if (history[index]) {
        history[index] = { date, num };
        return {
          ...state,
          amountHistory: { ...state.amountHistory, [id]: history },
        };
      }
      return state;
    }

    case 'DELETE_HISTORY_ENTRY': {
      const { id, index } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      history.splice(index, 1);
      return {
        ...state,
        amountHistory: { ...state.amountHistory, [id]: history },
      };
    }

    case 'ADD_HISTORY_ENTRY': {
      const { id, date, num } = action.payload;
      // Add and then sort by date to keep the chart logical
      const history = [...(state.amountHistory[id] || []), { date, num }];
      history.sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...state,
        amountHistory: { ...state.amountHistory, [id]: history },
      };
    }

    default:
      return state;
  }
};

interface AccountContextProps extends AppState {
  dispatch: Dispatch<Action>;
}

export const AccountContext = createContext<AccountContextProps>({
  accounts: [],
  amountHistory: {},
  dispatch: () => null,
});

export const AccountProvider = ({ children }: { children: ReactNode }) => {
    const [state, dispatch] = useReducer(accountReducer, initialState, initializer);
    useEffect(() => {
        try {
            const serializableState = {
                ...state,
                accounts: state.accounts.map(acc => ({
                    ...acc,
                    className: acc.constructor.name,
                }))
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
        } catch (e) {
            console.error("Could not save state to localStorage:", e);
        }
    }, [state]);

  return (
    <AccountContext.Provider value={{ ...state, dispatch }}>
      {children}
    </AccountContext.Provider>
  );
};