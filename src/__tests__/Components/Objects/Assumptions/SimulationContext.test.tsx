import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  SimulationProvider,
  SimulationContext,
} from '../../../../components/Objects/Assumptions/SimulationContext';
import { SimulationYear } from '../../../../components/Objects/Assumptions/SimulationEngine';
import { AnyAccount, DebtAccount, PropertyAccount, SavedAccount } from '../../../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../../../components/Objects/Income/models';
import { FoodExpense } from '../../../../components/Objects/Expense/models';

const calculateNetWorth = (accounts: AnyAccount[]): number => {
    return accounts.reduce((total, account) => {
        if (account instanceof DebtAccount) {
            return total - account.amount;
        }
        if (account instanceof PropertyAccount) {
            return total + account.amount - account.loanAmount;
        }
        return total + account.amount;
    }, 0);
}

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

describe('SimulationContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  it('should provide initial empty simulation state', () => {
    let simulation!: SimulationYear[];

    const TestComponent = () => {
      ({ simulation } = useContext(SimulationContext));
      return null;
    };

    render(
      <SimulationProvider>
        <TestComponent />
      </SimulationProvider>
    );

    expect(simulation).toEqual([]);
  });

  it('should load simulation from localStorage on initialization', () => {
    const account = new SavedAccount('1', 'Savings', 1000, 2.5);
    const income = new PassiveIncome('2', 'Rental', 2000, 'Monthly', 'No', 'Rental');
    const expense = new FoodExpense('3', 'Groceries', 500, 'Monthly');

    const mockSimulation: SimulationYear[] = [
      {
        year: 2024,
        accounts: [account],
        incomes: [income],
        expenses: [expense],
        cashflow: {
          totalIncome: 24000,
          totalExpense: 6000,
          discretionary: 0,
          investedUser: 0,
          investedMatch: 0,
          totalInvested: 0,
          bucketAllocations: 0,
          bucketDetail: {},
          withdrawals: 0,
          withdrawalDetail: {},
        },
        taxDetails: {
          fed: 0,
          state: 0,
          fica: 0,
          preTax: 0,
          insurance: 0,
          postTax: 0,
          capitalGains: 0,
        },
        logs: [],
      },
    ];

    const savedData = {
      simulation: mockSimulation.map((year) => ({
        ...year,
        accounts: year.accounts.map((acc) => ({ ...acc, className: acc.constructor.name })),
        incomes: year.incomes.map((inc) => ({ ...inc, className: inc.constructor.name })),
        expenses: year.expenses.map((exp) => ({ ...exp, className: exp.constructor.name })),
      })),
    };

    localStorageMock.setItem('user_simulation_data', JSON.stringify(savedData));

    let simulation!: SimulationYear[];

    const TestComponent = () => {
      ({ simulation } = useContext(SimulationContext));
      return null;
    };

    render(
      <SimulationProvider>
        <TestComponent />
      </SimulationProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('user_simulation_data');
    expect(simulation).toHaveLength(1);
    expect(simulation[0].year).toBe(2024);
    expect(simulation[0].accounts).toHaveLength(1);
    expect(simulation[0].incomes).toHaveLength(1);
    expect(simulation[0].expenses).toHaveLength(1);
  });

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.setItem('user_simulation_data', 'invalid json');

    let simulation!: SimulationYear[];

    const TestComponent = () => {
      ({ simulation } = useContext(SimulationContext));
      return null;
    };

    render(
      <SimulationProvider>
        <TestComponent />
      </SimulationProvider>
    );

    expect(simulation).toEqual([]);
  });

  it('should save simulation to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    let dispatch: any;

    const TestComponent = () => {
      ({ dispatch } = useContext(SimulationContext));
      return null;
    };

    render(
      <SimulationProvider>
        <TestComponent />
      </SimulationProvider>
    );

    const account = new SavedAccount('1', 'Savings', 1000, 2.5);
    const mockSimulation: SimulationYear[] = [
      {
        year: 2024,
        accounts: [account],
        incomes: [],
        expenses: [],
        cashflow: {
          totalIncome: 0,
          totalExpense: 0,
          discretionary: 0,
          investedUser: 0,
          investedMatch: 0,
          totalInvested: 0,
          bucketAllocations: 0,
          bucketDetail: {},
          withdrawals: 0,
          withdrawalDetail: {},
        },
        taxDetails: {
          fed: 0,
          state: 0,
          fica: 0,
          preTax: 0,
          insurance: 0,
          postTax: 0,
          capitalGains: 0,
        },
        logs: [],
      },
    ];

    act(() => {
      dispatch({ type: 'SET_SIMULATION', payload: mockSimulation });
    });

    // Wait for debounce (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'user_simulation_data',
      expect.stringContaining('"year":2024')
    );

    vi.useRealTimers();
  });

  describe('Reducer Actions', () => {
    describe('SET_SIMULATION', () => {
      it('should set simulation data', () => {
        let simulation!: SimulationYear[];
        let dispatch: any;

        const TestComponent = () => {
          ({ simulation, dispatch } = useContext(SimulationContext));
          return null;
        };

        render(
          <SimulationProvider>
            <TestComponent />
          </SimulationProvider>
        );

        expect(simulation).toEqual([]);

        const account = new SavedAccount('1', 'Savings', 1000, 2.5);
        const mockSimulation: SimulationYear[] = [
          {
            year: 2024,
            accounts: [account],
            incomes: [],
            expenses: [],
            cashflow: {
              totalIncome: 0,
              totalExpense: 0,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
        ];

        act(() => {
          dispatch({ type: 'SET_SIMULATION', payload: mockSimulation });
        });

        expect(simulation).toHaveLength(1);
        expect(simulation[0].year).toBe(2024);
        expect(calculateNetWorth(simulation[0].accounts)).toBe(1000);
      });

      it('should update simulation with multiple years', () => {
        let simulation!: SimulationYear[];
        let dispatch: any;

        const TestComponent = () => {
          ({ simulation, dispatch } = useContext(SimulationContext));
          return null;
        };

        render(
          <SimulationProvider>
            <TestComponent />
          </SimulationProvider>
        );

        const account1 = new SavedAccount('1', 'Savings', 1000, 2.5);
        const account2 = new SavedAccount('1', 'Savings', 1025, 2.5);

        const mockSimulation: SimulationYear[] = [
          {
            year: 2024,
            accounts: [account1],
            incomes: [],
            expenses: [],
            cashflow: {
              totalIncome: 0,
              totalExpense: 0,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
          {
            year: 2025,
            accounts: [account2],
            incomes: [],
            expenses: [],
            cashflow: {
              totalIncome: 0,
              totalExpense: 0,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
        ];

        act(() => {
          dispatch({ type: 'SET_SIMULATION', payload: mockSimulation });
        });

        expect(simulation).toHaveLength(2);
        expect(simulation[0].year).toBe(2024);
        expect(simulation[1].year).toBe(2025);
        expect(calculateNetWorth(simulation[1].accounts)).toBe(1025);
      });

      it('should clear simulation when empty array is provided', () => {
        let simulation!: SimulationYear[];
        let dispatch: any;

        const TestComponent = () => {
          ({ simulation, dispatch } = useContext(SimulationContext));
          return null;
        };

        render(
          <SimulationProvider>
            <TestComponent />
          </SimulationProvider>
        );

        const mockSimulation: SimulationYear[] = [
          {
            year: 2024,
            accounts: [],
            incomes: [],
            expenses: [],
            cashflow: {
              totalIncome: 0,
              totalExpense: 0,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
        ];

        act(() => {
          dispatch({ type: 'SET_SIMULATION', payload: mockSimulation });
        });

        expect(simulation).toHaveLength(1);

        act(() => {
          dispatch({ type: 'SET_SIMULATION', payload: [] });
        });

        expect(simulation).toEqual([]);
      });
    });
  });

  describe('Data reconstitution', () => {
    it('should reconstitute accounts, incomes, and expenses with proper class instances', () => {
      const savedData = {
        simulation: [
          {
            year: 2024,
            accounts: [
              {
                className: 'SavedAccount',
                id: '1',
                name: 'Savings',
                amount: 1000,
                apr: 2.5,
              },
            ],
            incomes: [
              {
                className: 'PassiveIncome',
                id: '1',
                name: 'Rental',
                amount: 2000,
                frequency: 'Monthly',
                earned_income: 'No',
              },
            ],
            expenses: [
              {
                className: 'FoodExpense',
                id: '1',
                name: 'Groceries',
                amount: 500,
                frequency: 'Monthly',
              },
            ],
            cashflow: {
              totalIncome: 24000,
              totalExpense: 6000,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
        ],
      };

      localStorageMock.setItem('user_simulation_data', JSON.stringify(savedData));

      let simulation!: SimulationYear[];

      const TestComponent = () => {
        ({ simulation } = useContext(SimulationContext));
        return null;
      };

      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );

      expect(simulation[0].accounts[0].constructor.name).toBe('SavedAccount');
      expect(simulation[0].incomes[0].constructor.name).toBe('PassiveIncome');
      expect(simulation[0].expenses[0].constructor.name).toBe('FoodExpense');
    });

    it('should filter out invalid objects during reconstitution', () => {
      const savedData = {
        simulation: [
          {
            year: 2024,
            accounts: [
              {
                className: 'SavedAccount',
                id: '1',
                name: 'Savings',
                amount: 1000,
                apr: 2.5,
              },
              {
                className: 'InvalidAccount',
                id: '2',
                name: 'Invalid',
                amount: 500,
              },
            ],
            incomes: [],
            expenses: [],
            cashflow: {
              totalIncome: 0,
              totalExpense: 0,
              discretionary: 0,
              investedUser: 0,
              investedMatch: 0,
              totalInvested: 0,
              bucketAllocations: 0,
              bucketDetail: {},
              withdrawals: 0,
              withdrawalDetail: {},
            },
            taxDetails: {
              fed: 0,
              state: 0,
              fica: 0,
              preTax: 0,
              insurance: 0,
              postTax: 0,
              capitalGains: 0,
            },
            logs: [],
          },
        ],
      };

      localStorageMock.setItem('user_simulation_data', JSON.stringify(savedData));

      let simulation!: SimulationYear[];

      const TestComponent = () => {
        ({ simulation } = useContext(SimulationContext));
        return null;
      };

      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );

      // Should only have the valid SavedAccount
      expect(simulation[0].accounts).toHaveLength(1);
      expect(simulation[0].accounts[0].id).toBe('1');
    });
  });

  describe('localStorage serialization', () => {
    it('should save className metadata for all objects (debounced)', async () => {
      vi.useFakeTimers();
      let dispatch: any;

      const TestComponent = () => {
        ({ dispatch } = useContext(SimulationContext));
        return null;
      };

      render(
        <SimulationProvider>
          <TestComponent />
        </SimulationProvider>
      );

      const account = new SavedAccount('1', 'Savings', 1000, 2.5);
      const income = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');
      const expense = new FoodExpense('1', 'Groceries', 500, 'Monthly');

      const mockSimulation: SimulationYear[] = [
        {
          year: 2024,
          accounts: [account],
          incomes: [income],
          expenses: [expense],
          cashflow: {
            totalIncome: 24000,
            totalExpense: 6000,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
          },
          taxDetails: {
            fed: 0,
            state: 0,
            fica: 0,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
          },
          logs: [],
        },
      ];

      act(() => {
        dispatch({ type: 'SET_SIMULATION', payload: mockSimulation });
      });

      // Wait for debounce (500ms)
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      // Find the last call that saved to user_simulation_data
      const relevantCalls = localStorageMock.setItem.mock.calls.filter(
        (call) => call[0] === 'user_simulation_data'
      );
      const savedData = JSON.parse(relevantCalls[relevantCalls.length - 1][1]);

      expect(savedData.simulation[0].accounts[0].className).toBe('SavedAccount');
      expect(savedData.simulation[0].incomes[0].className).toBe('PassiveIncome');
      expect(savedData.simulation[0].expenses[0].className).toBe('FoodExpense');

      vi.useRealTimers();
    });
  });
});
