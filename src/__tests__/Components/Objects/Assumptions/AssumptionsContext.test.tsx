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
  getRetirementAge,
  getLifeExpectancy,
  getBirthYear,
  getAgeFromMilestone,
  BUILTIN_MILESTONE_IDS,
} from '../../../../components/Objects/Assumptions/AssumptionsContext';
import { CustomMilestone } from '../../../../services/simulation/types';

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

  // Regression: PR #52 finding #1.
  // migrateAssumptions/mergeSection only copies keys present in the defaults object.
  // `demographics.priorEarnings` (imported SSA earnings history) is a saved-only field
  // absent from defaults, so it was silently dropped on every reload — breaking the SS
  // benefit projection that depends on it. (No prior test exercised priorEarnings.)
  it('preserves imported demographics.priorEarnings across a localStorage load', () => {
    const priorEarnings = [
      { year: 2010, amount: 50000 },
      { year: 2011, amount: 52000 },
    ];
    const savedState: AssumptionsState = {
      ...defaultAssumptions,
      demographics: { ...defaultAssumptions.demographics, priorEarnings },
    };
    localStorageMock.setItem('assumptions_settings', JSON.stringify(savedState));

    let loaded: AssumptionsState | undefined;
    const Capture = () => {
      loaded = useContext(AssumptionsContext).state;
      return null;
    };
    render(
      <AssumptionsProvider>
        <Capture />
      </AssumptionsProvider>
    );

    expect(loaded?.demographics.priorEarnings).toBeDefined();
    expect(loaded?.demographics.priorEarnings).toHaveLength(2);
    expect(loaded?.demographics.priorEarnings?.[0]).toMatchObject({ year: 2010, amount: 50000 });
  });

  // Regression: PR #52 finding #6.
  // A legacy "> N" End-of-Plan milestone must migrate to ">= N" (NOT ">= N+1"), so that
  // getLifeExpectancy (which returns the milestone's raw age value) stays N for both fresh
  // and migrated users. The old "+1" inflated life expectancy by a year for migrated users.
  it('migrates a legacy "> N" End-of-Plan milestone to ">= N" (life expectancy unchanged)', () => {
    const legacyMilestones = defaultAssumptions.milestones.map(m =>
      m.id === BUILTIN_MILESTONE_IDS.END_OF_PLAN
        ? { ...m, conditions: [{ type: 'AGE' as const, operator: '>' as const, value: 90 }] }
        : m
    );
    const savedState = {
      ...defaultAssumptions,
      milestones: legacyMilestones,
    } as AssumptionsState;
    localStorageMock.setItem('assumptions_settings', JSON.stringify(savedState));

    let loaded: AssumptionsState | undefined;
    const Capture = () => {
      loaded = useContext(AssumptionsContext).state;
      return null;
    };
    render(
      <AssumptionsProvider>
        <Capture />
      </AssumptionsProvider>
    );

    expect(getLifeExpectancy(loaded!.milestones)).toBe(90);
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

    it('ADD_PRIORITY_BEFORE_REMAINDER inserts above the first REMAINDER bucket', () => {
        // Regression: goal sinking-fund priorities were appended after a
        // REMAINDER bucket, which takes all surplus — so the fund never
        // received a dime in the simulation (invisible in Future charts).
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };

        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

        const fixed: PriorityBucket = { id: 'p-fixed', name: 'IRA', type: 'INVESTMENT', capType: 'MAX' };
        const remainder: PriorityBucket = { id: 'p-rem', name: 'Sweep', type: 'INVESTMENT', capType: 'REMAINDER' };
        const goalFund: PriorityBucket = { id: 'p-goal', name: 'Car fund', type: 'SAVINGS', capType: 'FIXED', capValue: 0 };

        act(() => {
            dispatch({ type: 'SET_PRIORITIES', payload: [fixed, remainder] });
        });
        act(() => {
            dispatch({ type: 'ADD_PRIORITY_BEFORE_REMAINDER', payload: goalFund });
        });

        expect(state.priorities.map(p => p.id)).toEqual(['p-fixed', 'p-goal', 'p-rem']);
    });

    it('ADD_PRIORITY_BEFORE_REMAINDER appends when no REMAINDER bucket exists', () => {
        let state!: AssumptionsState;
        let dispatch: React.Dispatch<any>;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(AssumptionsContext));
          return null;
        };

        render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

        const fixed: PriorityBucket = { id: 'p-fixed', name: 'IRA', type: 'INVESTMENT', capType: 'MAX' };
        const goalFund: PriorityBucket = { id: 'p-goal', name: 'Car fund', type: 'SAVINGS', capType: 'FIXED', capValue: 0 };

        act(() => {
            dispatch({ type: 'SET_PRIORITIES', payload: [fixed] });
        });
        act(() => {
            dispatch({ type: 'ADD_PRIORITY_BEFORE_REMAINDER', payload: goalFund });
        });

        expect(state.priorities.map(p => p.id)).toEqual(['p-fixed', 'p-goal']);
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
    it('should update birth year via milestone', () => {
      let state!: AssumptionsState;
      let dispatch: React.Dispatch<any>;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(AssumptionsContext));
        return null;
      };

      render(<AssumptionsProvider><TestComponent /></AssumptionsProvider>);

      // Update birth year via UPDATE_MILESTONE on the Birth milestone
      const birthMilestone = state.milestones.find(m => m.id === BUILTIN_MILESTONE_IDS.BIRTH);
      expect(birthMilestone).toBeDefined();

      act(() => {
        dispatch({
          type: 'UPDATE_MILESTONE',
          payload: {
            ...birthMilestone!,
            conditions: [{ type: 'YEAR', operator: '=', value: 1990 }]
          }
        });
      });

      expect(getBirthYear(state.milestones)).toBe(1990);
      // Retirement age and life expectancy are now derived from milestones
      expect(getRetirementAge(state.milestones)).toBeGreaterThan(0);
      expect(getLifeExpectancy(state.milestones)).toBeGreaterThan(0);
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
          retirementAge: 65, // Legacy field - should be migrated to milestone
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
      // Birth year is now derived from milestones
      expect(getBirthYear(state.milestones)).toBeGreaterThan(0);

      // Correct types should be preserved
      expect(state.macro.healthcareInflation).toBe(5.0);
      // retirementAge is now derived from milestones (legacy data should migrate to milestones)
      expect(getRetirementAge(state.milestones)).toBe(65);
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

  describe('getBirthYear', () => {
    it('should return year value when BIRTH milestone exists with YEAR condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.BIRTH,
          name: 'Birth',
          conditions: [{ type: 'YEAR' as const, operator: '=' as const, value: 1985 }],
        },
      ];
      expect(getBirthYear(milestones)).toBe(1985);
    });

    it('should return DEFAULT_BIRTH_YEAR when BIRTH milestone is missing', () => {
      const milestones: CustomMilestone[] = [];
      expect(getBirthYear(milestones)).toBe(1990); // DEFAULT_BIRTH_YEAR
    });

    it('should return DEFAULT_BIRTH_YEAR when BIRTH milestone has no YEAR condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.BIRTH,
          name: 'Birth',
          conditions: [{ type: 'AGE' as const, operator: '>=' as const, value: 0 }], // Wrong condition type
        },
      ];
      expect(getBirthYear(milestones)).toBe(1990); // DEFAULT_BIRTH_YEAR
    });
  });

  describe('getRetirementAge', () => {
    it('should return age value when RETIRE milestone exists with AGE condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.RETIRE,
          name: 'Retire',
          conditions: [{ type: 'AGE' as const, operator: '>=' as const, value: 60 }],
        },
      ];
      expect(getRetirementAge(milestones)).toBe(60);
    });

    it('should return DEFAULT_RETIREMENT_AGE when RETIRE milestone is missing', () => {
      const milestones: CustomMilestone[] = [];
      expect(getRetirementAge(milestones)).toBe(65); // DEFAULT_RETIREMENT_AGE
    });

    it('should return DEFAULT_RETIREMENT_AGE when RETIRE milestone has no AGE condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.RETIRE,
          name: 'Retire',
          conditions: [{ type: 'YEAR' as const, operator: '=' as const, value: 2050 }], // Wrong condition type
        },
      ];
      expect(getRetirementAge(milestones)).toBe(65); // DEFAULT_RETIREMENT_AGE
    });
  });

  describe('getLifeExpectancy', () => {
    it('should return age value when END_OF_PLAN milestone exists with AGE condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.END_OF_PLAN,
          name: 'End of Plan',
          conditions: [{ type: 'AGE' as const, operator: '>=' as const, value: 95 }],
        },
      ];
      expect(getLifeExpectancy(milestones)).toBe(95);
    });

    it('should return DEFAULT_LIFE_EXPECTANCY when END_OF_PLAN milestone is missing', () => {
      const milestones: CustomMilestone[] = [];
      expect(getLifeExpectancy(milestones)).toBe(90); // DEFAULT_LIFE_EXPECTANCY
    });

    it('should return DEFAULT_LIFE_EXPECTANCY when END_OF_PLAN milestone has no AGE condition', () => {
      const milestones = [
        {
          id: BUILTIN_MILESTONE_IDS.END_OF_PLAN,
          name: 'End of Plan',
          conditions: [{ type: 'YEAR' as const, operator: '=' as const, value: 2080 }], // Wrong condition type
        },
      ];
      expect(getLifeExpectancy(milestones)).toBe(90); // DEFAULT_LIFE_EXPECTANCY
    });
  });

  describe('getAgeFromMilestone', () => {
    it('should return age value when milestone has AGE condition', () => {
      const milestone: CustomMilestone = {
        id: 'test-milestone',
        name: 'Test',
        conditions: [{ type: 'AGE', operator: '>=', value: 55 }],
      };
      expect(getAgeFromMilestone(milestone, 99)).toBe(55);
    });

    it('should return defaultValue when milestone is undefined', () => {
      expect(getAgeFromMilestone(undefined, 42)).toBe(42);
    });

    it('should return defaultValue when milestone has no AGE condition', () => {
      const milestone: CustomMilestone = {
        id: 'test-milestone',
        name: 'Test',
        conditions: [{ type: 'YEAR', operator: '=', value: 2030 }],
      };
      expect(getAgeFromMilestone(milestone, 77)).toBe(77);
    });

    it('should return 0 when AGE condition value is 0 (not default)', () => {
      const milestone: CustomMilestone = {
        id: 'birth-milestone',
        name: 'Birth',
        conditions: [{ type: 'AGE', operator: '>=', value: 0 }],
      };
      expect(getAgeFromMilestone(milestone, 99)).toBe(0);
    });

    it('should use first AGE condition when multiple conditions exist', () => {
      const milestone: CustomMilestone = {
        id: 'multi-condition',
        name: 'Multi',
        conditions: [
          { type: 'YEAR', operator: '=', value: 2030 },
          { type: 'AGE', operator: '>=', value: 60 },
          { type: 'AGE', operator: '<=', value: 70 },
        ],
      };
      expect(getAgeFromMilestone(milestone, 99)).toBe(60); // First AGE condition
    });
  });
});
