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

interface BalanceHistoryEntry {
  date: string;
  amount: number;
}

interface AppState {
  accounts: AnyAccount[];
  balanceHistory: Record<string, BalanceHistoryEntry[]>;
}

type Action =
  | { type: 'ADD_ACCOUNT'; payload: AnyAccount }
  | { type: 'DELETE_ACCOUNT'; payload: { id: string } }
  | { type: 'UPDATE_ACCOUNT_FIELD'; payload: { id: string; field: AllAccountKeys; value: any } }
  | { type: 'ADD_BALANCE_SNAPSHOT'; payload: { id: string; balance: number } };

const getTodayString = () => new Date().toISOString().split('T')[0];

const STORAGE_KEY = 'user_accounts_data';
const initialState: AppState = {
  accounts: [],
  balanceHistory: {},
};

function reconstituteAccount(accountData: any): AnyAccount | null {
    if (!accountData || !accountData.className) return null;
    switch (accountData.className) {
        case 'SavedAccount':
            return Object.assign(new SavedAccount(
                accountData.id, 
                accountData.name, 
                accountData.balance
            ), accountData);
        case 'InvestedAccount':
            return Object.assign(new InvestedAccount(
                accountData.id, 
                accountData.name, 
                accountData.balance, 
                accountData.vestedBalance
            ), accountData);
        case 'PropertyAccount':
            return Object.assign(new PropertyAccount(
                accountData.id, 
                accountData.name, 
                accountData.balance, 
                accountData.ownershipType, 
                accountData.loanBalance, 
                accountData.apr, 
                accountData.interestType, 
                accountData.monthlyPayment
            ), accountData);
        case 'DebtAccount':
            return Object.assign(new DebtAccount(
                accountData.id, 
                accountData.name, 
                accountData.balance, 
                accountData.apr, 
                accountData.interestType, 
                accountData.monthlyPayment
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
        balanceHistory: {
          ...state.balanceHistory,
          [action.payload.id]: [],
        },
      };

    case 'DELETE_ACCOUNT': {
      const { [action.payload.id]: _, ...remainingHistory } = state.balanceHistory;
      return {
        ...state,
        accounts: state.accounts.filter((acc) => acc.id !== action.payload.id),
        balanceHistory: remainingHistory,
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

    case 'ADD_BALANCE_SNAPSHOT': {
      const { id, balance } = action.payload;
      const today = getTodayString();
      
      const currentHistory = state.balanceHistory[id] || [];
      const lastEntry = currentHistory[currentHistory.length - 1];

      let newHistory: BalanceHistoryEntry[];

      if (lastEntry && lastEntry.date === today) {
        newHistory = [
          ...currentHistory.slice(0, -1),
          { date: today, amount: balance }
        ];
      } else {
        newHistory = [
          ...currentHistory,
          { date: today, amount: balance }
        ];
      }

      return {
        ...state,
        balanceHistory: {
          ...state.balanceHistory,
          [id]: newHistory,
        },
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
  balanceHistory: {},
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