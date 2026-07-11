import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  TaxContext,
  TaxState,
} from '../../../../components/Objects/Taxes/TaxContext';
import { TaxProvider } from '../../../../components/Objects/Taxes/TaxProvider';

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

describe('TaxContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  it('should provide initial default state', () => {
    const captured = {} as React.ContextType<typeof TaxContext>;

    const TestComponent = () => {
        Object.assign(captured, useContext(TaxContext));
        return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(captured.state.filingStatus).toBe('Single');
    expect(captured.state.stateResidency).toBe('DC');
    expect(captured.state.deductionMethod).toBe('Auto');
    expect(captured.state.fedOverride).toBeNull();
    expect(captured.state.ficaOverride).toBeNull();
    expect(captured.state.stateOverride).toBeNull();
  });

  it('should load state from localStorage on initialization', () => {
    const savedState: TaxState = {
      filingStatus: 'Married Filing Jointly',
      stateResidency: 'CA',
      deductionMethod: 'Itemized',
      fedOverride: 5000,
      ficaOverride: 1000,
      stateOverride: 2000,
      year: 2024,
    };

    localStorageMock.setItem('tax_settings', JSON.stringify(savedState));

    const captured = {} as React.ContextType<typeof TaxContext>;

    const TestComponent = () => {
        Object.assign(captured, useContext(TaxContext));
        return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('tax_settings');
    expect(captured.state.filingStatus).toBe('Married Filing Jointly');
    expect(captured.state.stateResidency).toBe('CA');
    expect(captured.state.deductionMethod).toBe('Itemized');
    expect(captured.state.fedOverride).toBe(5000);
    expect(captured.state.ficaOverride).toBe(1000);
    expect(captured.state.stateOverride).toBe(2000);
  });

  it('should merge saved state with initial state for backwards compatibility', () => {
    // Simulate old saved state missing new fields
    const oldSavedState = {
      filingStatus: 'Married Filing Jointly',
      stateResidency: 'CA',
      deductionMethod: 'Standard',
      year: 2024,
      // Missing override fields
    };

    localStorageMock.setItem('tax_settings', JSON.stringify(oldSavedState));

    const captured = {} as React.ContextType<typeof TaxContext>;

    const TestComponent = () => {
        Object.assign(captured, useContext(TaxContext));
        return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(captured.state.filingStatus).toBe('Married Filing Jointly');
    expect(captured.state.fedOverride).toBeNull(); // Should have default value
    expect(captured.state.ficaOverride).toBeNull();
    expect(captured.state.stateOverride).toBeNull();
  });

  it('should fall back to defaults on corrupted localStorage data', () => {
    localStorageMock.setItem('tax_settings', 'invalid json');

    const captured = {} as React.ContextType<typeof TaxContext>;

    const TestComponent = () => {
        Object.assign(captured, useContext(TaxContext));
        return null;
    };

    // Should not throw - gracefully falls back to default state
    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    // Verify we got the default state
    expect(captured.state.filingStatus).toBe('Single');
    expect(captured.state.stateResidency).toBe('DC');
    expect(captured.state.deductionMethod).toBe('Auto');
  });

  it('should save state to localStorage when state changes (debounced)', async () => {
    vi.useFakeTimers();
    const captured = {} as React.ContextType<typeof TaxContext>;

    const TestComponent = () => {
        Object.assign(captured, useContext(TaxContext));
        return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    act(() => {
      captured.dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
    });

    // Wait for debounce (500ms)
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'tax_settings',
      expect.stringContaining('"filingStatus":"Married Filing Jointly"')
    );

    vi.useRealTimers();
  });

  describe('Reducer Actions', () => {
    describe('SET_STATUS', () => {
      it('should update filing status', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.filingStatus).toBe('Single');

        act(() => {
          captured.dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
        });

        expect(captured.state.filingStatus).toBe('Married Filing Jointly');
      });
    });

    describe('SET_STATE', () => {
      it('should update state residency', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.stateResidency).toBe('DC');

        act(() => {
          captured.dispatch({ type: 'SET_STATE', payload: 'NY' });
        });

        expect(captured.state.stateResidency).toBe('NY');
      });
    });

    describe('SET_DEDUCTION_METHOD', () => {
      it('should update deduction method', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.deductionMethod).toBe('Auto');

        act(() => {
          captured.dispatch({ type: 'SET_DEDUCTION_METHOD', payload: 'Itemized' });
        });

        expect(captured.state.deductionMethod).toBe('Itemized');
      });
    });

    describe('SET_FED_OVERRIDE', () => {
      it('should set federal override', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.fedOverride).toBeNull();

        act(() => {
          captured.dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
        });

        expect(captured.state.fedOverride).toBe(5000);
      });

      it('should clear federal override when set to null', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        act(() => {
          captured.dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
        });

        expect(captured.state.fedOverride).toBe(5000);

        act(() => {
          captured.dispatch({ type: 'SET_FED_OVERRIDE', payload: null });
        });

        expect(captured.state.fedOverride).toBeNull();
      });
    });

    describe('SET_FICA_OVERRIDE', () => {
      it('should set FICA override', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.ficaOverride).toBeNull();

        act(() => {
          captured.dispatch({ type: 'SET_FICA_OVERRIDE', payload: 1000 });
        });

        expect(captured.state.ficaOverride).toBe(1000);
      });
    });

    describe('SET_STATE_OVERRIDE', () => {
      it('should set state override', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(captured.state.stateOverride).toBeNull();

        act(() => {
          captured.dispatch({ type: 'SET_STATE_OVERRIDE', payload: 2000 });
        });

        expect(captured.state.stateOverride).toBe(2000);
      });
    });

    describe('SET_YEAR', () => {
      it('should update tax year', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        act(() => {
          captured.dispatch({ type: 'SET_YEAR', payload: 2025 });
        });

        expect(captured.state.year).toBe(2025);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace entire state', () => {
        const captured = {} as React.ContextType<typeof TaxContext>;

        const TestComponent = () => {
            Object.assign(captured, useContext(TaxContext));
            return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        const newState: TaxState = {
          filingStatus: 'Single',
          stateResidency: 'TX',
          deductionMethod: 'Itemized',
          fedOverride: 10000,
          ficaOverride: 2000,
          stateOverride: 3000,
          year: 2025,
        };

        act(() => {
          captured.dispatch({ type: 'SET_BULK_DATA', payload: newState });
        });

        expect(captured.state).toEqual(newState);
      });
    });
  });

  describe('Multiple updates', () => {
    it('should handle multiple updates correctly', () => {
      const captured = {} as React.ContextType<typeof TaxContext>;

      const TestComponent = () => {
          Object.assign(captured, useContext(TaxContext));
          return null;
      };

      render(
        <TaxProvider>
          <TestComponent />
        </TaxProvider>
      );

      act(() => {
        captured.dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
        captured.dispatch({ type: 'SET_STATE', payload: 'CA' });
        captured.dispatch({ type: 'SET_DEDUCTION_METHOD', payload: 'Itemized' });
        captured.dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
      });

      expect(captured.state.filingStatus).toBe('Married Filing Jointly');
      expect(captured.state.stateResidency).toBe('CA');
      expect(captured.state.deductionMethod).toBe('Itemized');
      expect(captured.state.fedOverride).toBe(5000);
    });
  });
});
