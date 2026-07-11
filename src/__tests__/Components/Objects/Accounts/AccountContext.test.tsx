import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  AccountContext,
  AccountDispatchContext,
} from '../../../../components/Objects/Accounts/AccountContext';
import { AccountProvider } from '../../../../components/Objects/Accounts/AccountProvider';
import { SavedAccount, InvestedAccount } from '../../../../components/Objects/Accounts/models';

// Mock localStorage
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock getTodayString to return a consistent date
const MOCK_DATE = '2024-01-15';

// Build a Date at LOCAL midnight from a YYYY-MM-DD string so getTodayString()
// (which formats local time) yields the intended calendar day regardless of the
// test runner's timezone. Using new Date('2024-01-15') would be UTC midnight,
// i.e. the prior day in negative-offset zones.
const localMidnight = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
vi.mock('../../../../components/Objects/Accounts/AccountContext', async () => {
  const actual = await vi.importActual('../../../../components/Objects/Accounts/AccountContext');
  return {
    ...actual,
  };
});

describe('AccountContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    vi.setSystemTime(localMidnight(MOCK_DATE));
  });

  it('should provide initial empty state', () => {
    const captured = {} as React.ContextType<typeof AccountContext>;

    const TestComponent = () => {

        Object.assign(captured, useContext(AccountContext));

        return null;

    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(captured.accounts).toEqual([]);
    expect(captured.amountHistory).toEqual({});
  });

  it('should load state from localStorage on initialization', () => {
    const savedAccount = new SavedAccount('1', 'Savings', 1000, 2.5);
    const savedData = {
      accounts: [{ ...savedAccount, className: 'SavedAccount' }],
      amountHistory: {
        '1': [{ date: '2024-01-01', num: 1000 }],
      },
      version: 1,
    };

    localStorageMock.setItem('user_accounts_data', JSON.stringify(savedData));

    const captured = {} as React.ContextType<typeof AccountContext>;

    const TestComponent = () => {

        Object.assign(captured, useContext(AccountContext));

        return null;

    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('user_accounts_data');
    expect(captured.accounts).toHaveLength(1);
    expect(captured.accounts[0].id).toBe('1');
    expect(captured.accounts[0].name).toBe('Savings');
    expect(captured.accounts[0].amount).toBe(1000);
    expect(captured.amountHistory['1']).toEqual([{ date: '2024-01-01', num: 1000 }]);
  });

  it('should handle corrupted localStorage data gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorageMock.setItem('user_accounts_data', 'invalid json');

    const captured = {} as React.ContextType<typeof AccountContext>;

    const TestComponent = () => {

        Object.assign(captured, useContext(AccountContext));

        return null;

    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(captured.accounts).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('should save state to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

    const TestComponent = () => {

        Object.assign(capturedDispatch, useContext(AccountDispatchContext));

        return null;

    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    const newAccount = new SavedAccount('1', 'Checking', 500);

    act(() => {
      capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
    });

    // Wait for debounce (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'user_accounts_data',
      expect.stringContaining('"name":"Checking"')
    );

    vi.useRealTimers();
  });

  describe('Reducer Actions', () => {
    describe('ADD_ACCOUNT', () => {
      it('should add an account to state', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const newAccount = new SavedAccount('1', 'Savings', 1000, 2.5);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
        });

        expect(captured.accounts).toHaveLength(1);
        expect(captured.accounts[0]).toMatchObject({
          id: '1',
          name: 'Savings',
          amount: 1000,
          apr: 2.5,
        });
      });

      it('should create initial amount history entry when adding account', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const newAccount = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
        });

        expect(captured.amountHistory['1']).toHaveLength(1);
        expect(captured.amountHistory['1'][0]).toEqual({
          date: MOCK_DATE,
          num: 1000,
        });
      });
    });

    describe('DELETE_ACCOUNT', () => {
      it('should remove an account from state', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account1 = new SavedAccount('1', 'Savings', 1000);
        const account2 = new SavedAccount('2', 'Checking', 500);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account2 });
        });

        expect(captured.accounts).toHaveLength(2);

        act(() => {
          capturedDispatch.dispatch({ type: 'DELETE_ACCOUNT', payload: { id: '1' } });
        });

        expect(captured.accounts).toHaveLength(1);
        expect(captured.accounts[0].id).toBe('2');
      });

      it('should remove amount history when deleting account', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        expect(captured.amountHistory['1']).toBeDefined();

        act(() => {
          capturedDispatch.dispatch({ type: 'DELETE_ACCOUNT', payload: { id: '1' } });
        });

        expect(captured.amountHistory['1']).toBeUndefined();
      });
    });

    describe('UPDATE_ACCOUNT_FIELD', () => {
      it('should update a specific field of an account', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000, 2.5);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'name', value: 'Emergency Fund' },
          });
        });

        expect(captured.accounts[0].name).toBe('Emergency Fund');
        expect(captured.accounts[0].amount).toBe(1000);
        expect((captured.accounts[0] as SavedAccount).apr).toBe(2.5);
      });

      it('should update amount field', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'amount', value: 2000 },
          });
        });

        expect(captured.accounts[0].amount).toBe(2000);
      });

      it('should preserve className when updating', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new InvestedAccount('1', 'Roth IRA', 5000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'amount', value: 6000 },
          });
        });

        expect(captured.accounts[0].constructor.name).toBe('InvestedAccount');
      });
    });

    describe('ADD_AMOUNT_SNAPSHOT', () => {
      it('should add a new amount snapshot', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        vi.setSystemTime(localMidnight('2024-01-16'));

        act(() => {
          capturedDispatch.dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1100 },
          });
        });

        expect(captured.amountHistory['1']).toHaveLength(2);
        expect(captured.amountHistory['1'][1]).toEqual({
          date: '2024-01-16',
          num: 1100,
        });
      });

      it('should replace today\'s entry even when it is not the last in an unsorted history (#182)', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account }); // seeds today (MOCK_DATE)
        });

        // A later-dated entry pushes today's entry out of the last slot.
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-02-01', num: 2000 } });
        });

        // Snapshotting today must REPLACE today's existing entry, not append a
        // duplicate just because a last-entry check missed it.
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_AMOUNT_SNAPSHOT', payload: { id: '1', amount: 1100 } });
        });

        expect(captured.amountHistory['1']).toHaveLength(2);
        // Stays date-sorted so reverse().find() reads the latest balance.
        expect(captured.amountHistory['1'].map((e) => e.date)).toEqual([MOCK_DATE, '2024-02-01']);
        expect(captured.amountHistory['1'][0]).toEqual({ date: MOCK_DATE, num: 1100 });
      });

      it('should replace snapshot if added on same day', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        // Same day as account creation
        act(() => {
          capturedDispatch.dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        expect(captured.amountHistory['1']).toHaveLength(1);
        expect(captured.amountHistory['1'][0]).toEqual({
          date: MOCK_DATE,
          num: 1200,
        });
      });
    });

    describe('REORDER_ACCOUNTS', () => {
      it('should reorder accounts correctly', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account1 = new SavedAccount('1', 'First', 100);
        const account2 = new SavedAccount('2', 'Second', 200);
        const account3 = new SavedAccount('3', 'Third', 300);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account2 });
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account3 });
        });

        expect(captured.accounts.map((a) => a.id)).toEqual(['1', '2', '3']);

        act(() => {
          capturedDispatch.dispatch({
            type: 'REORDER_ACCOUNTS',
            payload: { startIndex: 0, endIndex: 2 },
          });
        });

        expect(captured.accounts.map((a) => a.id)).toEqual(['2', '3', '1']);
      });
    });

    describe('UPDATE_HISTORY_ENTRY', () => {
      it('should update an existing history entry', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 0, date: '2024-01-20', num: 1500 },
          });
        });

        expect(captured.amountHistory['1'][0]).toEqual({
          date: '2024-01-20',
          num: 1500,
        });
      });

      it('should re-sort the history after a date edit moves an entry out of order (#182)', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account }); // seeds MOCK_DATE (2024-01-15)
        });
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-02-01', num: 2000 } });
        });
        // history is now [2024-01-15, 2024-02-01]

        // Edit the LAST entry's date to be the earliest of the three days.
        act(() => {
          capturedDispatch.dispatch({ type: 'UPDATE_HISTORY_ENTRY', payload: { id: '1', index: 1, date: '2024-01-01', num: 2000 } });
        });

        // Must re-sort so consumers using reverse().find() don't read a stale
        // (now-misplaced) balance.
        expect(captured.amountHistory['1'].map((e) => e.date)).toEqual(['2024-01-01', MOCK_DATE]);
      });

      it('targets the entry by its pre-edit value, not a stale index, after a re-sort (#182)', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account }); // seeds 2024-01-15 / 1000
        });
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-02-01', num: 2000 } });
        });
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-03-01', num: 3000 } });
        });
        // sorted: [2024-01-15/1000, 2024-02-01/2000, 2024-03-01/3000] (indices 0,1,2)

        // Edit the index-2 entry's date to the earliest — this re-sorts it to index 0.
        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 2, prevDate: '2024-03-01', prevNum: 3000, date: '2024-01-01', num: 3000 },
          });
        });
        // sorted now: [2024-01-01/3000, 2024-01-15/1000, 2024-02-01/2000]

        // A second edit of that SAME entry arrives with a STALE index (2, from the
        // pre-sort render) but the entry's current identity (prevDate/prevNum). It
        // must hit the 2024-01-01 entry, not whatever now sits at index 2.
        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 2, prevDate: '2024-01-01', prevNum: 3000, date: '2024-01-01', num: 9999 },
          });
        });

        const byDate = Object.fromEntries(captured.amountHistory['1'].map((e) => [e.date, e.num]));
        expect(byDate['2024-01-01']).toBe(9999); // the intended entry
        expect(byDate['2024-02-01']).toBe(2000); // untouched (the stale index pointed here)
      });

      it('deletes the entry by its value, not a stale index, after a re-sort (#182)', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account }); // 2024-01-15 / 1000
        });
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-02-01', num: 2000 } });
        });
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: '1', date: '2024-03-01', num: 3000 } });
        });
        // Move the index-2 entry to the front.
        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 2, prevDate: '2024-03-01', prevNum: 3000, date: '2024-01-01', num: 3000 },
          });
        });
        // sorted: [2024-01-01/3000, 2024-01-15/1000, 2024-02-01/2000]

        // Delete that same 2024-01-01 entry using a stale index (2) + identity.
        act(() => {
          capturedDispatch.dispatch({
            type: 'DELETE_HISTORY_ENTRY',
            payload: { id: '1', index: 2, prevDate: '2024-01-01', prevNum: 3000 },
          });
        });

        const dates = captured.amountHistory['1'].map((e) => e.date);
        expect(dates).not.toContain('2024-01-01'); // the intended entry is gone
        expect(dates).toContain('2024-02-01'); // the stale-index target survives
        expect(captured.amountHistory['1']).toHaveLength(2);
      });

      it('should not update if index does not exist', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        const originalHistory = [...captured.amountHistory['1']];

        act(() => {
          capturedDispatch.dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 5, date: '2024-01-20', num: 1500 },
          });
        });

        expect(captured.amountHistory['1']).toEqual(originalHistory);
      });
    });

    describe('DELETE_HISTORY_ENTRY', () => {
      it('should delete a history entry', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        vi.setSystemTime(localMidnight('2024-01-15'));
        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          vi.setSystemTime(localMidnight('2024-01-16'));
          capturedDispatch.dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1100 },
          });
        });

        act(() => {
          vi.setSystemTime(localMidnight('2024-01-17'));
          capturedDispatch.dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        expect(captured.amountHistory['1']).toHaveLength(3);

        act(() => {
          capturedDispatch.dispatch({
            type: 'DELETE_HISTORY_ENTRY',
            payload: { id: '1', index: 1 },
          });
        });

        expect(captured.amountHistory['1']).toHaveLength(2);
        expect(captured.amountHistory['1'].map((e) => e.num)).toEqual([1000, 1200]);
      });
    });

    describe('ADD_HISTORY_ENTRY', () => {
      it('should add and sort a new history entry', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        vi.setSystemTime(localMidnight('2024-01-15'));
        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          vi.setSystemTime(localMidnight('2024-01-20'));
          capturedDispatch.dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        // Add entry with date between existing entries
        act(() => {
          capturedDispatch.dispatch({
            type: 'ADD_HISTORY_ENTRY',
            payload: { id: '1', date: '2024-01-17', num: 1100 },
          });
        });

        expect(captured.amountHistory['1']).toHaveLength(3);
        expect(captured.amountHistory['1'].map((e) => e.date)).toEqual([
          '2024-01-15',
          '2024-01-17',
          '2024-01-20',
        ]);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace all accounts and history', () => {
        const captured = {} as React.ContextType<typeof AccountContext>;
        const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

        const TestComponent = () => {

            Object.assign(captured, useContext(AccountContext));

            Object.assign(capturedDispatch, useContext(AccountDispatchContext));

            return null;

        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account1 = new SavedAccount('1', 'Old', 100);
        act(() => {
          capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
        });

        const newAccounts = [
          new SavedAccount('2', 'New Savings', 2000),
          new InvestedAccount('3', 'New IRA', 5000),
        ];
        const newHistory = {
          '2': [{ date: '2024-01-01', num: 2000 }],
          '3': [{ date: '2024-01-01', num: 5000 }],
        };

        act(() => {
          capturedDispatch.dispatch({
            type: 'SET_BULK_DATA',
            payload: { accounts: newAccounts, amountHistory: newHistory },
          });
        });

        expect(captured.accounts).toHaveLength(2);
        expect(captured.accounts[0].id).toBe('2');
        expect(captured.accounts[1].id).toBe('3');
        expect(captured.amountHistory).toEqual(newHistory);
      });
    });
  });

  describe('Export and Import functionality', () => {
    it('should export data with correct structure', () => {
      const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

      const TestComponent = () => {

          Object.assign(capturedDispatch, useContext(AccountDispatchContext));

          return null;

      };

      render(
        <AccountProvider>
          <TestComponent />
        </AccountProvider>
      );

      const account = new SavedAccount('1', 'Savings', 1000, 2.5);
      act(() => {
        capturedDispatch.dispatch({ type: 'ADD_ACCOUNT', payload: account });
      });

      // Mock URL and DOM methods
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const createElementSpy = vi.spyOn(document, 'createElement');

      act(() => {
        capturedDispatch.exportData();
      });

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(createElementSpy).toHaveBeenCalledWith('a');

      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      createElementSpy.mockRestore();
    });

    it('should import valid JSON data', () => {
      const captured = {} as React.ContextType<typeof AccountContext>;
      const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

      const TestComponent = () => {

          Object.assign(captured, useContext(AccountContext));

          Object.assign(capturedDispatch, useContext(AccountDispatchContext));

          return null;

      };

      render(
        <AccountProvider>
          <TestComponent />
        </AccountProvider>
      );

      const jsonData = JSON.stringify({
        version: 1,
        accounts: [
          {
            className: 'SavedAccount',
            id: '1',
            name: 'Imported Savings',
            amount: 3000,
            apr: 1.5,
          },
        ],
        amountHistory: {
          '1': [{ date: '2024-01-01', num: 3000 }],
        },
      });

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      act(() => {
        capturedDispatch.importData(jsonData);
      });

      expect(captured.accounts).toHaveLength(1);
      expect(captured.accounts[0].name).toBe('Imported Savings');
      expect(captured.amountHistory['1']).toEqual([{ date: '2024-01-01', num: 3000 }]);
      expect(alertSpy).toHaveBeenCalledWith('Import successful!');

      alertSpy.mockRestore();
    });

    it('should show error on invalid JSON import', () => {
      const capturedDispatch = {} as React.ContextType<typeof AccountDispatchContext>;

      const TestComponent = () => {

          Object.assign(capturedDispatch, useContext(AccountDispatchContext));

          return null;

      };

      render(
        <AccountProvider>
          <TestComponent />
        </AccountProvider>
      );

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      act(() => {
        capturedDispatch.importData('invalid json data');
      });

      expect(alertSpy).toHaveBeenCalledWith('Failed to import data. Check file format.');

      alertSpy.mockRestore();
    });
  });
});
