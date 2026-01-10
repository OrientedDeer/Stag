import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  TaxProvider,
  TaxContext,
  TaxState,
} from '../../../../components/Objects/Taxes/TaxContext';

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
    let state!: TaxState;

    const TestComponent = () => {
      ({ state } = useContext(TaxContext));
      return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(state.filingStatus).toBe('Single');
    expect(state.stateResidency).toBe('DC');
    expect(state.deductionMethod).toBe('Standard');
    expect(state.fedOverride).toBeNull();
    expect(state.ficaOverride).toBeNull();
    expect(state.stateOverride).toBeNull();
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

    let state!: TaxState;

    const TestComponent = () => {
      ({ state } = useContext(TaxContext));
      return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('tax_settings');
    expect(state.filingStatus).toBe('Married Filing Jointly');
    expect(state.stateResidency).toBe('CA');
    expect(state.deductionMethod).toBe('Itemized');
    expect(state.fedOverride).toBe(5000);
    expect(state.ficaOverride).toBe(1000);
    expect(state.stateOverride).toBe(2000);
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

    let state!: TaxState;

    const TestComponent = () => {
      ({ state } = useContext(TaxContext));
      return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    expect(state.filingStatus).toBe('Married Filing Jointly');
    expect(state.fedOverride).toBeNull(); // Should have default value
    expect(state.ficaOverride).toBeNull();
    expect(state.stateOverride).toBeNull();
  });

  it('should throw on corrupted localStorage data', () => {
    localStorageMock.setItem('tax_settings', 'invalid json');

    const TestComponent = () => {
      const { } = useContext(TaxContext);
      return null;
    };

    // TaxContext doesn't catch JSON parse errors, so it throws
    expect(() => {
      render(
        <TaxProvider>
          <TestComponent />
        </TaxProvider>
      );
    }).toThrow();
  });

  it('should save state to localStorage when state changes', () => {
    let dispatch: any;

    const TestComponent = () => {
      ({ dispatch } = useContext(TaxContext));
      return null;
    };

    render(
      <TaxProvider>
        <TestComponent />
      </TaxProvider>
    );

    act(() => {
      dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'tax_settings',
      expect.stringContaining('"filingStatus":"Married Filing Jointly"')
    );
  });

  describe('Reducer Actions', () => {
    describe('SET_STATUS', () => {
      it('should update filing status', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.filingStatus).toBe('Single');

        act(() => {
          dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
        });

        expect(state.filingStatus).toBe('Married Filing Jointly');
      });
    });

    describe('SET_STATE', () => {
      it('should update state residency', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.stateResidency).toBe('DC');

        act(() => {
          dispatch({ type: 'SET_STATE', payload: 'NY' });
        });

        expect(state.stateResidency).toBe('NY');
      });
    });

    describe('SET_DEDUCTION_METHOD', () => {
      it('should update deduction method', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.deductionMethod).toBe('Standard');

        act(() => {
          dispatch({ type: 'SET_DEDUCTION_METHOD', payload: 'Itemized' });
        });

        expect(state.deductionMethod).toBe('Itemized');
      });
    });

    describe('SET_FED_OVERRIDE', () => {
      it('should set federal override', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.fedOverride).toBeNull();

        act(() => {
          dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
        });

        expect(state.fedOverride).toBe(5000);
      });

      it('should clear federal override when set to null', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        act(() => {
          dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
        });

        expect(state.fedOverride).toBe(5000);

        act(() => {
          dispatch({ type: 'SET_FED_OVERRIDE', payload: null });
        });

        expect(state.fedOverride).toBeNull();
      });
    });

    describe('SET_FICA_OVERRIDE', () => {
      it('should set FICA override', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.ficaOverride).toBeNull();

        act(() => {
          dispatch({ type: 'SET_FICA_OVERRIDE', payload: 1000 });
        });

        expect(state.ficaOverride).toBe(1000);
      });
    });

    describe('SET_STATE_OVERRIDE', () => {
      it('should set state override', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        expect(state.stateOverride).toBeNull();

        act(() => {
          dispatch({ type: 'SET_STATE_OVERRIDE', payload: 2000 });
        });

        expect(state.stateOverride).toBe(2000);
      });
    });

    describe('SET_YEAR', () => {
      it('should update tax year', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
          return null;
        };

        render(
          <TaxProvider>
            <TestComponent />
          </TaxProvider>
        );

        act(() => {
          dispatch({ type: 'SET_YEAR', payload: 2025 });
        });

        expect(state.year).toBe(2025);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace entire state', () => {
        let state!: TaxState;
        let dispatch: any;

        const TestComponent = () => {
          ({ state, dispatch } = useContext(TaxContext));
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
          dispatch({ type: 'SET_BULK_DATA', payload: newState });
        });

        expect(state).toEqual(newState);
      });
    });
  });

  describe('Multiple updates', () => {
    it('should handle multiple updates correctly', () => {
      let state!: TaxState;
      let dispatch: any;

      const TestComponent = () => {
        ({ state, dispatch } = useContext(TaxContext));
        return null;
      };

      render(
        <TaxProvider>
          <TestComponent />
        </TaxProvider>
      );

      act(() => {
        dispatch({ type: 'SET_STATUS', payload: 'Married Filing Jointly' });
        dispatch({ type: 'SET_STATE', payload: 'CA' });
        dispatch({ type: 'SET_DEDUCTION_METHOD', payload: 'Itemized' });
        dispatch({ type: 'SET_FED_OVERRIDE', payload: 5000 });
      });

      expect(state.filingStatus).toBe('Married Filing Jointly');
      expect(state.stateResidency).toBe('CA');
      expect(state.deductionMethod).toBe('Itemized');
      expect(state.fedOverride).toBe(5000);
    });
  });
});
