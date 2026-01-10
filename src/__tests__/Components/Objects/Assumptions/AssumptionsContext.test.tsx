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
});
