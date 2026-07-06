import { describe, it, expect } from 'vitest';
import {
  calculateAIME,
  calculatePIA,
  applyWageIndexing,
  applyClaimingAdjustment,
  extractEarningsFromSimulation,
  calculateEarningsTestReduction,
  shouldApplyEarningsTest,
  validateEarningsRecord,
  EarningsRecord,
} from '../../services/SocialSecurityCalculator';
import {
  getWageIndexFactor,
  getBendPoints,
  getWageBase,
  getEarningsTestLimit,
  getFRA,
  getClaimingAdjustment,
  lookupYearlyData,
} from '../../data/SocialSecurityData';
import { SimulationYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { WorkIncome } from '../../components/Objects/Income/models';

/**
 * Test Suite for Social Security Calculator
 *
 * These tests verify the SSA's AIME/PIA calculation algorithm using known test cases
 * and edge cases to ensure accurate benefit calculations.
 */

describe('SocialSecurityCalculator', () => {

  describe('applyWageIndexing', () => {
    it('should index historical earnings correctly', () => {
      // Example: Worker turns 60 in 2022, earned $40,000 in 2000
      // 2022 wage index: 63795.13, 2000 wage index: 32154.82
      // Expected: $40,000 × (63795.13 / 32154.82) = $79,323
      const earnings: EarningsRecord = { year: 2000, amount: 40000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      // Expected is approximately 79,323 (slight variation due to wage index precision)
      expect(indexed).toBeGreaterThan(79000);
      expect(indexed).toBeLessThan(80000);
    });

    it('should not index earnings at or after index year', () => {
      const earnings: EarningsRecord = { year: 2022, amount: 50000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      expect(indexed).toBe(50000);
    });

    it('should handle future earnings (after age 60)', () => {
      const earnings: EarningsRecord = { year: 2024, amount: 75000 };
      const indexYear = 2022;

      const indexed = applyWageIndexing(earnings, indexYear);

      expect(indexed).toBe(75000); // No indexing for post-60 earnings
    });
  });

  describe('calculatePIA', () => {
    it('should calculate PIA correctly using 2024 bend points', () => {
      // 2024 bend points: $1,174 (first), $7,078 (second)
      // Example: AIME = $5,000
      // PIA = (0.90 × $1,174) + (0.32 × ($5,000 - $1,174)) + (0.15 × 0)
      //     = $1,056.60 + $1,224.32 + $0
      //     = $2,280.92
      const aime = 5000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      expect(pia).toBeCloseTo(2280.92, 2);
    });

    it('should handle low AIME (only first bend point)', () => {
      // AIME below first bend point
      const aime = 1000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = 0.90 × $1,000 = $900
      expect(pia).toBeCloseTo(900, 2);
    });

    it('should handle high AIME (all three portions)', () => {
      // AIME above second bend point
      const aime = 10000;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = (0.90 × $1,174) + (0.32 × ($7,078 - $1,174)) + (0.15 × ($10,000 - $7,078))
      //     = $1,056.60 + $1,889.28 + $438.30
      //     = $3,384.18
      expect(pia).toBeCloseTo(3384.18, 2);
    });

    it('should handle maximum taxable earnings (2024: $168,600)', () => {
      // Simulate someone who earned max SS taxable every year
      // AIME would be roughly $14,050 (168,600 / 12)
      const aime = 14050;
      const year = 2024;

      const pia = calculatePIA(aime, year);

      // PIA = (0.90 × $1,174) + (0.32 × ($7,078 - $1,174)) + (0.15 × ($14,050 - $7,078))
      //     = $1,056.60 + $1,889.28 + $1,045.80
      //     = $3,991.68
      expect(pia).toBeCloseTo(3991.68, 2);

      // SSA maximum benefit in 2024 is approximately $3,822/month at FRA
      // Our calculation should be in this ballpark
      expect(pia).toBeGreaterThan(3800);
      expect(pia).toBeLessThan(4200);
    });
  });

  describe('applyClaimingAdjustment', () => {
    it('should reduce benefits for early claiming (age 62)', () => {
      const pia = 2000;
      const claimingAge = 62;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 70% of PIA for claiming at 62 (5 years early)
      expect(adjusted).toBeCloseTo(1400, 2);
    });

    it('should provide full benefit at Full Retirement Age (67)', () => {
      const pia = 2000;
      const claimingAge = 67;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 100% of PIA at FRA
      expect(adjusted).toBeCloseTo(2000, 2);
    });

    it('should increase benefits for delayed claiming (age 70)', () => {
      const pia = 2000;
      const claimingAge = 70;

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // 124% of PIA for claiming at 70 (3 years late, 8% per year)
      expect(adjusted).toBeCloseTo(2480, 2);
    });

    it('should handle fractional ages correctly', () => {
      const pia = 2000;
      const claimingAge = 66.5; // 66 years 6 months

      const adjusted = applyClaimingAdjustment(pia, claimingAge);

      // Should be between 93.3% (age 66) and 100% (age 67)
      expect(adjusted).toBeGreaterThan(1866); // 93.3% of 2000
      expect(adjusted).toBeLessThan(2000);
    });
  });

  describe('calculateAIME - Full Integration', () => {
    it('should calculate AIME correctly with 35 years of constant earnings', () => {
      // Worker earning $60,000/year for 35 years
      const earnings: EarningsRecord[] = [];
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 60000 });
      }

      const calculationYear = 2022; // Turned 62 in 2022
      const claimingAge = 67;
      const birthYear = 1960; // Born in 1960, FRA = 67

      const result = calculateAIME(earnings, calculationYear, claimingAge, birthYear);

      expect(result.topEarnings).toHaveLength(35);
      expect(result.indexedEarnings).toHaveLength(35);
      expect(result.aime).toBeGreaterThan(0);
      expect(result.pia).toBeGreaterThan(0);
      expect(result.adjustedBenefit).toBeCloseTo(result.pia, 2); // FRA claiming
    });

    it('should pad with zeros for less than 35 years of work', () => {
      // Worker with only 20 years of earnings
      const earnings: EarningsRecord[] = [];
      for (let year = 2000; year <= 2019; year++) {
        earnings.push({ year, amount: 50000 });
      }

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should have 35 total years (20 real + 15 zeros)
      expect(result.indexedEarnings).toHaveLength(35);

      // Check that 15 zeros were added
      const zeroCount = result.indexedEarnings.filter(e => e === 0).length;
      expect(zeroCount).toBe(15);

      // AIME should be lower than if they worked all 35 years
      expect(result.aime).toBeLessThan(50000 / 12);
    });

    it('should select top 35 years when more than 35 years available', () => {
      // Worker with 40 years of varying earnings
      const earnings: EarningsRecord[] = [
        // 5 low-earning years (should be excluded)
        { year: 1980, amount: 10000 },
        { year: 1981, amount: 12000 },
        { year: 1982, amount: 15000 },
        { year: 1983, amount: 18000 },
        { year: 1984, amount: 20000 },
        // 35 higher-earning years (should be included)
        ...Array.from({ length: 35 }, (_, i) => ({
          year: 1985 + i,
          amount: 60000 + (i * 1000), // Gradually increasing
        })),
      ];

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should only use top 35 years
      expect(result.topEarnings).toHaveLength(35);

      // All selected earnings should be >= $60,000
      const allAboveThreshold = result.topEarnings.every(e => e.amount >= 60000);
      expect(allAboveThreshold).toBe(true);
    });

    it('should handle claiming before 35 years of work', () => {
      // Worker claims at 62 with only 30 years of work
      const earnings: EarningsRecord[] = [];
      for (let year = 1992; year <= 2021; year++) {
        earnings.push({ year, amount: 70000 });
      }

      const result = calculateAIME(earnings, 2022, 62, 1960);

      // Should still calculate with 35 years (30 real + 5 zeros)
      expect(result.indexedEarnings).toHaveLength(35);

      // Benefit should be reduced both for zeros AND early claiming
      expect(result.adjustedBenefit).toBeLessThan(result.pia);
    });
  });

  describe('extractEarningsFromSimulation', () => {
    it('should extract work income from simulation years', () => {
      // Create mock simulation years with work income
      // Use Date constructor with args to ensure local time (month is 0-indexed)
      const mockSimulation: SimulationYear[] = [
        {
          year: 2020,
          incomes: [
            new WorkIncome('1', 'Job', 80000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2020, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
        {
          year: 2021,
          incomes: [
            new WorkIncome('1', 'Job', 85000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2020, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(2);
      expect(earnings[0]).toEqual({ year: 2020, amount: 80000 });
      expect(earnings[1]).toEqual({ year: 2021, amount: 85000 });
    });

    it('should cap earnings at SS wage base', () => {
      // 2024 SS wage base: $168,600
      // Use Date constructor with args to ensure local time
      const mockSimulation: SimulationYear[] = [
        {
          year: 2024,
          incomes: [
            new WorkIncome('1', 'Job', 250000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2024, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(1);
      expect(earnings[0].amount).toBeLessThanOrEqual(168600);
    });

    it('caps earnings using the SAME wage-growth rate as AIME indexing', () => {
      // A high earner whose salary binds the cap in a projected (post-2030) year.
      // The cap must project at the caller's wage-growth rate, not a hardcoded 2.5%,
      // so the earnings fed into AIME indexing/bend points are internally consistent.
      // 2050 wage base: ~$360,300 at 2.5%, ~$583,500 at 5%.
      const mockSimulation: SimulationYear[] = [
        {
          year: 2050,
          incomes: [
            new WorkIncome('1', 'Job', 600000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2050, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const cappedAt25 = getWageBase(2050, 0.025, true);
      const cappedAt5 = getWageBase(2050, 0.05, true);
      // Sanity: the two rates must actually disagree for this test to be meaningful.
      expect(cappedAt5).toBeGreaterThan(cappedAt25);

      // Threading 5% wage growth should cap at the 5%-projected base, not the 2.5% one.
      const earnings5 = extractEarningsFromSimulation(mockSimulation, undefined, true, undefined, 0.05);
      expect(earnings5[0].amount).toBe(cappedAt5);
      expect(earnings5[0].amount).not.toBe(cappedAt25);

      // Default (no rate) still caps at the legacy 2.5% base — backward compatible.
      const earningsDefault = extractEarningsFromSimulation(mockSimulation);
      expect(earningsDefault[0].amount).toBe(cappedAt25);
    });

    it('caps auto-generated prior earnings using the passed wage-growth rate', () => {
      // Job started in 2042 at $600k, simulation starts 2050. The 2042-2049 auto-generated
      // years are also projected past 2030, so their cap must honor the same rate.
      const mockSimulation: SimulationYear[] = [
        {
          year: 2050,
          incomes: [
            new WorkIncome('1', 'Job', 600000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2042, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings5 = extractEarningsFromSimulation(mockSimulation, undefined, true, undefined, 0.05);
      const auto2045 = earnings5.find(e => e.year === 2045)!;
      expect(auto2045.amount).toBe(getWageBase(2045, 0.05, true));
      expect(auto2045.amount).not.toBe(getWageBase(2045, 0.025, true));
    });

    it('should combine multiple work incomes in same year', () => {
      // Use Date constructor with args to ensure local time
      const mockSimulation: SimulationYear[] = [
        {
          year: 2020,
          incomes: [
            new WorkIncome('1', 'Job 1', 50000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2020, 0, 1), undefined),
            new WorkIncome('2', 'Job 2', 30000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(2020, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {} as any,
          taxDetails: {} as any,
          logs: [],
        },
      ];

      const earnings = extractEarningsFromSimulation(mockSimulation);

      expect(earnings).toHaveLength(1);
      expect(earnings[0].amount).toBe(80000); // 50k + 30k
    });

    describe('priority override logic', () => {
      it('imported SSA earnings override simulation earnings', () => {
        const mockSimulation: SimulationYear[] = [
          {
            year: 2020,
            incomes: [
              new WorkIncome('1', 'Job', 80000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2020, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
        ];

        const importedSSAEarnings: EarningsRecord[] = [
          { year: 2020, amount: 75000 },
        ];

        const earnings = extractEarningsFromSimulation(mockSimulation, importedSSAEarnings);

        expect(earnings).toHaveLength(1);
        expect(earnings[0].amount).toBe(75000); // Imported wins over simulation
      });

      it('imported SSA earnings override auto-generated earnings', () => {
        // Job started in 2015 with $60k salary, simulation starts 2020
        const mockSimulation: SimulationYear[] = [
          {
            year: 2020,
            incomes: [
              new WorkIncome('1', 'Job', 60000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined), // Started in 2015
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
        ];

        const importedSSAEarnings: EarningsRecord[] = [
          { year: 2018, amount: 50000 },
        ];

        const earnings = extractEarningsFromSimulation(mockSimulation, importedSSAEarnings);
        const year2018 = earnings.find(e => e.year === 2018);

        expect(year2018).toBeDefined();
        expect(year2018!.amount).toBe(50000); // Imported wins over auto-generated $60k
      });

      it('simulation earnings override auto-generated earnings', () => {
        // Job started in 2015 with $60k salary
        // Simulation year 2018 has actual earnings of $70k
        const mockSimulation: SimulationYear[] = [
          {
            year: 2018,
            incomes: [
              new WorkIncome('1', 'Job', 70000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined), // Started in 2015, but 2018 has $70k
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
        ];

        const earnings = extractEarningsFromSimulation(mockSimulation);
        const year2018 = earnings.find(e => e.year === 2018);

        expect(year2018).toBeDefined();
        expect(year2018!.amount).toBe(70000); // Simulation wins over auto-generated
      });

      it('auto-generation creates records for pre-simulation years', () => {
        // Job started in 2015 with $100k salary, simulation starts in 2020
        const mockSimulation: SimulationYear[] = [
          {
            year: 2020,
            incomes: [
              new WorkIncome('1', 'Job', 100000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
        ];

        const earnings = extractEarningsFromSimulation(mockSimulation);

        // Should have records for 2015, 2016, 2017, 2018, 2019 (auto) + 2020 (simulation)
        expect(earnings.find(e => e.year === 2015)).toBeDefined();
        expect(earnings.find(e => e.year === 2016)).toBeDefined();
        expect(earnings.find(e => e.year === 2017)).toBeDefined();
        expect(earnings.find(e => e.year === 2018)).toBeDefined();
        expect(earnings.find(e => e.year === 2019)).toBeDefined();
        expect(earnings.find(e => e.year === 2020)).toBeDefined();

        // Auto-generated should be capped at wage base (all years < $100k wage base would be $100k)
        const year2019 = earnings.find(e => e.year === 2019);
        expect(year2019!.amount).toBe(100000); // $100k < 2019 wage base of $132,900
      });

      it('all three tiers combined correctly', () => {
        // Job started 2015 with $60k salary (auto-generates 2015-2019)
        // Simulation 2020-2023 with varying earnings
        // Imported SSA for 2017, 2018, 2022
        const mockSimulation: SimulationYear[] = [
          {
            year: 2020,
            incomes: [
              new WorkIncome('1', 'Job', 60000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
          {
            year: 2021,
            incomes: [
              new WorkIncome('1', 'Job', 65000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
          {
            year: 2022,
            incomes: [
              new WorkIncome('1', 'Job', 70000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
          {
            year: 2023,
            incomes: [
              new WorkIncome('1', 'Job', 75000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
                new Date(2015, 0, 1), undefined),
            ],
            expenses: [],
            accounts: [],
            cashflow: {} as any,
            taxDetails: {} as any,
            logs: [],
          },
        ];

        const importedSSAEarnings: EarningsRecord[] = [
          { year: 2017, amount: 55000 },
          { year: 2018, amount: 58000 },
          { year: 2022, amount: 72000 },
        ];

        const earnings = extractEarningsFromSimulation(mockSimulation, importedSSAEarnings);

        // 2015-2016: auto-generated ($60k)
        expect(earnings.find(e => e.year === 2015)!.amount).toBe(60000);
        expect(earnings.find(e => e.year === 2016)!.amount).toBe(60000);

        // 2017-2018: imported (overrides auto-generated)
        expect(earnings.find(e => e.year === 2017)!.amount).toBe(55000);
        expect(earnings.find(e => e.year === 2018)!.amount).toBe(58000);

        // 2019: auto-generated ($60k)
        expect(earnings.find(e => e.year === 2019)!.amount).toBe(60000);

        // 2020-2021: simulation
        expect(earnings.find(e => e.year === 2020)!.amount).toBe(60000);
        expect(earnings.find(e => e.year === 2021)!.amount).toBe(65000);

        // 2022: imported (overrides simulation $70k)
        expect(earnings.find(e => e.year === 2022)!.amount).toBe(72000);

        // 2023: simulation
        expect(earnings.find(e => e.year === 2023)!.amount).toBe(75000);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero earnings gracefully', () => {
      const earnings: EarningsRecord[] = [];

      const result = calculateAIME(earnings, 2024, 67, 1960);

      expect(result.aime).toBe(0);
      expect(result.pia).toBe(0);
      expect(result.adjustedBenefit).toBe(0);
    });

    it('should handle very high earners (above wage base)', () => {
      const earnings: EarningsRecord[] = [];

      // Earner making $500k/year (well above wage base)
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 500000 });
      }

      const result = calculateAIME(earnings, 2022, 67, 1960);

      // Should be very high but depends on wage indexing
      // For someone earning $500k (capped at wage base) for 35 years, benefit is high
      expect(result.adjustedBenefit).toBeGreaterThan(3500);
      expect(result.adjustedBenefit).toBeLessThan(15000); // Realistic upper bound
    });

    it('should handle claiming age boundaries', () => {
      const earnings: EarningsRecord[] = [
        { year: 2000, amount: 60000 },
      ];

      // Test minimum claiming age (62)
      const min = calculateAIME(earnings, 2024, 62, 1960);
      expect(min.claimingAge).toBe(62);

      // Test maximum claiming age (70)
      const max = calculateAIME(earnings, 2024, 70, 1960);
      expect(max.claimingAge).toBe(70);
    });

    it('should handle different FRAs by birth year', () => {
      const earnings: EarningsRecord[] = [];
      for (let year = 1985; year <= 2019; year++) {
        earnings.push({ year, amount: 60000 });
      }

      // Born in 1955: FRA = 66 years 2 months
      const result1955 = calculateAIME(earnings, 2022, 66.167, 1955);

      // Born in 1960+: FRA = 67
      const result1960 = calculateAIME(earnings, 2022, 67, 1960);

      // At their respective FRAs, PIA should be 100% of calculated
      expect(result1955.adjustedBenefit).toBeCloseTo(result1955.pia, 2);
      expect(result1960.adjustedBenefit).toBeCloseTo(result1960.pia, 2);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should match SSA calculator for typical worker', () => {
      // Typical worker: $50k/year from age 22 to 67
      const earnings: EarningsRecord[] = [];
      const startYear = 1980;
      const endYear = 2024;

      for (let year = startYear; year <= endYear; year++) {
        // Adjust for inflation/wage growth (roughly 3% per year)
        const inflationAdjusted = 50000 * Math.pow(1.03, year - startYear);
        earnings.push({ year, amount: Math.min(inflationAdjusted, 168600) });
      }

      const result = calculateAIME(earnings, 2024, 67, 1958);

      // Benefit range depends heavily on wage indexing and years worked
      // With inflation adjustment, can be higher than simple expectations
      expect(result.adjustedBenefit).toBeGreaterThan(1800);
      expect(result.adjustedBenefit).toBeLessThan(5000);
    });

    it('should show benefit difference: early career vs late career earnings', () => {
      const earningsEarly: EarningsRecord[] = [];
      const earningsLate: EarningsRecord[] = [];

      // Early career high earner (then stops working)
      for (let year = 1985; year <= 2004; year++) {
        earningsEarly.push({ year, amount: 100000 });
      }

      // Late career high earner (starts working later)
      for (let year = 2005; year <= 2024; year++) {
        earningsLate.push({ year, amount: 100000 });
      }

      const resultEarly = calculateAIME(earningsEarly, 2024, 67, 1958);
      const resultLate = calculateAIME(earningsLate, 2024, 67, 1958);

      // Both have same number of years and same earnings amount
      // Early earner's wages get indexed higher (older wages indexed more)
      // Difference can be significant due to wage indexing
      expect(Math.abs(resultEarly.pia - resultLate.pia)).toBeLessThan(1500);
    });

    it('should demonstrate value of working longer', () => {
      const earnings20: EarningsRecord[] = [];
      const earnings30: EarningsRecord[] = [];
      const earnings35: EarningsRecord[] = [];

      // 20 years of $60k
      for (let i = 0; i < 20; i++) {
        earnings20.push({ year: 2000 + i, amount: 60000 });
      }

      // 30 years of $60k
      for (let i = 0; i < 30; i++) {
        earnings30.push({ year: 1990 + i, amount: 60000 });
      }

      // 35 years of $60k
      for (let i = 0; i < 35; i++) {
        earnings35.push({ year: 1985 + i, amount: 60000 });
      }

      const result20 = calculateAIME(earnings20, 2022, 67, 1960);
      const result30 = calculateAIME(earnings30, 2022, 67, 1960);
      const result35 = calculateAIME(earnings35, 2022, 67, 1960);

      // More years = higher benefit (due to fewer zero years)
      expect(result30.pia).toBeGreaterThan(result20.pia);
      expect(result35.pia).toBeGreaterThan(result30.pia);
    });
  });

  describe('Social Security Earnings Test', () => {
    describe('calculateEarningsTestReduction', () => {
      it('should not apply test after Full Retirement Age', () => {
        const result = calculateEarningsTestReduction(
          30000,  // $30k annual SS benefit
          50000,  // $50k earned income
          68,     // Age 68 (after FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.reducedBenefit).toBe(30000);
        expect(result.amountWithheld).toBe(0);
        expect(result.reason).toContain('after Full Retirement Age');
      });

      it('should not apply test if earnings below threshold', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit ($2k/month)
          20000,  // $20k earned income (below $22,320 limit)
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.reducedBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(0);
        expect(result.reason).toContain('below threshold');
      });

      it('should apply test before FRA with correct withholding ($1 per $2)', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          42320,  // $42,320 earned income
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        // Excess earnings = $42,320 - $22,320 = $20,000
        // Withholding = $20,000 / 2 = $10,000
        // Reduced benefit = $24,000 - $10,000 = $14,000

        expect(result.appliesTest).toBe(true);
        expect(result.originalBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $2');
      });

      it('should apply test in year of FRA with correct withholding ($1 per $3)', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          89520,  // $89,520 earned income
          67,     // Attained age 67 = year of FRA (year the worker reaches FRA)
          67,     // FRA = 67
          2024
        );

        // Excess earnings = $89,520 - $59,520 = $30,000
        // Withholding = $30,000 / 3 = $10,000
        // Reduced benefit = $24,000 - $10,000 = $14,000

        expect(result.appliesTest).toBe(true);
        expect(result.originalBenefit).toBe(24000);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $3');
        expect(result.reason).toContain('year of FRA');
      });

      it('should cap withholding at total benefit amount', () => {
        const result = calculateEarningsTestReduction(
          12000,   // $12k annual SS benefit
          100000,  // $100k earned income (way above limit)
          64,      // Age 64 (before FRA)
          67,      // FRA = 67
          2024
        );

        // Excess earnings = $100,000 - $22,320 = $77,680
        // Calculated withholding = $77,680 / 2 = $38,840
        // But capped at benefit amount: $12,000

        expect(result.appliesTest).toBe(true);
        expect(result.amountWithheld).toBe(12000);
        expect(result.reducedBenefit).toBe(0);  // Benefits suspended
      });

      it('should handle edge case at exact threshold', () => {
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          22320,  // Exactly at limit
          64,     // Age 64 (before FRA)
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(false);
        expect(result.amountWithheld).toBe(0);
        expect(result.reducedBenefit).toBe(24000);
      });

      it('attained age 66 (FRA 67) uses the STRICT before-FRA limit, not the FRA-year one', () => {
        // The engine passes currentAge = year - birthYear (the age the worker ATTAINS this
        // calendar year). For a worker born 1960 (FRA 67), attained age 66 is the calendar
        // year BEFORE they reach FRA, so the strict before-FRA limit ($1/$2 above ~$22,320)
        // must apply — NOT the lenient FRA-year limit ($1/$3 above ~$59,520).
        // Earn $42,320: strict → withhold ($42,320-$22,320)/2 = $10,000.
        // The old off-by-one window (currentAge>=66 && <67) wrongly treated 66 as the FRA
        // year, found earnings below the $59,520 FRA-year limit, and withheld $0.
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          42320,  // $42,320 earned income
          66,     // Attained age 66 — a full year before FRA under attained-age semantics
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(true);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $2');
        expect(result.reason).not.toContain('year of FRA');
      });

      it('attained age 67 (FRA 67) is the FRA year and uses the lenient $1/$3 limit', () => {
        // The year the worker ATTAINS FRA (attained age === ceil(FRA)). The higher FRA-year
        // limit (~$59,520) and 1/3 withholding apply. Earn $89,520 → ($89,520-$59,520)/3 = $10,000.
        const result = calculateEarningsTestReduction(
          24000,  // $24k annual SS benefit
          89520,  // $89,520 earned income
          67,     // Attained age 67 — the year FRA is reached
          67,     // FRA = 67
          2024
        );

        expect(result.appliesTest).toBe(true);
        expect(result.amountWithheld).toBe(10000);
        expect(result.reducedBenefit).toBe(14000);
        expect(result.reason).toContain('$1 for every $3');
        expect(result.reason).toContain('year of FRA');
      });

      it('attained age 68 (FRA 67) is fully past FRA — no test', () => {
        const result = calculateEarningsTestReduction(
          30000, 100000, 68, 67, 2024
        );
        expect(result.appliesTest).toBe(false);
        expect(result.reducedBenefit).toBe(30000);
        expect(result.amountWithheld).toBe(0);
      });
    });

    describe('shouldApplyEarningsTest (caller age gate)', () => {
      // The production caller must gate on this helper, NOT `currentAge < fra`. A strict
      // `< fra` skips the FRA-attainment year (attained age === ceil(fra)), so that year's
      // lenient $1/$3 withholding is never applied even though it should be.
      it('includes every year up to and INCLUDING the FRA-attainment year (FRA 67, claimed early)', () => {
        expect(shouldApplyEarningsTest(62, 67, 62)).toBe(true);
        expect(shouldApplyEarningsTest(66, 67, 62)).toBe(true);
        expect(shouldApplyEarningsTest(67, 67, 62)).toBe(true); // FRA year — a strict `< fra` would drop this
        expect(shouldApplyEarningsTest(68, 67, 62)).toBe(false); // fully past FRA
      });

      it('never applies to a benefit claimed at or after FRA (no pre-FRA benefit months)', () => {
        expect(shouldApplyEarningsTest(67, 67, 67)).toBe(false); // claimed AT FRA
        expect(shouldApplyEarningsTest(70, 67, 70)).toBe(false); // delayed claim
        expect(shouldApplyEarningsTest(67, 66.5, 66.5)).toBe(false);
      });

      it('rounds a fractional FRA up (FRA 66.5 → age 67 is still the FRA year, claimed early)', () => {
        expect(shouldApplyEarningsTest(66, 66.5, 63)).toBe(true);
        expect(shouldApplyEarningsTest(67, 66.5, 63)).toBe(true); // ceil(66.5) = 67
        expect(shouldApplyEarningsTest(68, 66.5, 63)).toBe(false);
      });

      it('agrees with calculateEarningsTestReduction: the FRA year it admits is not a no-op', () => {
        // Gate admits the FRA year (for an early claimer), and the reduction fn
        // applies the lenient $1/$3 there.
        expect(shouldApplyEarningsTest(67, 67, 62)).toBe(true);
        const fraYear = calculateEarningsTestReduction(24000, 89520, 67, 67, 2024);
        expect(fraYear.appliesTest).toBe(true);
        expect(fraYear.reason).toContain('year of FRA');
        // Gate excludes the year after; the reduction fn no-ops there anyway.
        expect(shouldApplyEarningsTest(68, 67, 62)).toBe(false);
        const pastFRA = calculateEarningsTestReduction(24000, 89520, 68, 67, 2024);
        expect(pastFRA.appliesTest).toBe(false);
      });
    });
  });

  describe('pre-2000 wage base (issue #188)', () => {
    // Before the fix, SS_WAGE_BASE started at 2000 ($76,200), so any pre-2000 year fell
    // through lookupYearlyData to the earliest entry (2000) and was over-capped at $76,200.
    // The real published contribution-and-benefit bases are far lower (e.g. 1985 $39,600).
    it('getWageBase returns the real historical cap, not the 2000 fallback', () => {
      expect(getWageBase(1985)).toBe(39600);
      expect(getWageBase(1990)).toBe(51300);
      expect(getWageBase(1995)).toBe(61200);
      expect(getWageBase(1999)).toBe(72600);
      // Sanity: none of these equal the old 2000-base fallback.
      expect(getWageBase(1985)).not.toBe(76200);
    });

    it('caps auto-generated pre-2000 earnings at the year cap (not $76,200)', () => {
      // High earner ($200k) whose job started in 1995; simulation starts in 2000.
      // Auto-generated 1995-1999 earnings must be capped at each year's real wage base.
      // extractEarningsFromSimulation only reads year/incomes; the rest is padding.
      const mockSimulation = [
        {
          year: 2000,
          incomes: [
            new WorkIncome('1', 'Job', 200000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
              new Date(1995, 0, 1), undefined),
          ],
          expenses: [],
          accounts: [],
          cashflow: {},
          taxDetails: {},
          logs: [],
        },
      ] as unknown as SimulationYear[];

      const earnings = extractEarningsFromSimulation(mockSimulation);
      const y1995 = earnings.find(e => e.year === 1995);
      const y1999 = earnings.find(e => e.year === 1999);

      // After the fix: capped at the real base. Before the fix these were $76,200.
      expect(y1995!.amount).toBe(61200);
      expect(y1999!.amount).toBe(72600);
    });
  });

  describe('calculateAIME eligibilityYear fallback (issue #188)', () => {
    // When birthYear is omitted, the eligibility year (year turning 62) must be derived as
    // (calculationYear - claimingAge) + 62, i.e. birthYear + 62 — NOT with an extra +62.
    // The old code added +62 twice, landing ~62 years too late and pulling bend points from
    // the far-future projection (inflating PIA). All current callers pass birthYear, so this
    // is latent, but the derived path must match the explicit path.
    it('derives the same result with and without birthYear for a matched scenario', () => {
      const earnings: EarningsRecord[] = [];
      for (let year = 1988; year <= 2022; year++) {
        earnings.push({ year, amount: 60000 });
      }
      const birthYear = 1962;
      const claimingAge = 62;
      const calculationYear = birthYear + claimingAge; // 2024

      const withBirthYear = calculateAIME(earnings, calculationYear, claimingAge, birthYear);
      const withoutBirthYear = calculateAIME(earnings, calculationYear, claimingAge);

      // Bend points are frozen at eligibilityYear; the derived path must land on the same year.
      expect(withoutBirthYear.bendPoints).toEqual(withBirthYear.bendPoints);
      // Old bug: fallback eligibilityYear = birthYear + 124 → far-future projected bend
      // points → inflated PIA. Fixed: derived PIA matches the explicit-birthYear PIA.
      expect(withoutBirthYear.pia).toBeCloseTo(withBirthYear.pia, 2);
    });
  });

  describe('InflationAdjusted Parameter', () => {
    describe('SocialSecurityData functions', () => {
      it('getWageIndexFactor should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const factor2030 = getWageIndexFactor(2030);
        const factor2040NoInflation = getWageIndexFactor(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(factor2040NoInflation).toBe(factor2030);
      });

      it('getWageIndexFactor should project when inflationAdjusted is true', () => {
        const factor2030 = getWageIndexFactor(2030);
        const factor2040Inflation = getWageIndexFactor(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(factor2040Inflation).toBeGreaterThan(factor2030);
      });

      it('getBendPoints should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const bendPoints2030 = getBendPoints(2030);
        const bendPoints2040NoInflation = getBendPoints(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(bendPoints2040NoInflation.first).toBe(bendPoints2030.first);
        expect(bendPoints2040NoInflation.second).toBe(bendPoints2030.second);
      });

      it('getBendPoints should project when inflationAdjusted is true', () => {
        const bendPoints2030 = getBendPoints(2030);
        const bendPoints2040Inflation = getBendPoints(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(bendPoints2040Inflation.first).toBeGreaterThan(bendPoints2030.first);
        expect(bendPoints2040Inflation.second).toBeGreaterThan(bendPoints2030.second);
      });

      it('getWageBase should NOT project when inflationAdjusted is false', () => {
        // 2030 is the latest year in data
        const wageBase2030 = getWageBase(2030);
        const wageBase2040NoInflation = getWageBase(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(wageBase2040NoInflation).toBe(wageBase2030);
      });

      it('getWageBase should project when inflationAdjusted is true', () => {
        const wageBase2030 = getWageBase(2030);
        const wageBase2040Inflation = getWageBase(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(wageBase2040Inflation).toBeGreaterThan(wageBase2030);
      });

      it('getEarningsTestLimit should NOT project when inflationAdjusted is false', () => {
        const limits2030 = getEarningsTestLimit(2030);
        const limits2040NoInflation = getEarningsTestLimit(2040, 0.025, false);

        // When inflationAdjusted=false, should return same as latest known year
        expect(limits2040NoInflation.beforeFRA).toBe(limits2030.beforeFRA);
        expect(limits2040NoInflation.yearOfFRA).toBe(limits2030.yearOfFRA);
      });

      it('getEarningsTestLimit should project when inflationAdjusted is true', () => {
        const limits2030 = getEarningsTestLimit(2030);
        const limits2040Inflation = getEarningsTestLimit(2040, 0.025, true);

        // When inflationAdjusted=true, should be higher
        expect(limits2040Inflation.beforeFRA).toBeGreaterThan(limits2030.beforeFRA);
        expect(limits2040Inflation.yearOfFRA).toBeGreaterThan(limits2030.yearOfFRA);
      });
    });

    describe('Calculator functions with inflationAdjusted', () => {
      it('calculatePIA should use non-projected bend points when inflationAdjusted is false', () => {
        const aime = 5000;

        // Calculate PIA for far future with and without inflation adjustment
        const piaWithInflation = calculatePIA(aime, 2040, 0.025, true);
        const piaNoInflation = calculatePIA(aime, 2040, 0.025, false);

        // Without inflation, bend points are lower, so PIA should be different
        // (higher bend points = lower PIA for same AIME since less falls in 90% bracket)
        expect(piaNoInflation).not.toBe(piaWithInflation);
      });
    });
  });

  describe('getFRA', () => {
    it('should return 67 for birthYear >= 1960', () => {
      expect(getFRA(1960)).toBe(67);
      expect(getFRA(1965)).toBe(67);
      expect(getFRA(1980)).toBe(67);
    });

    it('should return 65 for birthYear < 1937', () => {
      expect(getFRA(1936)).toBe(65);
      expect(getFRA(1930)).toBe(65);
    });

    it('should return 66 for birthYear 1943-1954', () => {
      expect(getFRA(1943)).toBe(66);
      expect(getFRA(1950)).toBe(66);
      expect(getFRA(1954)).toBe(66);
    });

    it('should return fractional FRA for transitional years (1955-1959)', () => {
      // 1955: 66 years 2 months = 66.167
      expect(getFRA(1955)).toBeCloseTo(66.167, 2);
      // 1958: 66 years 8 months = 66.667
      expect(getFRA(1958)).toBeCloseTo(66.667, 2);
      // 1959: 66 years 10 months = 66.833
      expect(getFRA(1959)).toBeCloseTo(66.833, 2);
    });

    it('should return fractional FRA for early transitional years (1937-1942)', () => {
      // 1937: 65 years = 65
      expect(getFRA(1937)).toBe(65);
      // 1940: 65 years 6 months = 65.5
      expect(getFRA(1940)).toBe(65.5);
      // 1942: 65 years 10 months = 65.833
      expect(getFRA(1942)).toBeCloseTo(65.833, 2);
    });
  });

  describe('getClaimingAdjustment', () => {
    describe('FRA 67 cases (birth years 1960+)', () => {
      it('should return 0.70 for claiming at 62', () => {
        // 5 years early = 60 months early
        // First 36 months: 36 * 5/9 * 0.01 = 0.20 reduction
        // Additional 24 months: 24 * 5/12 * 0.01 = 0.10 reduction
        // Total: 1.0 - 0.30 = 0.70
        expect(getClaimingAdjustment(62, 67)).toBeCloseTo(0.70, 2);
      });

      it('should return 1.00 for claiming at FRA 67', () => {
        expect(getClaimingAdjustment(67, 67)).toBe(1.00);
      });

      it('should return 1.24 for claiming at 70', () => {
        // 3 years late = 36 months late
        // Increase: 36 * 2/3 * 0.01 = 0.24
        // Result: 1.0 + 0.24 = 1.24
        expect(getClaimingAdjustment(70, 67)).toBeCloseTo(1.24, 2);
      });
    });

    describe('FRA 66 cases (birth years 1943-1954)', () => {
      it('should return 0.75 for claiming at 62', () => {
        // 4 years early = 48 months early
        // First 36 months: 36 * 5/9 * 0.01 = 0.20 reduction
        // Additional 12 months: 12 * 5/12 * 0.01 = 0.05 reduction
        // Total: 1.0 - 0.25 = 0.75
        expect(getClaimingAdjustment(62, 66)).toBeCloseTo(0.75, 2);
      });

      it('should return 1.00 for claiming at FRA 66', () => {
        expect(getClaimingAdjustment(66, 66)).toBe(1.00);
      });

      it('should return 1.32 for claiming at 70', () => {
        // 4 years late = 48 months late
        // Increase: 48 * 2/3 * 0.01 = 0.32
        // Result: 1.0 + 0.32 = 1.32
        expect(getClaimingAdjustment(70, 66)).toBeCloseTo(1.32, 2);
      });
    });

    describe('FRA 65 cases (birth year < 1938)', () => {
      it('should return 0.80 for claiming at 62', () => {
        // 3 years early = 36 months early (all within first 36)
        // Reduction: 36 * 5/9 * 0.01 = 0.20
        // Result: 1.0 - 0.20 = 0.80
        expect(getClaimingAdjustment(62, 65)).toBeCloseTo(0.80, 2);
      });

      it('should return 1.00 for claiming at FRA 65', () => {
        expect(getClaimingAdjustment(65, 65)).toBe(1.00);
      });

      it('should return 1.40 for claiming at 70', () => {
        // 5 years late = 60 months late
        // Increase: 60 * 2/3 * 0.01 = 0.40
        // Result: 1.0 + 0.40 = 1.40
        expect(getClaimingAdjustment(70, 65)).toBeCloseTo(1.40, 2);
      });
    });

    describe('edge cases', () => {
      it('should use age 62 value for claimingAge < 62', () => {
        // For FRA 67, age 62 = 0.70
        expect(getClaimingAdjustment(61, 67)).toBeCloseTo(0.70, 2);
        expect(getClaimingAdjustment(55, 67)).toBeCloseTo(0.70, 2);

        // For FRA 66, age 62 = 0.75
        expect(getClaimingAdjustment(61, 66)).toBeCloseTo(0.75, 2);
      });

      it('should use age 70 value for claimingAge > 70', () => {
        // For FRA 67, age 70 = 1.24
        expect(getClaimingAdjustment(71, 67)).toBeCloseTo(1.24, 2);
        expect(getClaimingAdjustment(80, 67)).toBeCloseTo(1.24, 2);

        // For FRA 66, age 70 = 1.32
        expect(getClaimingAdjustment(75, 66)).toBeCloseTo(1.32, 2);
      });

      it('should interpolate correctly for fractional ages', () => {
        // 64.5 with FRA 67: 2.5 years early = 30 months
        // Reduction: 30 * 5/9 * 0.01 = 0.1667
        // Result: 1.0 - 0.1667 = 0.833
        expect(getClaimingAdjustment(64.5, 67)).toBeCloseTo(0.833, 2);

        // 68.5 with FRA 67: 1.5 years late = 18 months
        // Increase: 18 * 2/3 * 0.01 = 0.12
        // Result: 1.0 + 0.12 = 1.12
        expect(getClaimingAdjustment(68.5, 67)).toBeCloseTo(1.12, 2);
      });
    });

    describe('intermediate ages (FRA 67)', () => {
      it('should return ~0.867 for claiming at 65', () => {
        // 2 years early = 24 months early (all within first 36)
        // Reduction: 24 * 5/9 * 0.01 = 0.1333
        // Result: 1.0 - 0.1333 = 0.867
        expect(getClaimingAdjustment(65, 67)).toBeCloseTo(0.867, 2);
      });

      it('should return ~1.08 for claiming at 68', () => {
        // 1 year late = 12 months late
        // Increase: 12 * 2/3 * 0.01 = 0.08
        // Result: 1.0 + 0.08 = 1.08
        expect(getClaimingAdjustment(68, 67)).toBeCloseTo(1.08, 2);
      });
    });
  });

  describe('lookupYearlyData', () => {
    // Test data: simple numeric values by year
    const testData: Record<number, number> = {
      2020: 100,
      2022: 110,
      2024: 120,
    };
    const projectFuture = (base: number, multiplier: number) => Math.round(base * multiplier);

    it('should return exact value when year exists in data', () => {
      const result = lookupYearlyData(testData, 2022, projectFuture, 0.05, true);
      expect(result).toBe(110);
    });

    it('should project forward when year > latest and inflationAdjusted=true', () => {
      // 2026 is 2 years after 2024 (latest)
      // Growth: 120 * (1.05)^2 = 132.3 → rounds to 132
      const result = lookupYearlyData(testData, 2026, projectFuture, 0.05, true);
      expect(result).toBe(132);
    });

    it('should return latest value when year > latest and inflationAdjusted=false', () => {
      // Should return 2024's value (120) without projection
      const result = lookupYearlyData(testData, 2026, projectFuture, 0.05, false);
      expect(result).toBe(120);
    });

    it('should return earliest value when year < earliest', () => {
      // 2019 is before 2020 (earliest)
      const result = lookupYearlyData(testData, 2019, projectFuture, 0.05, true);
      expect(result).toBe(100); // 2020's value
    });

    it('should return earliest value for gaps in data (year between entries but not found)', () => {
      // 2021 doesn't exist, 2020 is earliest
      const result = lookupYearlyData(testData, 2021, projectFuture, 0.05, true);
      expect(result).toBe(100); // Falls through to earliestYear
    });

    it('should project correctly with different growth rates', () => {
      // 10% growth rate, 2 years forward
      // 120 * (1.10)^2 = 145.2 → rounds to 145
      const result = lookupYearlyData(testData, 2026, projectFuture, 0.10, true);
      expect(result).toBe(145);
    });

    it('should handle single-entry data', () => {
      const singleData = { 2024: 100 };

      // Exact match
      expect(lookupYearlyData(singleData, 2024, projectFuture, 0.05, true)).toBe(100);

      // Before
      expect(lookupYearlyData(singleData, 2020, projectFuture, 0.05, true)).toBe(100);

      // After with projection
      const result = lookupYearlyData(singleData, 2025, projectFuture, 0.05, true);
      expect(result).toBe(105); // 100 * 1.05
    });
  });

  describe('validateEarningsRecord', () => {
    describe('Valid earnings', () => {
      it('should return true for earnings at zero', () => {
        const record: EarningsRecord = { year: 2024, amount: 0 };
        expect(validateEarningsRecord(record)).toBe(true);
      });

      it('should return true for earnings below wage base', () => {
        // 2024 wage base is ~$168,600
        const record: EarningsRecord = { year: 2024, amount: 100000 };
        expect(validateEarningsRecord(record)).toBe(true);
      });

      it('should return true for earnings at wage base', () => {
        // Get exact wage base for 2024
        const wageBase = getWageBase(2024, 0.025, true);
        const record: EarningsRecord = { year: 2024, amount: wageBase };
        expect(validateEarningsRecord(record)).toBe(true);
      });

      it('should return true for typical earnings amount', () => {
        const record: EarningsRecord = { year: 2024, amount: 50000 };
        expect(validateEarningsRecord(record)).toBe(true);
      });
    });

    describe('Invalid earnings', () => {
      it('should return false for negative earnings', () => {
        const record: EarningsRecord = { year: 2024, amount: -1000 };
        expect(validateEarningsRecord(record)).toBe(false);
      });

      it('should return false for earnings above wage base', () => {
        // Wage base for 2024 is ~$168,600
        const record: EarningsRecord = { year: 2024, amount: 200000 };
        expect(validateEarningsRecord(record)).toBe(false);
      });

      it('should return false for extremely high earnings', () => {
        const record: EarningsRecord = { year: 2024, amount: 1000000 };
        expect(validateEarningsRecord(record)).toBe(false);
      });
    });

    describe('Wage base checks across years', () => {
      it('should validate against correct wage base for historical year', () => {
        // 2020 wage base was $137,700
        const validRecord: EarningsRecord = { year: 2020, amount: 130000 };
        const invalidRecord: EarningsRecord = { year: 2020, amount: 150000 };

        expect(validateEarningsRecord(validRecord)).toBe(true);
        expect(validateEarningsRecord(invalidRecord)).toBe(false);
      });

      it('should validate against projected wage base for future year', () => {
        // Future year with inflationAdjusted=true should use projected wage base
        const record: EarningsRecord = { year: 2030, amount: 150000 };
        expect(validateEarningsRecord(record, true)).toBe(true);
      });

      it('should use latest known wage base when inflationAdjusted=false', () => {
        // With inflationAdjusted=false, uses latest known values
        const record: EarningsRecord = { year: 2030, amount: 168600 };
        expect(validateEarningsRecord(record, false)).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should return true for exactly zero amount', () => {
        const record: EarningsRecord = { year: 2024, amount: 0 };
        expect(validateEarningsRecord(record, true)).toBe(true);
        expect(validateEarningsRecord(record, false)).toBe(true);
      });

      it('should return true for $1 earnings', () => {
        const record: EarningsRecord = { year: 2024, amount: 1 };
        expect(validateEarningsRecord(record)).toBe(true);
      });

      it('should return false for $1 over wage base', () => {
        const wageBase = getWageBase(2024, 0.025, true);
        const record: EarningsRecord = { year: 2024, amount: wageBase + 1 };
        expect(validateEarningsRecord(record)).toBe(false);
      });

      it('should handle old historical years', () => {
        // Very old year with low wage base
        const record: EarningsRecord = { year: 1980, amount: 20000 };
        expect(validateEarningsRecord(record)).toBe(true);
      });
    });

    describe('inflationAdjusted parameter', () => {
      it('should default to true for inflationAdjusted', () => {
        // With default (inflationAdjusted=true), future years use projected wage base
        const record: EarningsRecord = { year: 2030, amount: 200000 };
        const resultDefault = validateEarningsRecord(record);
        const resultExplicit = validateEarningsRecord(record, true);
        expect(resultDefault).toBe(resultExplicit);
      });

      it('should use different wage bases based on inflationAdjusted', () => {
        // For a future year, the wage base differs based on inflation adjustment
        const wageBaseWithInflation = getWageBase(2040, 0.025, true);
        const wageBaseNoInflation = getWageBase(2040, 0.025, false);

        // With inflation projection, wage base should be higher
        expect(wageBaseWithInflation).toBeGreaterThan(wageBaseNoInflation);

        // Amount valid with inflation but invalid without
        const testAmount = wageBaseNoInflation + 1000;
        const recordFuture: EarningsRecord = { year: 2040, amount: testAmount };

        expect(validateEarningsRecord(recordFuture, true)).toBe(true);
        expect(validateEarningsRecord(recordFuture, false)).toBe(false);
      });
    });
  });
});
