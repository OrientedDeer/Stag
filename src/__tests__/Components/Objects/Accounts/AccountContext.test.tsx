import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  AccountProvider,
  AccountContext,
} from '../../../../components/Objects/Accounts/AccountContext';
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
    vi.setSystemTime(new Date(MOCK_DATE));
  });

  it('should provide initial empty state', () => {
    let accounts!: any[];
    let amountHistory!: any;

    const TestComponent = () => {
      ({ accounts, amountHistory } = useContext(AccountContext));
      return null;
    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(accounts).toEqual([]);
    expect(amountHistory).toEqual({});
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

    let accounts!: any[];
    let amountHistory!: any;

    const TestComponent = () => {
      ({ accounts, amountHistory } = useContext(AccountContext));
      return null;
    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('user_accounts_data');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('1');
    expect(accounts[0].name).toBe('Savings');
    expect(accounts[0].amount).toBe(1000);
    expect(amountHistory['1']).toEqual([{ date: '2024-01-01', num: 1000 }]);
  });

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.setItem('user_accounts_data', 'invalid json');

    let accounts!: any[];

    const TestComponent = () => {
      ({ accounts } = useContext(AccountContext));
      return null;
    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    expect(accounts).toEqual([]);
  });

  it('should save state to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    let dispatch!: any;

    const TestComponent = () => {
      ({ dispatch } = useContext(AccountContext));
      return null;
    };

    render(
      <AccountProvider>
        <TestComponent />
      </AccountProvider>
    );

    const newAccount = new SavedAccount('1', 'Checking', 500);

    act(() => {
      dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
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
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const newAccount = new SavedAccount('1', 'Savings', 1000, 2.5);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
        });

        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toMatchObject({
          id: '1',
          name: 'Savings',
          amount: 1000,
          apr: 2.5,
        });
      });

      it('should create initial amount history entry when adding account', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const newAccount = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: newAccount });
        });

        expect(amountHistory['1']).toHaveLength(1);
        expect(amountHistory['1'][0]).toEqual({
          date: MOCK_DATE,
          num: 1000,
        });
      });
    });

    describe('DELETE_ACCOUNT', () => {
      it('should remove an account from state', () => {
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
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
          dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
          dispatch({ type: 'ADD_ACCOUNT', payload: account2 });
        });

        expect(accounts).toHaveLength(2);

        act(() => {
          dispatch({ type: 'DELETE_ACCOUNT', payload: { id: '1' } });
        });

        expect(accounts).toHaveLength(1);
        expect(accounts[0].id).toBe('2');
      });

      it('should remove amount history when deleting account', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        expect(amountHistory['1']).toBeDefined();

        act(() => {
          dispatch({ type: 'DELETE_ACCOUNT', payload: { id: '1' } });
        });

        expect(amountHistory['1']).toBeUndefined();
      });
    });

    describe('UPDATE_ACCOUNT_FIELD', () => {
      it('should update a specific field of an account', () => {
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000, 2.5);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'name', value: 'Emergency Fund' },
          });
        });

        expect(accounts[0].name).toBe('Emergency Fund');
        expect(accounts[0].amount).toBe(1000);
        expect(accounts[0].apr).toBe(2.5);
      });

      it('should update amount field', () => {
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'amount', value: 2000 },
          });
        });

        expect(accounts[0].amount).toBe(2000);
      });

      it('should preserve className when updating', () => {
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new InvestedAccount('1', 'Roth IRA', 5000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_ACCOUNT_FIELD',
            payload: { id: '1', field: 'amount', value: 6000 },
          });
        });

        expect(accounts[0].constructor.name).toBe('InvestedAccount');
      });
    });

    describe('ADD_AMOUNT_SNAPSHOT', () => {
      it('should add a new amount snapshot', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        vi.setSystemTime(new Date('2024-01-16'));

        act(() => {
          dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1100 },
          });
        });

        expect(amountHistory['1']).toHaveLength(2);
        expect(amountHistory['1'][1]).toEqual({
          date: '2024-01-16',
          num: 1100,
        });
      });

      it('should replace snapshot if added on same day', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        // Same day as account creation
        act(() => {
          dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        expect(amountHistory['1']).toHaveLength(1);
        expect(amountHistory['1'][0]).toEqual({
          date: MOCK_DATE,
          num: 1200,
        });
      });
    });

    describe('REORDER_ACCOUNTS', () => {
      it('should reorder accounts correctly', () => {
        let accounts!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, dispatch } = useContext(AccountContext));
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
          dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
          dispatch({ type: 'ADD_ACCOUNT', payload: account2 });
          dispatch({ type: 'ADD_ACCOUNT', payload: account3 });
        });

        expect(accounts.map((a) => a.id)).toEqual(['1', '2', '3']);

        act(() => {
          dispatch({
            type: 'REORDER_ACCOUNTS',
            payload: { startIndex: 0, endIndex: 2 },
          });
        });

        expect(accounts.map((a) => a.id)).toEqual(['2', '3', '1']);
      });
    });

    describe('UPDATE_HISTORY_ENTRY', () => {
      it('should update an existing history entry', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 0, date: '2024-01-20', num: 1500 },
          });
        });

        expect(amountHistory['1'][0]).toEqual({
          date: '2024-01-20',
          num: 1500,
        });
      });

      it('should not update if index does not exist', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        const originalHistory = [...amountHistory['1']];

        act(() => {
          dispatch({
            type: 'UPDATE_HISTORY_ENTRY',
            payload: { id: '1', index: 5, date: '2024-01-20', num: 1500 },
          });
        });

        expect(amountHistory['1']).toEqual(originalHistory);
      });
    });

    describe('DELETE_HISTORY_ENTRY', () => {
      it('should delete a history entry', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        vi.setSystemTime(new Date('2024-01-15'));
        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          vi.setSystemTime(new Date('2024-01-16'));
          dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1100 },
          });
        });

        act(() => {
          vi.setSystemTime(new Date('2024-01-17'));
          dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        expect(amountHistory['1']).toHaveLength(3);

        act(() => {
          dispatch({
            type: 'DELETE_HISTORY_ENTRY',
            payload: { id: '1', index: 1 },
          });
        });

        expect(amountHistory['1']).toHaveLength(2);
        expect(amountHistory['1'].map((e: any) => e.num)).toEqual([1000, 1200]);
      });
    });

    describe('ADD_HISTORY_ENTRY', () => {
      it('should add and sort a new history entry', () => {
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        vi.setSystemTime(new Date('2024-01-15'));
        const account = new SavedAccount('1', 'Savings', 1000);

        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account });
        });

        act(() => {
          vi.setSystemTime(new Date('2024-01-20'));
          dispatch({
            type: 'ADD_AMOUNT_SNAPSHOT',
            payload: { id: '1', amount: 1200 },
          });
        });

        // Add entry with date between existing entries
        act(() => {
          dispatch({
            type: 'ADD_HISTORY_ENTRY',
            payload: { id: '1', date: '2024-01-17', num: 1100 },
          });
        });

        expect(amountHistory['1']).toHaveLength(3);
        expect(amountHistory['1'].map((e: any) => e.date)).toEqual([
          '2024-01-15',
          '2024-01-17',
          '2024-01-20',
        ]);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace all accounts and history', () => {
        let accounts!: any[];
        let amountHistory!: any;
        let dispatch!: any;

        const TestComponent = () => {
          ({ accounts, amountHistory, dispatch } = useContext(AccountContext));
          return null;
        };

        render(
          <AccountProvider>
            <TestComponent />
          </AccountProvider>
        );

        const account1 = new SavedAccount('1', 'Old', 100);
        act(() => {
          dispatch({ type: 'ADD_ACCOUNT', payload: account1 });
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
          dispatch({
            type: 'SET_BULK_DATA',
            payload: { accounts: newAccounts, amountHistory: newHistory },
          });
        });

        expect(accounts).toHaveLength(2);
        expect(accounts[0].id).toBe('2');
        expect(accounts[1].id).toBe('3');
        expect(amountHistory).toEqual(newHistory);
      });
    });
  });

  describe('Export and Import functionality', () => {
    it('should export data with correct structure', () => {
      let exportData: any;
      let dispatch!: any;

      const TestComponent = () => {
        ({ exportData, dispatch } = useContext(AccountContext));
        return null;
      };

      render(
        <AccountProvider>
          <TestComponent />
        </AccountProvider>
      );

      const account = new SavedAccount('1', 'Savings', 1000, 2.5);
      act(() => {
        dispatch({ type: 'ADD_ACCOUNT', payload: account });
      });

      // Mock URL and DOM methods
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const createElementSpy = vi.spyOn(document, 'createElement');

      act(() => {
        exportData();
      });

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(createElementSpy).toHaveBeenCalledWith('a');

      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      createElementSpy.mockRestore();
    });

    it('should import valid JSON data', () => {
      let importData: any;
      let accounts!: any[];
      let amountHistory!: any;

      const TestComponent = () => {
        ({ importData, accounts, amountHistory } = useContext(AccountContext));
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
        importData(jsonData);
      });

      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Imported Savings');
      expect(amountHistory['1']).toEqual([{ date: '2024-01-01', num: 3000 }]);
      expect(alertSpy).toHaveBeenCalledWith('Import successful!');

      alertSpy.mockRestore();
    });

    it('should show error on invalid JSON import', () => {
      let importData: any;

      const TestComponent = () => {
        ({ importData } = useContext(AccountContext));
        return null;
      };

      render(
        <AccountProvider>
          <TestComponent />
        </AccountProvider>
      );

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      act(() => {
        importData('invalid json data');
      });

      expect(alertSpy).toHaveBeenCalledWith('Failed to import data. Check file format.');

      alertSpy.mockRestore();
    });
  });
});
