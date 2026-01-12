import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  ExpenseProvider,
  ExpenseContext,
} from '../../../../components/Objects/Expense/ExpenseContext';
import { RentExpense, FoodExpense, OtherExpense } from '../../../../components/Objects/Expense/models';

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

describe('ExpenseContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  it('should provide initial empty state', () => {
    let expenses!: any[];

    const TestComponent = () => {
      ({ expenses } = useContext(ExpenseContext));
      return null;
    };

    render(
      <ExpenseProvider>
        <TestComponent />
      </ExpenseProvider>
    );

    expect(expenses).toEqual([]);
  });

  it('should load state from localStorage on initialization', () => {
    const savedExpense = new RentExpense('1', 'Apartment Rent', 1500, 200, 'Monthly');
    const savedData = {
      expenses: [{ ...savedExpense, className: 'RentExpense' }],
    };

    localStorageMock.setItem('user_expenses_data', JSON.stringify(savedData));

    let expenses!: any[];

    const TestComponent = () => {
      ({ expenses } = useContext(ExpenseContext));
      return null;
    };

    render(
      <ExpenseProvider>
        <TestComponent />
      </ExpenseProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('user_expenses_data');
    expect(expenses).toHaveLength(1);
    expect(expenses[0].id).toBe('1');
    expect(expenses[0].name).toBe('Apartment Rent');
    expect(expenses[0].payment).toBe(1500);
  });

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.setItem('user_expenses_data', 'invalid json');

    let expenses!: any[];

    const TestComponent = () => {
      ({ expenses } = useContext(ExpenseContext));
      return null;
    };

    render(
      <ExpenseProvider>
        <TestComponent />
      </ExpenseProvider>
    );

    expect(expenses).toEqual([]);
  });

  it('should save state to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    let dispatch!: any;

    const TestComponent = () => {
      ({ dispatch } = useContext(ExpenseContext));
      return null;
    };

    render(
      <ExpenseProvider>
        <TestComponent />
      </ExpenseProvider>
    );

    const newExpense = new FoodExpense('1', 'Groceries', 500, 'Monthly');

    act(() => {
      dispatch({ type: 'ADD_EXPENSE', payload: newExpense });
    });

    // Wait for debounce (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'user_expenses_data',
      expect.stringContaining('"name":"Groceries"')
    );

    vi.useRealTimers();
  });

  describe('Reducer Actions', () => {
    describe('ADD_EXPENSE', () => {
      it('should add an expense to state', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const newExpense = new FoodExpense('1', 'Groceries', 500, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: newExpense });
        });

        expect(expenses).toHaveLength(1);
        expect(expenses[0]).toMatchObject({
          id: '1',
          name: 'Groceries',
          amount: 500,
          frequency: 'Monthly',
        });
      });

      it('should add multiple expenses', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'Groceries', 500, 'Monthly');
        const expense2 = new RentExpense('2', 'Rent', 1500, 200, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense2 });
        });

        expect(expenses).toHaveLength(2);
      });
    });

    describe('DELETE_EXPENSE', () => {
      it('should remove an expense from state', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'Groceries', 500, 'Monthly');
        const expense2 = new OtherExpense('2', 'Entertainment', 200, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense2 });
        });

        expect(expenses).toHaveLength(2);

        act(() => {
          dispatch({ type: 'DELETE_EXPENSE', payload: { id: '1' } });
        });

        expect(expenses).toHaveLength(1);
        expect(expenses[0].id).toBe('2');
      });
    });

    describe('UPDATE_EXPENSE_FIELD', () => {
      it('should update a specific field of an expense', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense = new FoodExpense('1', 'Groceries', 500, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_EXPENSE_FIELD',
            payload: { id: '1', field: 'name', value: 'Whole Foods' },
          });
        });

        expect(expenses[0].name).toBe('Whole Foods');
        expect(expenses[0].amount).toBe(500);
      });

      it('should update amount field', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense = new FoodExpense('1', 'Groceries', 500, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_EXPENSE_FIELD',
            payload: { id: '1', field: 'amount', value: 600 },
          });
        });

        expect(expenses[0].amount).toBe(600);
      });

      it('should recalculate RentExpense amount when payment or utilities change', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const rentExpense = new RentExpense('1', 'Apartment', 1500, 200, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: rentExpense });
        });

        expect(expenses[0].amount).toBe(1700);

        act(() => {
          dispatch({
            type: 'UPDATE_EXPENSE_FIELD',
            payload: { id: '1', field: 'payment', value: 1600 },
          });
        });

        expect(expenses[0].payment).toBe(1600);
        expect(expenses[0].amount).toBe(1800); // 1600 + 200
      });

      it('should recalculate RentExpense amount when utilities change', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const rentExpense = new RentExpense('1', 'Apartment', 1500, 200, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: rentExpense });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_EXPENSE_FIELD',
            payload: { id: '1', field: 'utilities', value: 250 },
          });
        });

        expect(expenses[0].utilities).toBe(250);
        expect(expenses[0].amount).toBe(1750); // 1500 + 250
      });

      it('should preserve expense class type when updating', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const rentExpense = new RentExpense('1', 'Apartment', 1500, 200, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: rentExpense });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_EXPENSE_FIELD',
            payload: { id: '1', field: 'name', value: 'Downtown Apartment' },
          });
        });

        expect(expenses[0].constructor.name).toBe('RentExpense');
      });
    });

    describe('REORDER_EXPENSES', () => {
      it('should reorder expenses correctly', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'First', 100, 'Monthly');
        const expense2 = new FoodExpense('2', 'Second', 200, 'Monthly');
        const expense3 = new FoodExpense('3', 'Third', 300, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense2 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense3 });
        });

        expect(expenses.map((e) => e.id)).toEqual(['1', '2', '3']);

        act(() => {
          dispatch({
            type: 'REORDER_EXPENSES',
            payload: { startIndex: 0, endIndex: 2 },
          });
        });

        expect(expenses.map((e) => e.id)).toEqual(['2', '3', '1']);
      });

      it('should move expense from end to beginning', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'First', 100, 'Monthly');
        const expense2 = new FoodExpense('2', 'Second', 200, 'Monthly');
        const expense3 = new FoodExpense('3', 'Third', 300, 'Monthly');

        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense2 });
          dispatch({ type: 'ADD_EXPENSE', payload: expense3 });
        });

        act(() => {
          dispatch({
            type: 'REORDER_EXPENSES',
            payload: { startIndex: 2, endIndex: 0 },
          });
        });

        expect(expenses.map((e) => e.id)).toEqual(['3', '1', '2']);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace all expenses', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'Old Expense', 100, 'Monthly');
        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
        });

        expect(expenses).toHaveLength(1);

        const newExpenses = [
          new FoodExpense('2', 'New Groceries', 500, 'Monthly'),
          new RentExpense('3', 'New Rent', 1500, 200, 'Monthly'),
        ];

        act(() => {
          dispatch({
            type: 'SET_BULK_DATA',
            payload: { expenses: newExpenses },
          });
        });

        expect(expenses).toHaveLength(2);
        expect(expenses[0].id).toBe('2');
        expect(expenses[1].id).toBe('3');
      });

      it('should clear all expenses when bulk data is empty', () => {
        let expenses!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ expenses, dispatch } = useContext(ExpenseContext));
          return null;
        };

        render(
          <ExpenseProvider>
            <TestComponent />
          </ExpenseProvider>
        );

        const expense1 = new FoodExpense('1', 'Groceries', 500, 'Monthly');
        act(() => {
          dispatch({ type: 'ADD_EXPENSE', payload: expense1 });
        });

        expect(expenses).toHaveLength(1);

        act(() => {
          dispatch({
            type: 'SET_BULK_DATA',
            payload: { expenses: [] },
          });
        });

        expect(expenses).toEqual([]);
      });
    });
  });

  describe('localStorage persistence', () => {
    it('should reconstitute expenses from localStorage with className', () => {
      const expenseData = {
        expenses: [
          {
            className: 'RentExpense',
            id: '1',
            name: 'Apartment',
            payment: 1500,
            utilities: 200,
            amount: 1700,
            frequency: 'Monthly',
          },
          {
            className: 'FoodExpense',
            id: '2',
            name: 'Groceries',
            amount: 500,
            frequency: 'Monthly',
          },
        ],
      };

      localStorageMock.setItem('user_expenses_data', JSON.stringify(expenseData));

      let expenses!: any[];

      const TestComponent = () => {
        ({ expenses } = useContext(ExpenseContext));
        return null;
      };

      render(
        <ExpenseProvider>
          <TestComponent />
        </ExpenseProvider>
      );

      expect(expenses).toHaveLength(2);
      expect(expenses[0].constructor.name).toBe('RentExpense');
      expect(expenses[1].constructor.name).toBe('FoodExpense');
    });

    it('should filter out null expenses from reconstitution', () => {
      const expenseData = {
        expenses: [
          {
            className: 'RentExpense',
            id: '1',
            name: 'Apartment',
            payment: 1500,
            utilities: 200,
            frequency: 'Monthly',
          },
          {
            className: 'InvalidExpenseType',
            id: '2',
            name: 'Invalid',
            amount: 500,
          },
        ],
      };

      localStorageMock.setItem('user_expenses_data', JSON.stringify(expenseData));

      let expenses!: any[];

      const TestComponent = () => {
        ({ expenses } = useContext(ExpenseContext));
        return null;
      };

      render(
        <ExpenseProvider>
          <TestComponent />
        </ExpenseProvider>
      );

      // Should only have valid expense
      expect(expenses).toHaveLength(1);
      expect(expenses[0].id).toBe('1');
    });
  });
});
