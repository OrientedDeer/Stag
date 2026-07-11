import { describe, it, expect, vi } from 'vitest';
import {
  WorkIncome,
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
  FERSPensionIncome,
  CSRSPensionIncome,
  PassiveIncome,
  WindfallIncome,
  reconstituteIncome,
  getIncomeActiveMultiplier,
  getIncomeActiveMonthOverlap,
  isIncomeActiveInCurrentMonth,
  BaseIncome,
  calculateSocialSecurityStartYear,
  calculateSocialSecurityStartDate,
} from '../../../../components/Objects/Income/models';
import { defaultAssumptions, type AssumptionsState } from '../../../../components/Objects/Assumptions/AssumptionsContext';

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub override
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
    // Use Date constructor with args to ensure local time (month is 0-indexed, so 3 = April, 8 = September)
    const income = new WindfallIncome('w1', 'Test', 1000, 'Annually', 'No', new Date(2025, 3, 1), new Date(2026, 8, 30));

    it('should handle various year scenarios for multiplier', () => {
      expect(getIncomeActiveMultiplier(income, 2024)).toBe(0); // Before start
      expect(getIncomeActiveMultiplier(income, 2027)).toBe(0); // After end
      expect(getIncomeActiveMultiplier(income, 2025)).toBe(9 / 12); // Starts in April, 9 months active
      expect(getIncomeActiveMultiplier(income, 2026)).toBe(9 / 12); // Ends in Sept, 9 months active
    });

    // Hand-verified test cases for Batch 19
    // PassiveIncome(id, name, amount, frequency, earned_income, sourceType, startDate?, end_date?)
    it('should return 1.0 for full year active (starts Jan, no end)', () => {
      const fullYear = new PassiveIncome('p1', 'Full Year', 1000, 'Annually', 'No', 'Interest', new Date(2024, 0, 1));
      expect(getIncomeActiveMultiplier(fullYear, 2024)).toBe(1.0);
    });

    it('should return 0 for year before income starts', () => {
      const futureStart = new PassiveIncome('p2', 'Future', 1000, 'Annually', 'No', 'Interest', new Date(2024, 0, 1));
      expect(getIncomeActiveMultiplier(futureStart, 2023)).toBe(0);
    });

    it('should return 0.5 for income starting July (6 months active)', () => {
      // July is month 6 (0-indexed), so July through December = 6 months
      const midYearStart = new PassiveIncome('p3', 'Mid Year Start', 1000, 'Annually', 'No', 'Interest', new Date(2024, 6, 1));
      expect(getIncomeActiveMultiplier(midYearStart, 2024)).toBe(6 / 12);
    });

    it('should return 0.25 for income ending March (3 months active)', () => {
      // Jan through March = 3 months (month 0, 1, 2)
      const endsMarch = new PassiveIncome('p4', 'Ends March', 1000, 'Annually', 'No', 'Interest', new Date(2024, 0, 1), new Date(2024, 2, 31));
      expect(getIncomeActiveMultiplier(endsMarch, 2024)).toBe(3 / 12);
    });

    it('should return 0 for year after income ends', () => {
      const endedIncome = new PassiveIncome('p5', 'Ended', 1000, 'Annually', 'No', 'Interest', new Date(2024, 0, 1), new Date(2024, 2, 31));
      expect(getIncomeActiveMultiplier(endedIncome, 2025)).toBe(0);
    });

    it('should handle income spanning year boundary (Nov 2023 to Feb 2024)', () => {
      // In 2024: Jan and Feb are active = 2 months
      const spanning = new PassiveIncome('p6', 'Spanning', 1000, 'Annually', 'No', 'Interest', new Date(2023, 10, 1), new Date(2024, 1, 29));
      expect(getIncomeActiveMultiplier(spanning, 2024)).toBeCloseTo(2 / 12, 4);
    });
  });

  describe('getIncomeActiveMonthOverlap (#178 EOY partial-year overlap)', () => {
    it('is 0 when the income already ENDED before the tail window', () => {
      // Job ran Jan–March; the remaining-year tail viewed in October is Nov–Dec.
      // The true overlap is zero — the old min(remainingFraction, activeMultiplier)
      // wrongly reported ~2 months (a phantom EOY 401k deposit).
      const endedMarch = new WorkIncome('w1', 'Ended March', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', new Date(2025, 0, 1), new Date(2025, 2, 31));
      expect(getIncomeActiveMonthOverlap(endedMarch, 2025, 10 /* Nov */)).toBe(0);
    });

    it('counts only the months in [fromMonth..Dec] that overlap the active window', () => {
      // Active Jan–June; tail from October (month 9→ fromMonth 10, i.e. Nov). No overlap.
      const janToJune = new WorkIncome('w2', 'Jan-June', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', new Date(2025, 0, 1), new Date(2025, 5, 30));
      expect(getIncomeActiveMonthOverlap(janToJune, 2025, 10)).toBe(0);
      // Full-year job, tail Nov–Dec → 2 months.
      const fullYear = new WorkIncome('w3', 'Full', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', new Date(2025, 0, 1));
      expect(getIncomeActiveMonthOverlap(fullYear, 2025, 10)).toBe(2 / 12);
      // Job starting in December, tail Nov–Dec → just December.
      const startsDec = new WorkIncome('w4', 'Dec', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', new Date(2025, 11, 1));
      expect(getIncomeActiveMonthOverlap(startsDec, 2025, 10)).toBe(1 / 12);
    });

    it('returns the full tail when the income is active the whole year', () => {
      const fullYear = new WorkIncome('w5', 'Full', 1, 'Monthly', 'Yes', 0,0,0,0, 'a1', null, 'FIXED', new Date(2024, 0, 1));
      // fromMonth 0 (Jan) → all 12 months.
      expect(getIncomeActiveMonthOverlap(fullYear, 2025, 0)).toBe(1.0);
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

    it('should grow insurance by salaryGrowth and inflation', () => {
        // 3000 * (1 + salaryGrowth + inflation) = 3000 * (1 + 0.04 + 0.03) = 3210
        expect(nextYearSalary.insurance).toBe(3210);
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

    it('auto-max stores a per-period contribution for monthly frequency (#8)', () => {
        // increment() with autoMax401k must store the annual limit as a per-period value
        // for a monthly income, so annualizing it recovers $23,000 rather than 12× that.
        const monthly = new WorkIncome(
          'w1', 'Job', 8333, 'Monthly', 'Yes',
          0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
          'traditional'
        );
        const next = monthly.increment(mockAssumptions, 2024, 45);
        expect(next.preTax401k).toBeCloseTo(23000 / 12, 6);
        expect(next.getProratedAnnual(next.preTax401k)).toBeCloseTo(23000, 6);
      });

    it('should initialize ESPP fields with correct defaults', () => {
      const salary = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'a1');
      expect(salary.esppContributionType).toBe('NONE');
      expect(salary.esppContributionAmount).toBe(0);
      expect(salary.esppDiscountPercent).toBe(15);
      expect(salary.esppHasLookback).toBe(true);
      expect(salary.esppAccountId).toBeNull();
    });

    it('should calculate annual ESPP contribution for percentage type', () => {
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', null, 'FIXED', undefined, undefined, 0, 'custom',
        'PERCENTAGE', // esppContributionType
        10,           // esppContributionAmount (10%)
        15, true, 6, 'espp-1', 7
      );
      // 100000 * 10% = 10000
      expect(salary.getAnnualESPPContribution()).toBe(10000);
    });

    it('should calculate annual ESPP contribution for fixed type', () => {
      const salary = new WorkIncome(
        'w1', 'Job', 5000, 'Monthly', 'Yes',
        0, 0, 0, 0, 'a1', null, 'FIXED', undefined, undefined, 0, 'custom',
        'FIXED',      // esppContributionType
        500,          // esppContributionAmount ($500/month)
        15, true, 6, 'espp-1', 7
      );
      // $500/month * 12 = $6000/year
      expect(salary.getAnnualESPPContribution()).toBe(6000);
    });

    it('should return 0 for ESPP contribution when type is NONE', () => {
      const salary = new WorkIncome('w1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, 'a1');
      expect(salary.getAnnualESPPContribution()).toBe(0);
    });

    it('should preserve ESPP fields when incrementing', () => {
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', null, 'FIXED', undefined, undefined, 0, 'custom',
        'PERCENTAGE', 10, 15, true, 6, 'espp-1', 7
      );
      const nextYear = salary.increment(mockAssumptions);
      expect(nextYear.esppContributionType).toBe('PERCENTAGE');
      expect(nextYear.esppDiscountPercent).toBe(15);
      expect(nextYear.esppHasLookback).toBe(true);
      expect(nextYear.esppAccountId).toBe('espp-1');
    });
  });

  describe('WorkIncome.getEffective401k', () => {
    it('should return { preTax: 0, roth: 0 } when mode is disabled', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        15000, 5000, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'disabled'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 45);
      expect(result.preTax).toBe(0);
      expect(result.roth).toBe(0);
    });

    it('should return preTax/roth properties when mode is custom', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        15000, 0, 5000, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'custom'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 45);
      expect(result.preTax).toBe(15000);
      expect(result.roth).toBe(5000);
    });

    it('should return full limit as traditional when mode is traditional (under 50)', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'traditional'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 45);
      // 2024 base limit: $23,000 (no catch-up for under 50)
      expect(result.preTax).toBe(23000);
      expect(result.roth).toBe(0);
    });

    it('should return a per-period limit for monthly frequency (#8)', () => {
      // preTax401k is stored per pay period (keyed off frequency). For a monthly income
      // the auto-max contribution must be the annual limit spread across 12 periods, so
      // that consumers which prorate it (×12) recover the true $23,000 limit — not $276k.
      const income = new WorkIncome(
        'w1', 'Job', 8333, 'Monthly', 'Yes',
        0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'traditional'
      );
      const result = income.getEffective401k(2024, 45);
      expect(result.preTax).toBeCloseTo(23000 / 12, 6);
      expect(income.getProratedAnnual(result.preTax)).toBeCloseTo(23000, 6);
    });

    it('should return full limit as Roth when mode is roth (under 50)', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Roth 401k', 'FIXED', undefined, undefined, 0,
        'roth'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 45);
      // 2024 base limit: $23,000 (no catch-up for under 50)
      expect(result.preTax).toBe(0);
      expect(result.roth).toBe(23000);
    });

    it('should include catch-up contribution at age 50+ for traditional mode', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'traditional'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 50);
      // 2024: $23,000 base + $7,500 catch-up = $30,500
      expect(result.preTax).toBe(30500);
      expect(result.roth).toBe(0);
    });

    it('should include catch-up contribution at age 50+ for roth mode', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Roth 401k', 'FIXED', undefined, undefined, 0,
        'roth'  // autoMax401k
      );
      const result = income.getEffective401k(2024, 55);
      // 2024: $23,000 base + $7,500 catch-up = $30,500
      expect(result.preTax).toBe(0);
      expect(result.roth).toBe(30500);
    });

    it('should use 2025 limits when year is 2025', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'traditional'  // autoMax401k
      );
      const result = income.getEffective401k(2025, 45);
      // 2025 base limit: $23,500 (no catch-up for under 50)
      expect(result.preTax).toBe(23500);
      expect(result.roth).toBe(0);
    });

    it('should use 2025 limits with catch-up at age 50+', () => {
      const income = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', 'Traditional 401k', 'FIXED', undefined, undefined, 0,
        'traditional'  // autoMax401k
      );
      const result = income.getEffective401k(2025, 50);
      // 2025: $23,500 base + $7,500 catch-up = $31,000
      expect(result.preTax).toBe(31000);
      expect(result.roth).toBe(0);
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

    it('should not grow if global inflationAdjusted is false', () => {
        const royalty = new PassiveIncome('p3', 'Book', 1000, 'Annually', 'No', 'Royalty');
        const noInflationAssumptions = {
            ...mockAssumptions,
            macro: { ...mockAssumptions.macro, inflationAdjusted: false }
        };
        const nextYearRoyalty = royalty.increment(noInflationAssumptions);
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

    it('preserves an ABSENT startDate as undefined for a milestone-started income (#178)', () => {
      // A milestone-anchored RSU grant carries startDate undefined BY DESIGN. The old
      // parseDateRequired force-filled new Date() on every reload, which re-anchored the
      // RSU vest schedule to the reload date (vesting zero shares) and destabilized the
      // simulation input hash. Reconstitution must round-trip the undefined startDate.
      const data = {
        className: 'WorkIncome',
        id: 'rsu1',
        name: 'Startup grant',
        amount: 200000,
        startMilestoneId: 'ms-join',
        rsuVestingSchedule: 'annual',
        rsuGrantShares: 10000,
        rsuAccountId: 'acct-rsu',
      };
      const inc = reconstituteIncome(data);
      expect(inc).toBeInstanceOf(WorkIncome);
      expect(inc!.startDate).toBeUndefined();
      expect((inc as WorkIncome).startMilestoneId).toBe('ms-join');
    });

    it('produces a STABLE simulation-hash startDate across reloads when startDate is absent (#178)', () => {
      const data = { className: 'PassiveIncome', id: 'p9', name: 'Milestone rental', amount: 1200, startMilestoneId: 'ms-x' };
      const a = reconstituteIncome(data);
      const b = reconstituteIncome(data);
      // Both reconstitutions must agree (undefined === undefined), not two distinct
      // wall-clock instants that would trip a spurious stale-recompute banner.
      expect(a!.startDate).toBeUndefined();
      expect(b!.startDate).toBeUndefined();
    });

    it('should return null for unknown or invalid data', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(reconstituteIncome({ className: 'FakeIncome' })).toBeNull();
        expect(reconstituteIncome(null)).toBeNull();
        expect(reconstituteIncome({})).toBeNull();
        consoleSpy.mockRestore();
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
        expect(income!.startDate!.getFullYear()).toBe(2030);
        expect(income!.startDate!.getMonth()).toBe(0); // January
        expect(income!.startDate!.getDate()).toBe(1);
        expect(income!.end_date?.getFullYear()).toBe(2030);
        expect(income!.end_date?.getMonth()).toBe(11); // December
        expect(income!.end_date?.getDate()).toBe(31);
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

  describe('BaseIncome.getProratedAnnual with year parameter', () => {
    class TestIncome extends BaseIncome {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub override
      increment(_assumptions: AssumptionsState): TestIncome { return this; }
    }

    it('should apply time-based multiplier when year is provided', () => {
      // Income active April-December 2025 (9 months)
      // Use Date constructor with args to ensure local time (month is 0-indexed, so 3 = April)
      const income = new TestIncome('t1', 'Test', 12000, 'Annually', 'No', new Date(2025, 3, 1), new Date(2025, 11, 31));

      // Without year - full amount
      expect(income.getAnnualAmount()).toBe(12000);

      // With year 2025 - prorated to 9/12
      expect(income.getAnnualAmount(2025)).toBe(12000 * (9/12));
    });

    it('should return zero when income not active in requested year', () => {
      // Use Date constructor with args to ensure local time
      const income = new TestIncome('t1', 'Test', 12000, 'Annually', 'No', new Date(2025, 0, 1), new Date(2025, 11, 31));

      expect(income.getAnnualAmount(2024)).toBe(0); // Before start
      expect(income.getAnnualAmount(2026)).toBe(0); // After end
    });

    it('should apply multiplier to monthly amount with year', () => {
      // Use Date constructor with args to ensure local time (month is 0-indexed, so 3 = April)
      const income = new TestIncome('t1', 'Test', 12000, 'Annually', 'No', new Date(2025, 3, 1), new Date(2025, 11, 31));

      // Monthly with year applies the same multiplier
      expect(income.getMonthlyAmount(2025)).toBe((12000 * (9/12)) / 12);
    });
  });

  describe('WorkIncome TRACK_ANNUAL_MAX strategy', () => {
    it('should fall back to GROW_WITH_SALARY when year/age not provided', () => {
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        10000, 3000, 5000, 5000, 'a1', null,
        'TRACK_ANNUAL_MAX'
      );

      // Without year/age, falls back to GROW_WITH_SALARY behavior
      const nextYear = salary.increment(mockAssumptions);

      // 10000 * (1 + 0.04 + 0.03) = 10700
      expect(nextYear.preTax401k).toBe(10700);
      expect(nextYear.roth401k).toBe(5350);
    });

    it('should cap 401k contributions at IRS limit when year/age provided', () => {
      // Start with contributions that will exceed limit after growth
      // 2025 limit: $23,500 (no catch-up for under 50)
      const salary = new WorkIncome(
        'w1', 'Job', 150000, 'Annually', 'Yes',
        20000, 0, 5000, 0, 'a1', null,  // $25k total 401k
        'TRACK_ANNUAL_MAX'
      );

      // Growth: 25000 * 1.07 = 26750, exceeds $23,500 limit
      const nextYear = salary.increment(mockAssumptions, 2025, 40);

      // Should cap at $23,500 while preserving ratio (20k/25k = 80% pre-tax)
      const totalCapped = nextYear.preTax401k + nextYear.roth401k;
      expect(totalCapped).toBe(23500);
      expect(nextYear.preTax401k).toBeCloseTo(18800, 0); // 80% of 23500
      expect(nextYear.roth401k).toBeCloseTo(4700, 0);    // 20% of 23500
    });

    it('should include catch-up contributions for age 50+', () => {
      // 2025 limit: $23,500 + $7,500 catch-up = $31,000
      const salary = new WorkIncome(
        'w1', 'Job', 200000, 'Annually', 'Yes',
        28000, 0, 5000, 0, 'a1', null,  // $33k total 401k
        'TRACK_ANNUAL_MAX'
      );

      // Growth: 33000 * 1.07 = 35310, exceeds $31,000 limit for 50+
      const nextYear = salary.increment(mockAssumptions, 2025, 52);

      const totalCapped = nextYear.preTax401k + nextYear.roth401k;
      expect(totalCapped).toBe(31000); // 23500 + 7500 catch-up
    });

    it('should allow contributions below limit to grow normally', () => {
      // Start with low contributions that won't hit limit
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        10000, 0, 5000, 0, 'a1', null,  // $15k total, well under $23,500
        'TRACK_ANNUAL_MAX'
      );

      // Growth: 15000 * 1.07 = 16050, under limit
      const nextYear = salary.increment(mockAssumptions, 2025, 40);

      expect(nextYear.preTax401k).toBe(10700);  // Normal growth
      expect(nextYear.roth401k).toBe(5350);     // Normal growth
    });

    it('should cap HSA at IRS limit', () => {
      // 2025 individual HSA limit: $4,300 (no catch-up for under 55)
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', null,
        'TRACK_ANNUAL_MAX',
        new Date('2025-01-01'),
        new Date('2030-12-31'),
        4200 // HSA contribution near limit
      );

      // Growth: 4200 * 1.07 = 4494, exceeds $4,300 limit
      const nextYear = salary.increment(mockAssumptions, 2025, 40);

      expect(nextYear.hsaContribution).toBe(4300);
    });

    it('should include HSA catch-up for age 55+', () => {
      // 2025 individual HSA limit: $4,300 + $1,000 catch-up = $5,300
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', null,
        'TRACK_ANNUAL_MAX',
        new Date('2025-01-01'),
        new Date('2030-12-31'),
        5000 // HSA contribution
      );

      // Growth: 5000 * 1.07 = 5350, exceeds $5,300 limit for 55+
      const nextYear = salary.increment(mockAssumptions, 2025, 56);

      expect(nextYear.hsaContribution).toBe(5300);
    });

    it('should grow HSA normally when below limit', () => {
      const salary = new WorkIncome(
        'w1', 'Job', 100000, 'Annually', 'Yes',
        0, 0, 0, 0, 'a1', null,
        'TRACK_ANNUAL_MAX',
        new Date('2025-01-01'),
        new Date('2030-12-31'),
        3000 // HSA contribution well under limit
      );

      // Growth: 3000 * 1.07 = 3210, under $4,300 limit
      const nextYear = salary.increment(mockAssumptions, 2025, 40);

      expect(nextYear.hsaContribution).toBe(3210);
    });
  });

  describe('PassiveIncome Interest sourceType', () => {
    it('should not grow Interest income independently', () => {
      const interest = new PassiveIncome('p1', 'Savings Interest', 1000, 'Annually', 'No', 'Interest');
      const nextYear = interest.increment(mockAssumptions);

      // Interest income has growth rate of 0 - it grows through account balance, not independently
      expect(nextYear.amount).toBe(1000);
    });
  });

  describe('SocialSecurityIncome Static Methods', () => {
    describe('calculateBenefitAdjustment', () => {
      it('should return 0.70 for early claiming at 62', () => {
        expect(SocialSecurityIncome.calculateBenefitAdjustment(62)).toBeCloseTo(0.70, 2);
      });

      it('should return 1.0 for claiming at FRA (67)', () => {
        expect(SocialSecurityIncome.calculateBenefitAdjustment(67)).toBe(1.0);
      });

      it('should return 1.24 for delayed claiming at 70', () => {
        expect(SocialSecurityIncome.calculateBenefitAdjustment(70)).toBe(1.24);
      });

      it('should cap at 0.70 for ages below 62', () => {
        expect(SocialSecurityIncome.calculateBenefitAdjustment(60)).toBe(0.70);
        expect(SocialSecurityIncome.calculateBenefitAdjustment(55)).toBe(0.70);
      });

      it('should cap at 1.24 for ages above 70', () => {
        expect(SocialSecurityIncome.calculateBenefitAdjustment(71)).toBe(1.24);
        expect(SocialSecurityIncome.calculateBenefitAdjustment(75)).toBe(1.24);
      });

      it('should calculate intermediate early claiming reductions', () => {
        // Age 63: 4 years early = 1.0 - (4 * 0.0667) = 0.7332
        expect(SocialSecurityIncome.calculateBenefitAdjustment(63)).toBeCloseTo(0.7333, 2);
        // Age 64: 3 years early = 1.0 - (3 * 0.0667) = 0.7999
        expect(SocialSecurityIncome.calculateBenefitAdjustment(64)).toBeCloseTo(0.7999, 2);
        // Age 65: 2 years early = 1.0 - (2 * 0.0667) = 0.8666
        expect(SocialSecurityIncome.calculateBenefitAdjustment(65)).toBeCloseTo(0.8666, 2);
        // Age 66: 1 year early = 1.0 - (1 * 0.0667) = 0.9333
        expect(SocialSecurityIncome.calculateBenefitAdjustment(66)).toBeCloseTo(0.9333, 2);
      });

      it('should calculate intermediate delayed claiming increases', () => {
        // Age 68: 1 year delayed = 1.0 + (1 * 0.08) = 1.08
        expect(SocialSecurityIncome.calculateBenefitAdjustment(68)).toBe(1.08);
        // Age 69: 2 years delayed = 1.0 + (2 * 0.08) = 1.16
        expect(SocialSecurityIncome.calculateBenefitAdjustment(69)).toBe(1.16);
      });

      it('should verify ~6.67%/year reduction before FRA and 8%/year after', () => {
        // Reduction rate before FRA: ~6.67% per year
        const age65 = SocialSecurityIncome.calculateBenefitAdjustment(65);
        const age66 = SocialSecurityIncome.calculateBenefitAdjustment(66);
        expect(age66 - age65).toBeCloseTo(0.0667, 3); // ~6.67% difference per year

        // Increase rate after FRA: 8% per year
        const age67 = SocialSecurityIncome.calculateBenefitAdjustment(67);
        const age68 = SocialSecurityIncome.calculateBenefitAdjustment(68);
        expect(age68 - age67).toBeCloseTo(0.08, 5); // 8% per year
      });
    });

    describe('calculateBenefitFromFRA', () => {
      it('should calculate reduced benefit for early claiming', () => {
        // FRA benefit of $2000, claiming at 62 = $2000 * 0.70 = $1400
        expect(SocialSecurityIncome.calculateBenefitFromFRA(2000, 62)).toBeCloseTo(1400, 0);
      });

      it('should return full benefit at FRA', () => {
        expect(SocialSecurityIncome.calculateBenefitFromFRA(2000, 67)).toBe(2000);
      });

      it('should calculate increased benefit for delayed claiming', () => {
        // FRA benefit of $2000, claiming at 70 = $2000 * 1.24 = $2480
        expect(SocialSecurityIncome.calculateBenefitFromFRA(2000, 70)).toBe(2480);
      });
    });
  });

  describe('calculateSocialSecurityStartYear', () => {
    it('should calculate correct start year based on claiming age', () => {
      // Person born 1995 (age 30 in 2025), claiming at 67
      expect(calculateSocialSecurityStartYear(1995, 67)).toBe(2062);
    });

    it('should handle claiming at 62', () => {
      // Person born 1970 (age 55 in 2025), claiming at 62
      expect(calculateSocialSecurityStartYear(1970, 62)).toBe(2032);
    });

    it('should handle claiming at 70', () => {
      // Person born 1965 (age 60 in 2025), claiming at 70
      expect(calculateSocialSecurityStartYear(1965, 70)).toBe(2035);
    });

    it('should handle same claiming age as current age', () => {
      // Person born 1958 (age 67 in 2025), claiming at 67
      expect(calculateSocialSecurityStartYear(1958, 67)).toBe(2025);
    });
  });

  describe('calculateSocialSecurityStartDate', () => {
    it('should return correct date for claiming age', () => {
      // Person born 1995 (age 30 in 2025), claiming at 67 in January
      // calculateSocialSecurityStartDate builds a LOCAL-midnight date-only value
      // (parseDate convention), so read it back with local accessors.
      const result = calculateSocialSecurityStartDate(1995, 67);
      expect(result.getFullYear()).toBe(2062);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(1);
    });

    it('should handle custom claiming month', () => {
      // Person born 1970 (age 55 in 2025), claiming at 62 in July
      const result = calculateSocialSecurityStartDate(1970, 62, 6);
      expect(result.getFullYear()).toBe(2032);
      expect(result.getMonth()).toBe(6); // July
    });

    it('should default to January when month not specified', () => {
      // Person born 1985 (age 40 in 2025), claiming at 67
      const result = calculateSocialSecurityStartDate(1985, 67);
      expect(result.getMonth()).toBe(0); // January
    });
  });

  describe('FERSPensionIncome', () => {
    const fersPension = new FERSPensionIncome(
      'fers-1', 'FERS Pension', 25, 100000, 62, 1970, 22000, 0, 0,
      new Date('2032-01-01'), new Date('2060-12-31')
    );

    it('should calculate basic benefit correctly', () => {
      // 25 years * $100,000 * 1.1% (age 62+ with 20+ years) = $27,500
      const benefit = fersPension.calculateBenefit();
      expect(benefit).toBe(27500);
    });

    it('should apply COLA on increment for retirees 62+', () => {
      const nextYear = fersPension.increment(mockAssumptions, 2033, 63);
      // FERS COLA for 3% inflation at age 63: 2% (since CPI 2-3%)
      expect(nextYear.calculatedBenefit).toBeCloseTo(22000 * 1.02, 0);
    });

    it('should preserve autoCalculateHigh3 and linkedIncomeId on increment', () => {
      const pensionWithLink = new FERSPensionIncome(
        'fers-2', 'FERS Pension', 20, 100000, 62, 1970, 20000, 0, 0,
        new Date('2032-01-01'), new Date('2060-12-31'),
        true, 'work-income-1'
      );

      const nextYear = pensionWithLink.increment(mockAssumptions, 2033, 63);
      expect(nextYear.autoCalculateHigh3).toBe(true);
      expect(nextYear.linkedIncomeId).toBe('work-income-1');
    });

    it('should calculate FERS supplement when eligible', () => {
      const earlyPension = new FERSPensionIncome(
        'fers-3', 'FERS Pension', 30, 100000, 57, 1970, 30000, 0, 24000,
        new Date('2027-01-01'), new Date('2060-12-31')
      );
      // 30 years / 40 * $2000/month * 12 = $18,000
      const supplement = earlyPension.calculateSupplement();
      expect(supplement).toBe(18000);
    });

    it('should return 0 supplement for retirement at 62+', () => {
      const supplement = fersPension.calculateSupplement();
      expect(supplement).toBe(0);
    });

    // --- Finding 3: FERS Annuity Supplement must NOT grow with COLA ---
    // The real FERS supplement is a fixed bridge payment from retirement to age 62;
    // it receives no COLA. The increment() formula now uses the bare `this.fersSupplement`
    // rather than `this.fersSupplement * (1 + cola)`.
    //
    // NOTE: getFERSCOLA() returns 0 for any age < 62, and FERS basic benefits also
    // get no COLA before 62, so in the supplement's only active window (pre-62) BOTH
    // values are flat under inflationAdjusted assumptions. The supplement must stay
    // exactly 12000 across ages 58-61 (and the basic benefit stays flat too, per the
    // FERS pre-62 no-COLA rule). This pins the fixed-supplement behavior as a guard.
    it('keeps the FERS supplement fixed (no COLA) before age 62', () => {
      let pension = new FERSPensionIncome(
        'fers-supp', 'FERS Pension', 30, 100000, 57, 1975, 30000, 12000, 24000,
        new Date(2032, 0, 1), new Date(2060, 11, 31)
      );

      for (const age of [58, 59, 60, 61]) {
        pension = pension.increment(mockAssumptions, 2032 + (age - 57), age);
        expect(pension.fersSupplement).toBe(12000); // fixed bridge payment, no COLA
        // FERS basic benefit also gets no COLA before 62 (getFERSCOLA -> 0).
        expect(pension.calculatedBenefit).toBeCloseTo(30000, 0);
      }
    });

    // --- Finding 6: age-62 boundary verification (regression guard) ---
    // increment(assumptions, year, currentAge) is called from IncomeProjection with
    // currentAge = the age DURING `year`. So the supplement must drop to 0 in the
    // SAME year the retiree turns 62, with no extra year of payment. This drives the
    // increment chain the way the projection does and pins the exact boundary.
    it('zeroes the FERS supplement in the age-62 year (no off-by-one overpayment)', () => {
      // Retire at 57 in 2032 (born 1975). Age each year equals 57 + (year - 2032).
      let pension = new FERSPensionIncome(
        'fers-62', 'FERS Pension', 30, 100000, 57, 1975, 30000, 12000, 24000,
        new Date(2032, 0, 1), new Date(2060, 11, 31)
      );

      // getTotalAnnualAmount at retirement (age 57): supplement is paid.
      expect(pension.getTotalAnnualAmount(2032)).toBe(30000 + 12000);

      const supplementByAge: Record<number, number> = {};
      // Walk the increment chain exactly like IncomeProjection: produce the income
      // object FOR each year from the prior year using currentAge = age during year.
      for (let age = 58; age <= 64; age++) {
        const year = 2032 + (age - 57);
        pension = pension.increment(mockAssumptions, year, age);
        supplementByAge[age] = pension.getTotalAnnualAmount(year) - pension.getAnnualAmount(year);
      }

      // Supplement still paid at 58-61...
      expect(supplementByAge[58]).toBe(12000);
      expect(supplementByAge[61]).toBe(12000);
      // ...and drops to 0 starting AT age 62 (the year the retiree IS 62) — no extra year.
      expect(supplementByAge[62]).toBe(0);
      expect(supplementByAge[63]).toBe(0);
    });

    // DIRECT unit tests for FERSPensionIncome.calculateBenefit() - Batch 28
    describe('calculateBenefit - DIRECT tests', () => {
      it('should calculate $30,000 for 30 years, $100k high-3, age 60 (full eligibility, 1% multiplier)', () => {
        // Age 60 with 20+ years = full benefit, no reduction
        // Multiplier is 1% (not 1.1% since age < 62)
        // 30 × $100,000 × 0.01 = $30,000
        const pension = new FERSPensionIncome(
          'fers-calc-1', 'Test FERS', 30, 100000, 60, 1970
        );
        expect(pension.calculateBenefit()).toBe(30000);
      });

      it('should calculate $12,000 for 15 years, $80k high-3, age 62 (1% multiplier since <20 years)', () => {
        // Age 62 with 5+ years = full benefit
        // Multiplier is 1% (not 1.1% since years < 20)
        // 15 × $80,000 × 0.01 = $12,000
        const pension = new FERSPensionIncome(
          'fers-calc-2', 'Test FERS', 15, 80000, 62, 1965
        );
        expect(pension.calculateBenefit()).toBe(12000);
      });

      it('should calculate $26,400 for 20 years, $120k high-3, age 62 (1.1% multiplier)', () => {
        // Age 62 with 20+ years = 1.1% multiplier
        // 20 × $120,000 × 0.011 = $26,400
        const pension = new FERSPensionIncome(
          'fers-calc-3', 'Test FERS', 20, 120000, 62, 1965
        );
        expect(pension.calculateBenefit()).toBe(26400);
      });

      it('should calculate $27,500 for 25 years, $100k high-3, age 65 (1.1% multiplier)', () => {
        // Age 65 with 20+ years = 1.1% multiplier
        // 25 × $100,000 × 0.011 = $27,500
        const pension = new FERSPensionIncome(
          'fers-calc-4', 'Test FERS', 25, 100000, 65, 1960
        );
        expect(pension.calculateBenefit()).toBe(27500);
      });

      it('should calculate $13,500 for 15 years, $100k high-3, age 60 with 10% MRA+10 reduction', () => {
        // Age 60 with 15 years (< 20) triggers MRA+10 reduction
        // Reduction: (62 - 60) × 5% = 10%
        // Base: 15 × $100,000 × 0.01 = $15,000
        // After reduction: $15,000 × 0.90 = $13,500
        const pension = new FERSPensionIncome(
          'fers-calc-5', 'Test FERS', 15, 100000, 60, 1970
        );
        expect(pension.calculateBenefit()).toBe(13500);
      });

      it('should calculate $11,700 for 18 years, $100k high-3, age 58 with 20% MRA+10 reduction', () => {
        // Age 58 with 18 years (< 20) triggers MRA+10 reduction
        // MRA for birth year 1970 = 57, so age 58 >= MRA
        // Reduction: (62 - 58) × 5% = 20%
        // Base: 18 × $100,000 × 0.01 = $18,000
        // After reduction: $18,000 × 0.80 = $14,400
        const pension = new FERSPensionIncome(
          'fers-calc-6', 'Test FERS', 18, 100000, 58, 1970
        );
        expect(pension.calculateBenefit()).toBe(14400);
      });
    });

    // DIRECT unit tests for FERSPensionIncome.calculateSupplement() - Batch 28
    describe('calculateSupplement - DIRECT tests', () => {
      it('should calculate $18,000 supplement for 30 years, $24,000 annual SS at 62', () => {
        // Formula: (yearsOfService / 40) × (estimatedSSAt62 / 12) × 12
        // = (30 / 40) × ($24,000 / 12) × 12 = 0.75 × $2,000 × 12 = $18,000
        // Must be unreduced retirement (MRA + 30 years)
        const pension = new FERSPensionIncome(
          'fers-supp-1', 'Test FERS', 30, 100000, 57, 1970, 0, 0, 24000
        );
        expect(pension.calculateSupplement()).toBe(18000);
      });

      it('should calculate $10,000 supplement for 20 years, $20,000 annual SS at 62', () => {
        // Formula: (20 / 40) × ($20,000 / 12) × 12 = 0.5 × $1,666.67 × 12 = $10,000
        // Need age 60+ with 20+ years for unreduced retirement
        const pension = new FERSPensionIncome(
          'fers-supp-2', 'Test FERS', 20, 100000, 60, 1970, 0, 0, 20000
        );
        expect(pension.calculateSupplement()).toBe(10000);
      });

      it('should calculate $28,000 supplement for 40 years, $28,000 annual SS at 62', () => {
        // Formula: (40 / 40) × ($28,000 / 12) × 12 = 1.0 × $2,333.33 × 12 = $28,000
        const pension = new FERSPensionIncome(
          'fers-supp-3', 'Test FERS', 40, 100000, 57, 1970, 0, 0, 28000
        );
        expect(pension.calculateSupplement()).toBe(28000);
      });

      it('should return $0 supplement for MRA+10 (reduced) retirement', () => {
        // 15 years at age 60 = MRA+10 with 10% reduction
        // MRA+10 retirees don't get the FERS supplement
        const pension = new FERSPensionIncome(
          'fers-supp-4', 'Test FERS', 15, 100000, 60, 1970, 0, 0, 30000
        );
        expect(pension.calculateSupplement()).toBe(0);
      });

      it('should return $0 supplement for retirement at age 62+', () => {
        // Supplement only for retirees before age 62
        const pension = new FERSPensionIncome(
          'fers-supp-5', 'Test FERS', 25, 100000, 62, 1970, 0, 0, 24000
        );
        expect(pension.calculateSupplement()).toBe(0);
      });

      it('should return $0 supplement when estimatedSSAt62 is 0', () => {
        const pension = new FERSPensionIncome(
          'fers-supp-6', 'Test FERS', 30, 100000, 57, 1970, 0, 0, 0
        );
        expect(pension.calculateSupplement()).toBe(0);
      });
    });
  });

  describe('CSRSPensionIncome', () => {
    const csrsPension = new CSRSPensionIncome(
      'csrs-1', 'CSRS Pension', 30, 100000, 55, 56250,
      new Date('2030-01-01'), new Date('2060-12-31')
    );

    it('should calculate benefit using graduated formula', () => {
      // 5 * 1.5% + 5 * 1.75% + 20 * 2% = 7.5% + 8.75% + 40% = 56.25%
      const benefit = csrsPension.calculateBenefit();
      expect(benefit).toBe(56250);
    });

    it('should apply full COLA on increment', () => {
      const nextYear = csrsPension.increment(mockAssumptions);
      // CSRS gets full COLA (3%)
      expect(nextYear.calculatedBenefit).toBeCloseTo(56250 * 1.03, 0);
    });

    it('should preserve autoCalculateHigh3 and linkedIncomeId on increment', () => {
      const pensionWithLink = new CSRSPensionIncome(
        'csrs-2', 'CSRS Pension', 30, 100000, 55, 56250,
        new Date('2030-01-01'), new Date('2060-12-31'),
        true, 'work-income-1'
      );

      const nextYear = pensionWithLink.increment(mockAssumptions);
      expect(nextYear.autoCalculateHigh3).toBe(true);
      expect(nextYear.linkedIncomeId).toBe('work-income-1');
    });

    // DIRECT unit tests for CSRSPensionIncome.calculateBenefit() - Batch 28
    describe('calculateBenefit - DIRECT tests', () => {
      it('should calculate $7,500 for 5 years, $100k high-3 (1.5% tier only)', () => {
        // First 5 years at 1.5%: 5 × $100,000 × 0.015 = $7,500
        const pension = new CSRSPensionIncome(
          'csrs-calc-1', 'Test CSRS', 5, 100000, 62
        );
        expect(pension.calculateBenefit()).toBe(7500);
      });

      it('should calculate $16,250 for 10 years, $100k high-3 (1.5% + 1.75% tiers)', () => {
        // First 5 years: 5 × $100,000 × 0.015 = $7,500
        // Next 5 years: 5 × $100,000 × 0.0175 = $8,750
        // Total: $7,500 + $8,750 = $16,250
        const pension = new CSRSPensionIncome(
          'csrs-calc-2', 'Test CSRS', 10, 100000, 62
        );
        expect(pension.calculateBenefit()).toBe(16250);
      });

      it('should calculate $36,250 for 20 years, $100k high-3 (all three tiers)', () => {
        // First 5 years: 5 × $100,000 × 0.015 = $7,500
        // Years 6-10: 5 × $100,000 × 0.0175 = $8,750
        // Years 11-20: 10 × $100,000 × 0.02 = $20,000
        // Total: $7,500 + $8,750 + $20,000 = $36,250
        const pension = new CSRSPensionIncome(
          'csrs-calc-3', 'Test CSRS', 20, 100000, 60
        );
        expect(pension.calculateBenefit()).toBe(36250);
      });

      it('should calculate $56,250 for 30 years, $100k high-3', () => {
        // First 5 years: $7,500
        // Years 6-10: $8,750
        // Years 11-30: 20 × $100,000 × 0.02 = $40,000
        // Total: $7,500 + $8,750 + $40,000 = $56,250
        const pension = new CSRSPensionIncome(
          'csrs-calc-4', 'Test CSRS', 30, 100000, 55
        );
        expect(pension.calculateBenefit()).toBe(56250);
      });

      it('should cap at $80,000 (80% of $100k) for 42 years', () => {
        // First 5 years: $7,500
        // Years 6-10: $8,750
        // Years 11-42: 32 × $100,000 × 0.02 = $64,000
        // Total before cap: $7,500 + $8,750 + $64,000 = $80,250
        // Capped at 80% of High-3: $80,000
        const pension = new CSRSPensionIncome(
          'csrs-calc-5', 'Test CSRS', 42, 100000, 62
        );
        expect(pension.calculateBenefit()).toBe(80000);
      });

      it('should apply 4% early retirement reduction for age 53 with 30 years', () => {
        // Base benefit: $56,250 (30 years)
        // Early retirement at age 53 with 30+ years qualifies via "any age with 25+ years"
        // Reduction: (55 - 53) × 2% = 4%
        // After reduction: $56,250 × 0.96 = $54,000
        const pension = new CSRSPensionIncome(
          'csrs-calc-6', 'Test CSRS', 30, 100000, 53
        );
        expect(pension.calculateBenefit()).toBe(54000);
      });

      it('should apply 6% early retirement reduction for age 52 with 30 years', () => {
        // Base benefit: $56,250 (30 years)
        // Reduction: (55 - 52) × 2% = 6%
        // After reduction: $56,250 × 0.94 = $52,875
        const pension = new CSRSPensionIncome(
          'csrs-calc-7', 'Test CSRS', 30, 100000, 52
        );
        expect(pension.calculateBenefit()).toBe(52875);
      });

      it('should apply max 10% reduction cap for very early retirement', () => {
        // Age 48 with 25 years qualifies via "any age with 25+ years"
        // Reduction: (55 - 48) × 2% = 14%, but capped at 10%
        // Base: 5×1.5% + 5×1.75% + 15×2% = $7,500 + $8,750 + $30,000 = $46,250
        // After 10% reduction: $46,250 × 0.90 = $41,625
        const pension = new CSRSPensionIncome(
          'csrs-calc-8', 'Test CSRS', 25, 100000, 48
        );
        expect(pension.calculateBenefit()).toBe(41625);
      });
    });
  });

  describe('reconstituteIncome - Pension Types', () => {
    it('should reconstitute FERSPensionIncome with all properties', () => {
      const data = {
        className: 'FERSPensionIncome',
        id: 'fers-1',
        name: 'FERS Pension',
        amount: 22000,
        frequency: 'Annually' as const,
        yearsOfService: 25,
        high3Salary: 100000,
        retirementAge: 62,
        birthYear: 1970,
        calculatedBenefit: 22000,
        fersSupplement: 0,
        estimatedSSAt62: 24000,
        autoCalculateHigh3: true,
        linkedIncomeId: 'work-1',
        startDate: '2032-01-01',
        end_date: '2060-12-31',
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();
      expect(income?.constructor.name).toBe('FERSPensionIncome');
      expect(income?.id).toBe('fers-1');
      expect(income?.name).toBe('FERS Pension');

      if (income && 'yearsOfService' in income) {
        const pension = income as FERSPensionIncome;
        expect(pension.yearsOfService).toBe(25);
        expect(pension.high3Salary).toBe(100000);
        expect(pension.retirementAge).toBe(62);
        expect(pension.birthYear).toBe(1970);
        expect(pension.autoCalculateHigh3).toBe(true);
        expect(pension.linkedIncomeId).toBe('work-1');
      }
    });

    it('should reconstitute CSRSPensionIncome with all properties', () => {
      const data = {
        className: 'CSRSPensionIncome',
        id: 'csrs-1',
        name: 'CSRS Pension',
        amount: 56250,
        frequency: 'Annually' as const,
        yearsOfService: 30,
        high3Salary: 100000,
        retirementAge: 55,
        calculatedBenefit: 56250,
        autoCalculateHigh3: false,
        linkedIncomeId: null,
        startDate: '2030-01-01',
        end_date: '2060-12-31',
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();
      expect(income?.constructor.name).toBe('CSRSPensionIncome');

      if (income && 'yearsOfService' in income) {
        const pension = income as CSRSPensionIncome;
        expect(pension.yearsOfService).toBe(30);
        expect(pension.high3Salary).toBe(100000);
        expect(pension.retirementAge).toBe(55);
        expect(pension.autoCalculateHigh3).toBe(false);
        expect(pension.linkedIncomeId).toBeNull();
      }
    });

    it('should handle FERSPensionIncome with defaults when optional fields missing', () => {
      const data = {
        className: 'FERSPensionIncome',
        id: 'fers-2',
        name: 'FERS Pension',
        amount: 0,
        frequency: 'Annually' as const,
      };

      const income = reconstituteIncome(data);

      expect(income).not.toBeNull();

      if (income && 'yearsOfService' in income) {
        const pension = income as FERSPensionIncome;
        expect(pension.yearsOfService).toBe(0);
        expect(pension.high3Salary).toBe(0);
        expect(pension.retirementAge).toBe(62); // default
        expect(pension.birthYear).toBe(1970); // default
        expect(pension.autoCalculateHigh3).toBe(false); // default
        expect(pension.linkedIncomeId).toBeNull(); // default
      }
    });
  });

  // --- LOCAL date-only convention regression tests (timezone safety) ---
  // Income date-only values are stored as LOCAL-midnight Dates (parseDate builds
  // `new Date(y, m-1, d)`), and the readers (getIncomeActiveMultiplier /
  // isIncomeActiveInCurrentMonth) now read them with local accessors. A date
  // entered as Y-M-D therefore round-trips to the same Y-M-D in ANY timezone.
  // These cases construct dates the same way the app does (local) and assert the
  // active/inactive outcomes hold under both positive- and negative-UTC TZs.
  describe('LOCAL date-only handling (timezone safety)', () => {
    it('agrees with getIncomeActiveMultiplier on the current year for local dates', () => {
      const now = new Date();
      const localThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const income = new PassiveIncome('i-local', 'Local active', 1000, 'Annually', 'No', 'Interest', localThisMonth);

      expect(isIncomeActiveInCurrentMonth(income)).toBe(true);
      expect(getIncomeActiveMultiplier(income, now.getFullYear())).toBeGreaterThan(0);
    });

    it('treats a next-month local start as inactive (not pulled into this month)', () => {
      const now = new Date();
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const income = new PassiveIncome('i-next', 'Next month', 1000, 'Annually', 'No', 'Interest', nextMonthStart);
      expect(isIncomeActiveInCurrentMonth(income)).toBe(false);
    });

    it('treats a future local start as inactive', () => {
      const future = new Date(new Date().getFullYear() + 2, 0, 1);
      const income = new PassiveIncome('i-future', 'Future', 1000, 'Annually', 'No', 'Interest', future);
      expect(isIncomeActiveInCurrentMonth(income)).toBe(false);
    });

    it('treats a local end date in the past as inactive', () => {
      const start = new Date(new Date().getFullYear() - 3, 0, 1);
      const end = new Date(new Date().getFullYear() - 1, 0, 1);
      const income = new PassiveIncome('i-ended', 'Ended', 1000, 'Annually', 'No', 'Interest', start, end);
      expect(isIncomeActiveInCurrentMonth(income)).toBe(false);
    });

    // Finding 1: a Jan-1 local start is FULLY active in its start year (multiplier 1),
    // not suppressed, in any timezone — the core round-trip guarantee.
    it('start-of-year local start yields multiplier 1 in its start year', () => {
      const start = new Date(2032, 0, 1); // local Jan 1 2032
      const income = new PassiveIncome('i-jan', 'Jan start', 1000, 'Annually', 'No', 'Interest', start);
      expect(getIncomeActiveMultiplier(income, 2032)).toBe(1);
    });
  });
});
