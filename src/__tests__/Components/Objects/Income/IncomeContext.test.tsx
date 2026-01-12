import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext } from 'react';

import {
  IncomeProvider,
  IncomeContext,
} from '../../../../components/Objects/Income/IncomeContext';
import {
  WorkIncome,
  PassiveIncome,
  WindfallIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome
} from '../../../../components/Objects/Income/models';

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

describe('IncomeContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  it('should provide initial empty state', () => {
    let incomes!: any[];

    const TestComponent = () => {
      ({ incomes } = useContext(IncomeContext));
      return null;
    };

    render(
      <IncomeProvider>
        <TestComponent />
      </IncomeProvider>
    );

    expect(incomes).toEqual([]);
  });

  it('should load state from localStorage on initialization', () => {
    const savedIncome = new WorkIncome(
      '1',
      'Software Engineer',
      100000,
      'Annually',
      'Yes',
      5000,
      500,
      0,
      0,
      'acc-1',
      null,
      'FIXED'
    );
    const savedData = {
      incomes: [{ ...savedIncome, className: 'WorkIncome' }],
    };

    localStorageMock.setItem('user_incomes_data', JSON.stringify(savedData));

    let incomes!: any[];

    const TestComponent = () => {
      ({ incomes } = useContext(IncomeContext));
      return null;
    };

    render(
      <IncomeProvider>
        <TestComponent />
      </IncomeProvider>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('user_incomes_data');
    expect(incomes).toHaveLength(1);
    expect(incomes[0].id).toBe('1');
    expect(incomes[0].name).toBe('Software Engineer');
    expect(incomes[0].amount).toBe(100000);
  });

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.setItem('user_incomes_data', 'invalid json');

    let incomes!: any[];

    const TestComponent = () => {
      ({ incomes } = useContext(IncomeContext));
      return null;
    };

    render(
      <IncomeProvider>
        <TestComponent />
      </IncomeProvider>
    );

    expect(incomes).toEqual([]);
  });

  it('should save state to localStorage when state changes', () => {
    let dispatch!: any;

    const TestComponent = () => {
      ({ dispatch } = useContext(IncomeContext));
      return null;
    };

    render(
      <IncomeProvider>
        <TestComponent />
      </IncomeProvider>
    );

    const newIncome = new PassiveIncome('1', 'Rental Income', 2000, 'Monthly', 'No', 'Rental');

    act(() => {
      dispatch({ type: 'ADD_INCOME', payload: newIncome });
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'user_incomes_data',
      expect.stringContaining('"name":"Rental Income"')
    );
  });

  describe('Reducer Actions', () => {
    describe('ADD_INCOME', () => {
      it('should add an income to state', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const newIncome = new PassiveIncome('1', 'Rental Income', 2000, 'Monthly', 'No', 'Rental');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: newIncome });
        });

        expect(incomes).toHaveLength(1);
        expect(incomes[0]).toMatchObject({
          id: '1',
          name: 'Rental Income',
          amount: 2000,
          frequency: 'Monthly',
        });
      });

      it('should add multiple incomes', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');
        const income2 = new WorkIncome('2', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc-1', null, 'FIXED');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
          dispatch({ type: 'ADD_INCOME', payload: income2 });
        });

        expect(incomes).toHaveLength(2);
      });
    });

    describe('DELETE_INCOME', () => {
      it('should remove an income from state', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');
        const income2 = new WindfallIncome('2', 'Bonus', 10000, 'Annually', 'Yes');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
          dispatch({ type: 'ADD_INCOME', payload: income2 });
        });

        expect(incomes).toHaveLength(2);

        act(() => {
          dispatch({ type: 'DELETE_INCOME', payload: { id: '1' } });
        });

        expect(incomes).toHaveLength(1);
        expect(incomes[0].id).toBe('2');
      });
    });

    describe('UPDATE_INCOME_FIELD', () => {
      it('should update a specific field of an income', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'name', value: 'Updated Rental' },
          });
        });

        expect(incomes[0].name).toBe('Updated Rental');
        expect(incomes[0].amount).toBe(2000);
      });

      it('should update amount field', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'amount', value: 2500 },
          });
        });

        expect(incomes[0].amount).toBe(2500);
      });

      it('should preserve className when updating', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income = new WorkIncome('1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc-1', null, 'FIXED');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'amount', value: 110000 },
          });
        });

        expect(incomes[0].constructor.name).toBe('WorkIncome');
      });

      it('should update WorkIncome specific fields', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income = new WorkIncome('1', 'Job', 100000, 'Annually', 'Yes', 5000, 500, 0, 0, 'acc-1', null, 'FIXED');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'preTax401k', value: 6000 },
          });
        });

        expect(incomes[0].preTax401k).toBe(6000);
      });
    });

    describe('REORDER_INCOMES', () => {
      it('should reorder incomes correctly', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'First', 100, 'Monthly', 'No', 'Other');
        const income2 = new PassiveIncome('2', 'Second', 200, 'Monthly', 'No', 'Other');
        const income3 = new PassiveIncome('3', 'Third', 300, 'Monthly', 'No', 'Other');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
          dispatch({ type: 'ADD_INCOME', payload: income2 });
          dispatch({ type: 'ADD_INCOME', payload: income3 });
        });

        expect(incomes.map((i) => i.id)).toEqual(['1', '2', '3']);

        act(() => {
          dispatch({
            type: 'REORDER_INCOMES',
            payload: { startIndex: 0, endIndex: 2 },
          });
        });

        expect(incomes.map((i) => i.id)).toEqual(['2', '3', '1']);
      });

      it('should move income from end to beginning', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'First', 100, 'Monthly', 'No', 'Other');
        const income2 = new PassiveIncome('2', 'Second', 200, 'Monthly', 'No', 'Other');
        const income3 = new PassiveIncome('3', 'Third', 300, 'Monthly', 'No', 'Other');

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
          dispatch({ type: 'ADD_INCOME', payload: income2 });
          dispatch({ type: 'ADD_INCOME', payload: income3 });
        });

        act(() => {
          dispatch({
            type: 'REORDER_INCOMES',
            payload: { startIndex: 2, endIndex: 0 },
          });
        });

        expect(incomes.map((i) => i.id)).toEqual(['3', '1', '2']);
      });
    });

    describe('SET_BULK_DATA', () => {
      it('should replace all incomes', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'Old Income', 100, 'Monthly', 'No', 'Other');
        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
        });

        expect(incomes).toHaveLength(1);

        const newIncomes = [
          new PassiveIncome('2', 'New Rental', 2000, 'Monthly', 'No', 'Rental'),
          new WorkIncome('3', 'New Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'acc-1', null, 'FIXED'),
        ];

        act(() => {
          dispatch({
            type: 'SET_BULK_DATA',
            payload: { incomes: newIncomes },
          });
        });

        expect(incomes).toHaveLength(2);
        expect(incomes[0].id).toBe('2');
        expect(incomes[1].id).toBe('3');
      });

      it('should clear all incomes when bulk data is empty', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const income1 = new PassiveIncome('1', 'Rental', 2000, 'Monthly', 'No', 'Rental');
        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: income1 });
        });

        expect(incomes).toHaveLength(1);

        act(() => {
          dispatch({
            type: 'SET_BULK_DATA',
            payload: { incomes: [] },
          });
        });

        expect(incomes).toEqual([]);
      });
    });
  });

  describe('localStorage persistence', () => {
    it('should reconstitute incomes from localStorage with className', () => {
      const incomeData = {
        incomes: [
          {
            className: 'WorkIncome',
            id: '1',
            name: 'Job',
            amount: 100000,
            frequency: 'Annually',
            earned_income: 'Yes',
            preTax401k: 5000,
            insurance: 500,
            roth401k: 0,
            employerMatch: 0,
            matchAccountId: 'acc-1',
          },
          {
            className: 'PassiveIncome',
            id: '2',
            name: 'Rental',
            amount: 2000,
            frequency: 'Monthly',
            earned_income: 'No',
          },
        ],
      };

      localStorageMock.setItem('user_incomes_data', JSON.stringify(incomeData));

      let incomes!: any[];

      const TestComponent = () => {
        ({ incomes } = useContext(IncomeContext));
        return null;
      };

      render(
        <IncomeProvider>
          <TestComponent />
        </IncomeProvider>
      );

      expect(incomes).toHaveLength(2);
      expect(incomes[0].constructor.name).toBe('WorkIncome');
      expect(incomes[1].constructor.name).toBe('PassiveIncome');
    });

    it('should filter out null incomes from reconstitution', () => {
      const incomeData = {
        incomes: [
          {
            className: 'PassiveIncome',
            id: '1',
            name: 'Rental',
            amount: 2000,
            frequency: 'Monthly',
            earned_income: 'No',
          },
          {
            className: 'InvalidIncomeType',
            id: '2',
            name: 'Invalid',
            amount: 500,
          },
        ],
      };

      localStorageMock.setItem('user_incomes_data', JSON.stringify(incomeData));

      let incomes!: any[];

      const TestComponent = () => {
        ({ incomes } = useContext(IncomeContext));
        return null;
      };

      render(
        <IncomeProvider>
          <TestComponent />
        </IncomeProvider>
      );

      // Should only have valid income
      expect(incomes).toHaveLength(1);
      expect(incomes[0].id).toBe('1');
    });

    it('should reconstitute CurrentSocialSecurityIncome from localStorage', () => {
      const incomeData = {
        incomes: [
          {
            className: 'CurrentSocialSecurityIncome',
            id: '1',
            name: 'SSDI Benefits',
            amount: 1500,
            frequency: 'Monthly',
            earned_income: 'No',
            startDate: '2024-01-01',
          },
        ],
      };

      localStorageMock.setItem('user_incomes_data', JSON.stringify(incomeData));

      let incomes!: any[];

      const TestComponent = () => {
        ({ incomes } = useContext(IncomeContext));
        return null;
      };

      render(
        <IncomeProvider>
          <TestComponent />
        </IncomeProvider>
      );

      expect(incomes).toHaveLength(1);
      expect(incomes[0].constructor.name).toBe('CurrentSocialSecurityIncome');
      expect(incomes[0].name).toBe('SSDI Benefits');
      expect(incomes[0].amount).toBe(1500);
    });

    it('should reconstitute FutureSocialSecurityIncome from localStorage', () => {
      const incomeData = {
        incomes: [
          {
            className: 'FutureSocialSecurityIncome',
            id: '1',
            name: 'Future SS Benefits',
            amount: 0,
            frequency: 'Annually',
            earned_income: 'No',
            claimingAge: 67,
            calculatedPIA: 2500,
            calculationYear: 2045,
          },
        ],
      };

      localStorageMock.setItem('user_incomes_data', JSON.stringify(incomeData));

      let incomes!: any[];

      const TestComponent = () => {
        ({ incomes } = useContext(IncomeContext));
        return null;
      };

      render(
        <IncomeProvider>
          <TestComponent />
        </IncomeProvider>
      );

      expect(incomes).toHaveLength(1);
      expect(incomes[0].constructor.name).toBe('FutureSocialSecurityIncome');
      expect(incomes[0].name).toBe('Future SS Benefits');
      expect(incomes[0].claimingAge).toBe(67);
      expect(incomes[0].calculatedPIA).toBe(2500);
      expect(incomes[0].calculationYear).toBe(2045);
    });
  });

  describe('Social Security Income Types', () => {
    describe('CurrentSocialSecurityIncome', () => {
      it('should add CurrentSocialSecurityIncome to state', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const ssIncome = new CurrentSocialSecurityIncome(
          '1',
          'SSDI Benefits',
          1500,
          'Monthly',
          new Date('2024-01-01'),
          undefined
        );

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: ssIncome });
        });

        expect(incomes).toHaveLength(1);
        expect(incomes[0]).toMatchObject({
          id: '1',
          name: 'SSDI Benefits',
          amount: 1500,
          frequency: 'Monthly',
          earned_income: 'No',
        });
      });

      it('should update CurrentSocialSecurityIncome fields', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const ssIncome = new CurrentSocialSecurityIncome(
          '1',
          'SSDI Benefits',
          1500,
          'Monthly'
        );

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: ssIncome });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'amount', value: 1600 },
          });
        });

        expect(incomes[0].amount).toBe(1600);
      });
    });

    describe('FutureSocialSecurityIncome', () => {
      it('should add FutureSocialSecurityIncome to state', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const futureSSIncome = new FutureSocialSecurityIncome(
          '1',
          'Future Retirement Benefits',
          67,
          0,
          0,
          undefined,
          undefined
        );

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: futureSSIncome });
        });

        expect(incomes).toHaveLength(1);
        expect(incomes[0]).toMatchObject({
          id: '1',
          name: 'Future Retirement Benefits',
          claimingAge: 67,
          calculatedPIA: 0,
          calculationYear: 0,
          earned_income: 'No',
        });
      });

      it('should update FutureSocialSecurityIncome claiming age', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const futureSSIncome = new FutureSocialSecurityIncome(
          '1',
          'Future Benefits',
          67,
          0,
          0
        );

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: futureSSIncome });
        });

        act(() => {
          dispatch({
            type: 'UPDATE_INCOME_FIELD',
            payload: { id: '1', field: 'claimingAge', value: 70 },
          });
        });

        expect(incomes[0].claimingAge).toBe(70);
      });

      it('should preserve FutureSocialSecurityIncome calculated values', () => {
        let incomes!: any[];
        let dispatch!: any;

        const TestComponent = () => {
          ({ incomes, dispatch } = useContext(IncomeContext));
          return null;
        };

        render(
          <IncomeProvider>
            <TestComponent />
          </IncomeProvider>
        );

        const futureSSIncome = new FutureSocialSecurityIncome(
          '1',
          'Future Benefits',
          67,
          2500,
          2045,
          new Date('2045-01-01'),
          new Date('2075-01-01')
        );

        act(() => {
          dispatch({ type: 'ADD_INCOME', payload: futureSSIncome });
        });

        expect(incomes[0].calculatedPIA).toBe(2500);
        expect(incomes[0].calculationYear).toBe(2045);
      });
    });
  });
});
