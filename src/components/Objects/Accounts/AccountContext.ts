import { createContext, type Dispatch } from 'react';
import { type AnyAccount, reconstituteAccount } from './models';
import { formatDateForInput, jsonDateReplacer } from '../../../utils/formatters';

type AllKeys<T> = T extends unknown ? keyof T : never;
export type AllAccountKeys = AllKeys<AnyAccount>;

export const CURRENT_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'user_accounts_data';

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
  | { type: 'UPDATE_HISTORY_ENTRY'; payload: { id: string; index: number; date: string; num: number; prevDate?: string; prevNum?: number } }
  | { type: 'DELETE_HISTORY_ENTRY'; payload: { id: string; index: number; prevDate?: string; prevNum?: number } }
  | { type: 'ADD_HISTORY_ENTRY'; payload: { id: string; date: string; num: number } }
  | { type: 'SET_BULK_DATA'; payload: { accounts: AnyAccount[]; amountHistory: Record<string, AmountHistoryEntry[]> } };

export const initialState: AccountState = {
  accounts: [],
  amountHistory: {},
};

function getTodayString(): string {
  // Local date (not toISOString, which is UTC): otherwise a balance recorded in
  // the evening of a negative-offset timezone gets stamped with tomorrow's date
  // and lands in the wrong month for the budget's historicBalance lookups.
  return formatDateForInput(new Date());
}

// Resolve which amountHistory entry an index-based edit/delete really means.
// The reducer re-sorts amountHistory by date, so an index captured by an earlier
// modal render can drift off its entry once a date edit reorders the list. When
// the caller supplies the entry's pre-edit value (prevDate/prevNum), prefer that
// identity: use the index only if it still points at that value, otherwise search
// for it. Falls back to the raw index when no identity is supplied.
function resolveHistoryTarget(
  history: AmountHistoryEntry[],
  index: number,
  prevDate?: string,
  prevNum?: number,
): number {
  if (prevDate === undefined || prevNum === undefined) return index;
  const at = history[index];
  if (at && at.date === prevDate && at.num === prevNum) return index;
  return history.findIndex(e => e.date === prevDate && e.num === prevNum);
}

export function accountReducer(state: AccountState, action: Action): AccountState {
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
      const remainingHistory = { ...state.amountHistory };
      delete remainingHistory[action.payload.id];
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
      const newEntry: AmountHistoryEntry = { date: today, num: amount };

      // Replace today's entry wherever it sits (not just the last slot: an
      // edited/imported history may not be sorted, so a last-entry-only check
      // would append a duplicate today entry). Otherwise append, then keep the
      // list date-sorted so reverse().find() consumers read the latest balance.
      const existingIdx = currentHistory.findIndex(e => e.date === today);
      const newHistory = existingIdx >= 0
        ? currentHistory.map((e, i) => (i === existingIdx ? newEntry : e))
        : [...currentHistory, newEntry];
      newHistory.sort((a, b) => a.date.localeCompare(b.date));

      return { ...state, amountHistory: { ...state.amountHistory, [id]: newHistory } };
    }

    case 'REORDER_ACCOUNTS': {
      const result = Array.from(state.accounts);
      const [removed] = result.splice(action.payload.startIndex, 1);
      result.splice(action.payload.endIndex, 0, removed);
      return { ...state, accounts: result };
    }

    case 'UPDATE_HISTORY_ENTRY': {
      const { id, index, date, num, prevDate, prevNum } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      // Resolve the target by stable identity (the entry's value BEFORE this edit),
      // not the raw array index. Because a prior date edit re-sorts the list, an
      // index captured by an earlier modal render can point at a different entry now
      // — editing history[index] blindly clobbers the wrong row. prevDate/prevNum
      // re-locate the intended entry regardless of the current order; the index is
      // only a hint / fallback for callers that don't supply an identity.
      const target = resolveHistoryTarget(history, index, prevDate, prevNum);
      if (!history[target]) return state;
      history[target] = { ...history[target], date, num };
      // A date edit can move this entry out of order; re-sort so reverse().find()
      // consumers (Networth, projectionHistory) don't read a stale balance.
      history.sort((a, b) => a.date.localeCompare(b.date));
      return { ...state, amountHistory: { ...state.amountHistory, [id]: history } };
    }

    case 'DELETE_HISTORY_ENTRY': {
      const { id, index, prevDate, prevNum } = action.payload;
      const history = [...(state.amountHistory[id] || [])];
      // Same identity resolution as UPDATE: delete the intended entry, not whatever
      // sits at a now-stale index after a re-sort.
      const target = resolveHistoryTarget(history, index, prevDate, prevNum);
      if (!history[target]) return state;
      history.splice(target, 1);
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

export function hydrateAccountState(parsed: unknown, initial: AccountState): AccountState {
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

export function serializeAccountState(state: AccountState): string {
  // jsonDateReplacer keeps Date-typed lot fields (ESPP/RSU grantDate, purchaseDate,
  // vestDate) as local YYYY-MM-DD; bare JSON.stringify would emit a UTC ISO string
  // that reloads a day earlier for UTC+ users (issue #73 on the persistence path).
  return JSON.stringify({
    ...state,
    accounts: state.accounts.map(acc => ({ ...acc, className: acc.constructor.name })),
    version: CURRENT_SCHEMA_VERSION,
  }, jsonDateReplacer);
}

export interface AccountDispatch {
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