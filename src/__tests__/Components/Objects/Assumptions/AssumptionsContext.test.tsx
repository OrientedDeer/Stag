import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useContext } from 'react';

import {
  AssumptionsProvider,
  AssumptionsContext,
  defaultAssumptions,
  AssumptionsState,
  PriorityBucket,
  WithdrawalBucket,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';

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

const TestConsumer = () => {
  const { state, dispatch } = useContext(AssumptionsContext);

  const updateInflation = () => {
    dispatch({ type: 'UPDATE_MACRO', payload: { inflationRate: 5.0 } });
  };

  return (
    <div>
      <span data-testid="inflation-rate">{state.macro.inflationRate}</span>
      <button onClick={updateInflation}>Update</button>
    </div>
  );
};

describe('AssumptionsContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  it('should provide default assumptions state', () => {
    const { getByTestId } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    expect(getByTestId('inflation-rate').textContent).toBe(String(defaultAssumptions.macro.inflationRate));
  });

  it('should update state when an action is dispatched', () => {
    const { getByTestId, getByText } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    act(() => {
      getByText('Update').click();
    });

    expect(getByTestId('inflation-rate').textContent).toBe('5');
  });

  it('should load state from localStorage on initial render', () => {
    const savedState: AssumptionsState = {
      ...defaultAssumptions,
      macro: { ...defaultAssumptions.macro, inflationRate: 10.0 },
    };
    localStorageMock.setItem('assumptions_settings', JSON.stringify(savedState));

    const { getByTestId } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('assumptions_settings');
    expect(getByTestId('inflation-rate').textContent).toBe('10');
  });

  it('should save state to localStorage when state changes', () => {
    const { getByText } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    act(() => {
      getByText('Update').click();
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'assumptions_settings',
      expect.stringContaining('"inflationRate":5')
    );
  });

  it('should handle invalid JSON from localStorage gracefully', () => {
    localStorageMock.setItem('assumptions_settings', 'invalid json');

    const { getByTestId } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    expect(getByTestId('inflation-rate').textContent).toBe(String(defaultAssumptions.macro.inflationRate));
  });

  // Priorities Reducer Tests
  describe('Priorities Reducer Actions', () => {
    it('should add a priority', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      const newPriority: PriorityBucket = { id: '1', name: 'Test', type: 'INVESTMENT', capType: 'MAX' };

      act(() => {
        dispatch({ type: 'ADD_PRIORITY', payload: newPriority });
      });

      expect(state.priorities).toContainEqual(newPriority);
    });

    it('should remove a priority', () => {
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;
  
        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };
        
        const initialPriority: PriorityBucket = { id: '1', name: 'Test', type: 'INVESTMENT', capType: 'MAX' };
        
        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);
        
        act(() => {
            dispatch({ type: 'ADD_PRIORITY', payload: initialPriority });
        });
        
        act(() => {
          dispatch({ type: 'REMOVE_PRIORITY', payload: '1' });
        });
  
        expect(state.priorities).not.toContainEqual(initialPriority);
    });

    it('should update a priority', () => {
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;
  
        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };
        
        const initialPriority: PriorityBucket = { id: '1', name: 'Test', type: 'INVESTMENT', capType: 'MAX' };
        const updatedPriority: PriorityBucket = { id: '1', name: 'Updated Test', type: 'INVESTMENT', capType: 'FIXED', capValue: 100 };

        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

        act(() => {
            dispatch({ type: 'ADD_PRIORITY', payload: initialPriority });
        });
        
        act(() => {
          dispatch({ type: 'UPDATE_PRIORITY', payload: updatedPriority });
        });
  
        expect(state.priorities).toContainEqual(updatedPriority);
        expect(state.priorities).not.toContainEqual(initialPriority);
    });
  });

  // Withdrawal Strategy Reducer Tests
  describe('Withdrawal Strategy Reducer Actions', () => {
    it('should add a withdrawal strategy item', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      const newWithdrawalItem: WithdrawalBucket = { id: 'wd-1', name: 'Emergency Fund', accountId: 'acc-1' };

      act(() => {
        dispatch({ type: 'ADD_WITHDRAWAL_STRATEGY', payload: newWithdrawalItem });
      });

      expect(state.withdrawalStrategy).toContainEqual(newWithdrawalItem);
    });

    it('should remove a withdrawal strategy item', () => {
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;
  
        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };

        const initialItem: WithdrawalBucket = { id: 'wd-1', name: 'Emergency Fund', accountId: 'acc-1' };
        
        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

        act(() => {
            dispatch({ type: 'ADD_WITHDRAWAL_STRATEGY', payload: initialItem });
        });
        
        act(() => {
          dispatch({ type: 'REMOVE_WITHDRAWAL_STRATEGY', payload: 'wd-1' });
        });
  
        expect(state.withdrawalStrategy).not.toContainEqual(initialItem);
    });

    it('should update a withdrawal strategy item', () => {
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;
  
        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };

        const initialItem: WithdrawalBucket = { id: 'wd-1', name: 'Emergency Fund', accountId: 'acc-1' };
        const updatedItem: WithdrawalBucket = { id: 'wd-1', name: 'Brokerage', accountId: 'acc-2' };

        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);
        
        act(() => {
            dispatch({ type: 'ADD_WITHDRAWAL_STRATEGY', payload: initialItem });
        });
        
        act(() => {
          dispatch({ type: 'UPDATE_WITHDRAWAL_STRATEGY', payload: updatedItem });
        });
  
        expect(state.withdrawalStrategy).toContainEqual(updatedItem);
        expect(state.withdrawalStrategy).not.toContainEqual(initialItem);
    });
  });

  it('should reset to default settings', () => {
    let state!: AssumptionsState;
    let dispatch: React.Dispatch<any>;

    const TestComponent = () => {
      ({ state, dispatch } = useContext(AssumptionsContext));
      return null;
    };

    render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

    act(() => {
      dispatch({ type: 'UPDATE_MACRO', payload: { inflationRate: 99 } });
    });

    expect(state.macro.inflationRate).toBe(99);

    act(() => {
      dispatch({ type: 'RESET_DEFAULTS' });
    });

    expect(state).toEqual(defaultAssumptions);
  });

  describe('Income Reducer Actions', () => {
    it('should update income settings', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_INCOME', payload: { salaryGrowth: 4.5 } });
      });

      expect(state.income.salaryGrowth).toBe(4.5);
      expect(state.income.socialSecurityStartAge).toBe(defaultAssumptions.income.socialSecurityStartAge);
    });

    it('should update social security start age', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_INCOME', payload: { socialSecurityStartAge: 70 } });
      });

      expect(state.income.socialSecurityStartAge).toBe(70);
    });
  });

  describe('Expenses Reducer Actions', () => {
    it('should update expense settings', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_EXPENSES', payload: { lifestyleCreep: 30.0, housingAppreciation: 4.0 } });
      });

      expect(state.expenses.lifestyleCreep).toBe(30.0);
      expect(state.expenses.housingAppreciation).toBe(4.0);
      expect(state.expenses.rentInflation).toBe(defaultAssumptions.expenses.rentInflation);
    });
  });

  describe('Investments Reducer Actions', () => {
    it('should update investment settings', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_INVESTMENTS', payload: { withdrawalStrategy: 'Percentage' as const, withdrawalRate: 3.5 } });
      });

      expect(state.investments.withdrawalStrategy).toBe('Percentage');
      expect(state.investments.withdrawalRate).toBe(3.5);
    });

    it('should update investment return rates', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_INVESTMENT_RATES', payload: { ror: 8.5 } });
      });

      expect(state.investments.returnRates.ror).toBe(8.5);
    });
  });

  describe('Demographics Reducer Actions', () => {
    it('should update demographics settings', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      act(() => {
        dispatch({ type: 'UPDATE_DEMOGRAPHICS', payload: { retirementAge: 70, lifeExpectancy: 95 } });
      });

      expect(state.demographics.retirementAge).toBe(70);
      expect(state.demographics.lifeExpectancy).toBe(95);
      expect(state.demographics.startAge).toBe(defaultAssumptions.demographics.startAge);
    });
  });

  describe('Bulk Data Actions', () => {
    it('should set bulk data replacing entire state', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      const newState: AssumptionsState = {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationRate: 15.0 },
        income: { ...defaultAssumptions.income, salaryGrowth: 10.0 },
      };

      act(() => {
        dispatch({ type: 'SET_BULK_DATA', payload: newState });
      });

      expect(state.macro.inflationRate).toBe(15.0);
      expect(state.income.salaryGrowth).toBe(10.0);
    });

    it('should set priorities in bulk', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      const priorities: PriorityBucket[] = [
        { id: 'p1', name: 'Priority 1', type: 'INVESTMENT', capType: 'MAX', capValue: 1000 },
        { id: 'p2', name: 'Priority 2', type: 'SAVINGS', capType: 'FIXED', capValue: 500 },
      ];

      act(() => {
        dispatch({ type: 'SET_PRIORITIES', payload: priorities });
      });

      expect(state.priorities).toHaveLength(2);
      expect(state.priorities).toEqual(priorities);
    });

    it('should set withdrawal strategy in bulk', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      const withdrawalStrategy: WithdrawalBucket[] = [
        { id: 'w1', name: 'Emergency Fund', accountId: 'acc-1' },
        { id: 'w2', name: 'Brokerage', accountId: 'acc-2' },
      ];

      act(() => {
        dispatch({ type: 'SET_WITHDRAWAL_STRATEGY', payload: withdrawalStrategy });
      });

      expect(state.withdrawalStrategy).toHaveLength(2);
      expect(state.withdrawalStrategy).toEqual(withdrawalStrategy);
    });
  });
});
