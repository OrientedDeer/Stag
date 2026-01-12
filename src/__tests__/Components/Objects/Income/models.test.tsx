import { describe, it, expect } from 'vitest';
import {
  WorkIncome,
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
  PassiveIncome,
  WindfallIncome,
  reconstituteIncome,
  getIncomeActiveMultiplier,
  isIncomeActiveInCurrentMonth,
  BaseIncome,
} from '../../../../components/Objects/Income/models';
import { defaultAssumptions, AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock Assumptions for testing 'increment' methods
const mockAssumptions: AssumptionsState = {
  ...defaultAssumptions,
  macro: {
    inflationRate: 3,       // 3%
    healthcareInflation: 5, // 5%
    inflationAdjusted: true,  // Test with inflation on by default
  },
  income: {
    ...defaultAssumptions.income,
    salaryGrowth: 4, // 4%
  },
  expenses: {
    ...defaultAssumptions.expenses,
    rentInflation: 3.5, // 3.5%
  },
};

describe('Income Models', () => {
  describe('BaseIncome', () => {
    class TestIncome extends BaseIncome {
        increment(_assumptions: AssumptionsState): TestIncome { return this; }
    }
    it('should calculate prorated annual and monthly amounts correctly', () => {
        const weekly = new TestIncome('t1', 'Weekly', 100, 'Weekly', 'No'); // 5200/yr
        const monthly = new TestIncome('t2', 'Monthly', 1000, 'Monthly', 'No'); // 12000/yr
        const annually = new TestIncome('t3', 'Annually', 12000, 'Annually', 'No'); // 12000/yr

        expect(weekly.getAnnualAmount()).toBe(5200);
        expect(weekly.getMonthlyAmount()).toBeCloseTo(433.33, 2);
        expect(monthly.getAnnualAmount()).toBe(12000);
        expect(annually.getMonthlyAmount()).toBe(1000);
    });
  });

  describe('getIncomeActiveMultiplier', () => {
    const income = new WindfallIncome('w1', 'Test', 1000, 'Annually', 'No', new Date('2025-04-01'), new Date('2026-09-30'));
    
    it('should handle various year scenarios for multiplier', () => {
      expect(getIncomeActiveMultiplier(income, 2024)).toBe(0); // Before start
      expect(getIncomeActiveMultiplier(income, 2027)).toBe(0); // After end
      expect(getIncomeActiveMultiplier(income, 2025)).toBe(9 / 12); // Starts in April, 9 months active
      expect(getIncomeActiveMultiplier(income, 2026)).toBe(9 / 12); // Ends in Sept, 9 months active
    });
  });

  describe('isIncomeActiveInCurrentMonth', () => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    it('should correctly identify active status for income', () => {
      const future = new WorkIncome('w1', 'Future', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', nextMonth);
      const past = new WorkIncome('w2', 'Past', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', undefined, lastMonth);
      const current = new WorkIncome('w3', 'Current', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', lastMonth, nextMonth);
      
      expect(isIncomeActiveInCurrentMonth(future)).toBe(false);
      expect(isIncomeActiveInCurrentMonth(past)).toBe(false);
      expect(isIncomeActiveInCurrentMonth(current)).toBe(true);
    });
  });

  describe('WorkIncome', () => {
    const salary = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 10000, 3000, 5000, 5000, 'a1', null, 'GROW_WITH_SALARY');
    const nextYearSalary = salary.increment(mockAssumptions);
    
    it('should grow salary amount by salaryGrowth and inflation', () => {
        // 100000 * (1 + salaryGrowth + inflation) = 100000 * (1 + 0.04 + 0.03) = 107000
        expect(nextYearSalary.amount).toBe(107000);
    });

    it('should grow insurance by healthcareInflation and inflation', () => {
        // 3000 * (1 + healthcareInflation + inflation) = 3000 * (1 + 0.05 + 0.03) = 3240
        expect(nextYearSalary.insurance).toBe(3240);
    });

    it('should grow contributions if strategy is GROW_WITH_SALARY', () => {
        // 10000 * 1.07 = 10700
        // 5000 * 1.07 = 5350
        expect(nextYearSalary.preTax401k).toBe(10700);
        expect(nextYearSalary.roth401k).toBe(5350);
    });
    
    it('should keep contributions constant if strategy is FIXED', () => {
        const fixedSalary = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 10000, 3000, 5000, 5000, 'a1', null, 'FIXED');
        const nextYearFixed = fixedSalary.increment(mockAssumptions);
        expect(nextYearFixed.preTax401k).toBe(10000);
        expect(nextYearFixed.roth401k).toBe(5000);
      });
  });

  describe('SocialSecurityIncome', () => {
    it('should grow with general inflation', () => {
        const ssi = new SocialSecurityIncome('s1', 'SSI', 30000, 'Annually', 67);
        const nextYearSsi = ssi.increment(mockAssumptions);
        // 30000 * (1 + 0.03) = 30900
        expect(nextYearSsi.amount).toBe(30900);
    });
  });

  describe('CurrentSocialSecurityIncome', () => {
    it('should create CurrentSocialSecurityIncome with correct properties', () => {
      const ssIncome = new CurrentSocialSecurityIncome(
        'css-1',
        'SSDI Benefits',
        1500,
        'Monthly',
        new Date('2024-01-01'),
        undefined
      );

      expect(ssIncome.id).toBe('css-1');
      expect(ssIncome.name).toBe('SSDI Benefits');
      expect(ssIncome.amount).toBe(1500);
      expect(ssIncome.frequency).toBe('Monthly');
      expect(ssIncome.earned_income).toBe('No');
      expect(ssIncome.startDate).toEqual(new Date('2024-01-01'));
      expect(ssIncome.end_date).toBeUndefined();
    });

    it('should increment with COLA (inflation) adjustment', () => {
      const ssIncome = new CurrentSocialSecurityIncome(
        'css-1',
        'SSDI Benefits',
        1500,
        'Monthly'
      );

      const incremented = ssIncome.increment(mockAssumptions);

      // 1500 * (1 + 0.03) = 1545
      expect(incremented.amount).toBeCloseTo(1545, 2);
      expect(incremented.id).toBe('css-1');
      expect(incremented.name).toBe('SSDI Benefits');
      expect(incremented.frequency).toBe('Monthly');
      expect(incremented.earned_income).toBe('No');
    });

    it('should preserve dates when incrementing', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2050-01-01');

      const ssIncome = new CurrentSocialSecurityIncome(
        'css-1',
        'SSDI Benefits',
        1500,
        'Monthly',
        startDate,
        endDate
      );

      const incremented = ssIncome.increment(mockAssumptions);

      expect(incremented.startDate).toEqual(startDate);
      expect(incremented.end_date).toEqual(endDate);
    });
  });

  describe('FutureSocialSecurityIncome', () => {
    it('should create FutureSocialSecurityIncome with correct properties', () => {
      const futureSSIncome = new FutureSocialSecurityIncome(
        'fss-1',
        'Future Retirement Benefits',
        67,
        0,
        0,
        undefined,
        undefined
      );

      expect(futureSSIncome.id).toBe('fss-1');
      expect(futureSSIncome.name).toBe('Future Retirement Benefits');
      expect(futureSSIncome.claimingAge).toBe(67);
      expect(futureSSIncome.calculatedPIA).toBe(0);
      expect(futureSSIncome.calculationYear).toBe(0);
      expect(futureSSIncome.earned_income).toBe('No');
      expect(futureSSIncome.amount).toBe(0); // 0 * 12 = 0
      expect(futureSSIncome.frequency).toBe('Annually');
    });

    it('should set amount to calculatedPIA * 12', () => {
      const futureSSIncome = new FutureSocialSecurityIncome(
        'fss-1',
        'Future Benefits',
        67,
        2500, // $2,500/month
        2045
      );

      // Amount should be monthly PIA * 12 = $30,000/year
      expect(futureSSIncome.amount).toBe(30000);
    });

    it('should increment calculatedPIA with COLA adjustment', () => {
      const futureSSIncome = new FutureSocialSecurityIncome(
        'fss-1',
        'Future Benefits',
        67,
        2500,
        2045,
        new Date('2045-01-01'),
        new Date('2075-01-01')
      );

      const incremented = futureSSIncome.increment(mockAssumptions);

      // 2500 * (1 + 0.03) = 2575
      expect(incremented.calculatedPIA).toBeCloseTo(2575, 2);
      expect(incremented.claimingAge).toBe(67);
      expect(incremented.calculationYear).toBe(2045);
      expect(incremented.earned_income).toBe('No');
    });

    it('should preserve dates and calculation year when incrementing', () => {
      const startDate = new Date('2045-01-01');
      const endDate = new Date('2075-01-01');

      const futureSSIncome = new FutureSocialSecurityIncome(
        'fss-1',
        'Future Benefits',
        67,
        2500,
        2045,
        startDate,
        endDate
      );

      const incremented = futureSSIncome.increment(mockAssumptions);

      expect(incremented.startDate).toEqual(startDate);
      expect(incremented.end_date).toEqual(endDate);
      expect(incremented.calculationYear).toBe(2045);
    });

    it('should handle zero calculatedPIA', () => {
      const futureSSIncome = new FutureSocialSecurityIncome(
        'fss-1',
        'Future Benefits',
        67,
        0,
        0
      );

      const incremented = futureSSIncome.increment(mockAssumptions);

      expect(incremented.calculatedPIA).toBe(0);
      expect(incremented.amount).toBe(0);
    });
  });

  describe('PassiveIncome', () => {
    it('should grow rental income with rentInflation', () => {
        const rental = new PassiveIncome('p1', 'Rental', 20000, 'Annually', 'No', 'Rental');
        const nextYearRental = rental.increment(mockAssumptions);
        // 20000 * (1 + rentInflation + inflation) = 20000 * (1 + 0.035 + 0.03) = 21300
        expect(nextYearRental.amount).toBe(21300);
    });

    it('should grow other passive income with general inflation', () => {
        const dividend = new PassiveIncome('p2', 'Dividends', 5000, 'Annually', 'No', 'Dividend');
        const nextYearDividend = dividend.increment(mockAssumptions);
        // 5000 * (1 + 0.03) = 5150
        expect(nextYearDividend.amount).toBe(5150);
    });

    it('should not grow if isInflationAdjusted is false', () => {
        const royalty = new PassiveIncome('p3', 'Book', 1000, 'Annually', 'No', 'Royalty');
        royalty.isInflationAdjusted = false; // Override default
        const nextYearRoyalty = royalty.increment(mockAssumptions);
        expect(nextYearRoyalty.amount).toBe(1000);
    });
  });

  describe('WindfallIncome', () => {
    it('should grow with general inflation if inflation is adjusted', () => {
        const windfall = new WindfallIncome('w1', 'Inheritance', 100000, 'Annually', 'No');
        const nextYearWindfall = windfall.increment(mockAssumptions);
        expect(nextYearWindfall.amount).toBe(103000);
    });
  });

  describe('reconstituteIncome', () => {
    it('should create various income types correctly and preserve data', () => {
        const workData = { className: 'WorkIncome', id: 'w1', name: 'Job', amount: 95000 };
        const ssiData = { className: 'SocialSecurityIncome', id: 's1', name: 'SSDI', amount: 30000 };
        const passiveData = { className: 'PassiveIncome', id: 'p1', name: 'My Rental', sourceType: 'Rental' };
        
        const work = reconstituteIncome(workData);
        expect(work).toBeInstanceOf(WorkIncome);
        expect(work?.id).toBe('w1');
        expect(work?.name).toBe('Job');
        expect(work?.amount).toBe(95000);

        const ssi = reconstituteIncome(ssiData);
        expect(ssi).toBeInstanceOf(SocialSecurityIncome);
        expect(ssi?.id).toBe('s1');
        expect(ssi?.name).toBe('SSDI');
        expect(ssi?.amount).toBe(30000);

        const passive = reconstituteIncome(passiveData);
        expect(passive).toBeInstanceOf(PassiveIncome);
        expect(passive?.id).toBe('p1');
        expect(passive?.name).toBe('My Rental');
        if (passive instanceof PassiveIncome) {
            expect(passive.sourceType).toBe('Rental');
        }
    });

    it('should return null for unknown or invalid data', () => {
        expect(reconstituteIncome({ className: 'FakeIncome' })).toBeNull();
        expect(reconstituteIncome(null)).toBeNull();
        expect(reconstituteIncome({})).toBeNull();
    });

    it('should handle date strings correctly', () => {
        const data = {
            className: 'WindfallIncome',
            id: 'w1',
            amount: 1,
            startDate: '2030-01-01T00:00:00.000Z',
            end_date: '2030-12-31T00:00:00.000Z'
        };
        const income = reconstituteIncome(data);
        expect(income?.startDate).toEqual(new Date('2030-01-01T00:00:00.000Z'));
        expect(income?.end_date).toEqual(new Date('2030-12-31T00:00:00.000Z'));
    });

    it('should reconstitute CurrentSocialSecurityIncome', () => {
      const data = {
        className: 'CurrentSocialSecurityIncome',
        id: 'css-1',
        name: 'SSDI Benefits',
        amount: 1500,
        frequency: 'Monthly' as const,
        earned_income: 'No' as const,
        startDate: '2024-01-01',
        end_date: undefined,
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();
      expect(income?.constructor.name).toBe('CurrentSocialSecurityIncome');
      expect(income?.id).toBe('css-1');
      expect(income?.name).toBe('SSDI Benefits');
      expect(income?.amount).toBe(1500);
      expect(income?.frequency).toBe('Monthly');
    });

    it('should reconstitute FutureSocialSecurityIncome with all properties', () => {
      const data = {
        className: 'FutureSocialSecurityIncome',
        id: 'fss-1',
        name: 'Future SS Benefits',
        amount: 30000,
        frequency: 'Annually' as const,
        earned_income: 'No' as const,
        claimingAge: 67,
        calculatedPIA: 2500,
        calculationYear: 2045,
        startDate: '2045-01-01',
        end_date: '2075-01-01',
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();
      expect(income?.constructor.name).toBe('FutureSocialSecurityIncome');

      if (income && 'calculatedPIA' in income) {
        expect((income as FutureSocialSecurityIncome).claimingAge).toBe(67);
        expect((income as FutureSocialSecurityIncome).calculatedPIA).toBe(2500);
        expect((income as FutureSocialSecurityIncome).calculationYear).toBe(2045);
      }
    });

    it('should handle FutureSocialSecurityIncome with defaults when optional fields missing', () => {
      const data = {
        className: 'FutureSocialSecurityIncome',
        id: 'fss-1',
        name: 'Future Benefits',
        amount: 0,
        frequency: 'Annually' as const,
        earned_income: 'No' as const,
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();

      if (income && 'calculatedPIA' in income) {
        expect((income as FutureSocialSecurityIncome).claimingAge).toBe(67); // default
        expect((income as FutureSocialSecurityIncome).calculatedPIA).toBe(0); // default
        expect((income as FutureSocialSecurityIncome).calculationYear).toBe(0); // default
      }
    });
  });
});
