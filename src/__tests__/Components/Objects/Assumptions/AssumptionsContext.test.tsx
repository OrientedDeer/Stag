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

  it('should save state to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    const { getByText } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    act(() => {
      getByText('Update').click();
    });

    // Wait for debounce (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'assumptions_settings',
      expect.stringContaining('"inflationRate":5')
    );

    vi.useRealTimers();
  });

  it('should handle invalid JSON from localStorage gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorageMock.setItem('assumptions_settings', 'invalid json');

    const { getByTestId } = render(
      <AssumptionsProvider>
        <TestConsumer />
      </AssumptionsProvider>
    );

    expect(getByTestId('inflation-rate').textContent).toBe(String(defaultAssumptions.macro.inflationRate));
    consoleSpy.mockRestore();
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
      expect(state.income.qualifiesForSocialSecurity).toBe(defaultAssumptions.income.qualifiesForSocialSecurity);
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
        dispatch({ type: 'UPDATE_INCOME', payload: { qualifiesForSocialSecurity: false } });
      });

      expect(state.income.qualifiesForSocialSecurity).toBe(false);
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
      expect(state.demographics.birthYear).toBe(defaultAssumptions.demographics.birthYear);
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

  describe('Migration and Error Handling', () => {
    it('should fill in missing nested fields from defaults', () => {
      // Simulate old localStorage data missing newer fields
      const oldData = {
        macro: { inflationRate: 4.0 }, // Missing healthcareInflation, inflationAdjusted
        income: { salaryGrowth: 2.0 }, // Missing qualifiesForSocialSecurity, socialSecurityFundingPercent
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(oldData));

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Saved values should be preserved
      expect(state.macro.inflationRate).toBe(4.0);
      expect(state.income.salaryGrowth).toBe(2.0);

      // Missing fields should have defaults
      expect(state.macro.healthcareInflation).toBe(defaultAssumptions.macro.healthcareInflation);
      expect(state.macro.inflationAdjusted).toBe(defaultAssumptions.macro.inflationAdjusted);
      expect(state.income.qualifiesForSocialSecurity).toBe(defaultAssumptions.income.qualifiesForSocialSecurity);
      expect(state.income.socialSecurityFundingPercent).toBe(defaultAssumptions.income.socialSecurityFundingPercent);
    });

    it('should fill in missing top-level sections with defaults', () => {
      // Simulate data missing entire sections
      const partialData = {
        macro: { inflationRate: 3.5, healthcareInflation: 4.0, inflationAdjusted: false },
        // Missing: income, expenses, investments, demographics, display
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(partialData));

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Saved section should be preserved
      expect(state.macro.inflationRate).toBe(3.5);
      expect(state.macro.inflationAdjusted).toBe(false);

      // Missing sections should have all defaults
      expect(state.income).toEqual(defaultAssumptions.income);
      expect(state.expenses).toEqual(defaultAssumptions.expenses);
      expect(state.demographics).toEqual(defaultAssumptions.demographics);
    });

    it('should handle invalid JSON gracefully', () => {
      localStorageMock.getItem.mockReturnValueOnce('not valid json {{{');

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Should fall back to defaults
      expect(state).toEqual(defaultAssumptions);
    });

    it('should handle null/undefined localStorage gracefully', () => {
      localStorageMock.getItem.mockReturnValueOnce(null);

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      expect(state).toEqual(defaultAssumptions);
    });

    it('should preserve arrays (priorities, withdrawalStrategy) from saved data', () => {
      const savedData = {
        priorities: [
          { id: 'p1', name: 'Test Priority', type: 'INVESTMENT', capType: 'MAX', capValue: 5000 }
        ],
        withdrawalStrategy: [
          { id: 'w1', name: 'Test Withdrawal', accountId: 'acc-1' }
        ],
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(savedData));

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      expect(state.priorities).toHaveLength(1);
      expect(state.priorities[0].name).toBe('Test Priority');
      expect(state.withdrawalStrategy).toHaveLength(1);
      expect(state.withdrawalStrategy[0].name).toBe('Test Withdrawal');
    });

    it('should handle wrong types by using defaults', () => {
      const badData = {
        macro: {
          inflationRate: 'not a number', // Wrong type
          healthcareInflation: 5.0,
        },
        demographics: {
          birthYear: '1995', // String instead of number
          retirementAge: 65,
        },
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(badData));

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Wrong type should fall back to default
      expect(state.macro.inflationRate).toBe(defaultAssumptions.macro.inflationRate);
      expect(state.demographics.birthYear).toBe(defaultAssumptions.demographics.birthYear);

      // Correct types should be preserved
      expect(state.macro.healthcareInflation).toBe(5.0);
      expect(state.demographics.retirementAge).toBe(65);
    });

    it('should handle deeply nested fields like returnRates', () => {
      const savedData = {
        investments: {
          withdrawalRate: 3.5,
          // Missing returnRates entirely
        },
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(savedData));

      let state!: AssumptionsState;
      const TestComponent = () => {
        ({ state } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Saved value preserved
      expect(state.investments.withdrawalRate).toBe(3.5);
      // Missing nested object gets default
      expect(state.investments.returnRates.ror).toBe(defaultAssumptions.investments.returnRates.ror);
    });
  });
});
