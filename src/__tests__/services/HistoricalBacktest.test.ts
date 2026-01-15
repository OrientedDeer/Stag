import { describe, it, expect } from 'vitest';
import {
  runSingleBacktest,
  runHistoricalBacktest,
  getBacktestDataRange,
  BacktestConfig,
} from '../../services/HistoricalBacktest';

describe('HistoricalBacktest', () => {
  describe('getBacktestDataRange', () => {
    it('should return valid data range', () => {
      const range = getBacktestDataRange();
      expect(range.firstYear).toBe(1928);
      expect(range.lastYear).toBe(2024);
      expect(range.yearsAvailable).toBeGreaterThan(90);
    });
  });

  describe('runSingleBacktest', () => {
    const baseConfig: BacktestConfig = {
      retirementYears: 30,
      startingBalance: 1000000,
      annualWithdrawal: 40000,
      stockAllocation: 0.6, // 60% stocks, 40% bonds
      inflationAdjustedWithdrawals: true,
    };

    it('should return null for invalid start year', () => {
      const result = runSingleBacktest(1900, baseConfig);
      expect(result).toBeNull();
    });

    it('should return null for start year without enough data', () => {
      // 2020 + 30 years = 2050, but data only goes to 2024
      const result = runSingleBacktest(2020, baseConfig);
      expect(result).toBeNull();
    });

    it('should run successfully for valid start year', () => {
      const result = runSingleBacktest(1950, baseConfig);
      expect(result).not.toBeNull();
      expect(result!.startYear).toBe(1950);
      expect(result!.yearlySnapshots.length).toBe(30);
    });

    it('should track lowest balance correctly', () => {
      const result = runSingleBacktest(1950, baseConfig);
      expect(result).not.toBeNull();
      expect(result!.lowestBalance).toBeLessThanOrEqual(result!.finalBalance);
      expect(result!.lowestYear).toBeGreaterThanOrEqual(1950);
      expect(result!.lowestYear).toBeLessThanOrEqual(1979);
    });

    it('should handle high withdrawal rates leading to depletion', () => {
      const highWithdrawalConfig: BacktestConfig = {
        ...baseConfig,
        annualWithdrawal: 200000, // 20% withdrawal rate
      };
      // 1966 was a bad year to retire
      const result = runSingleBacktest(1966, highWithdrawalConfig);
      expect(result).not.toBeNull();
      expect(result!.succeeded).toBe(false);
      expect(result!.yearOfDepletion).not.toBeNull();
    });

    it('should succeed with conservative withdrawal rate', () => {
      const conservativeConfig: BacktestConfig = {
        ...baseConfig,
        annualWithdrawal: 30000, // 3% withdrawal rate
      };
      const result = runSingleBacktest(1950, conservativeConfig);
      expect(result).not.toBeNull();
      expect(result!.succeeded).toBe(true);
      expect(result!.yearOfDepletion).toBeNull();
    });
  });

  describe('runHistoricalBacktest', () => {
    it('should run backtest across all valid years', () => {
      const config: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 40000,
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const summary = runHistoricalBacktest(config);

      expect(summary.results.length).toBeGreaterThan(0);
      expect(summary.totalPeriods).toBe(summary.results.length);
      expect(summary.successCount).toBeLessThanOrEqual(summary.totalPeriods);
      expect(summary.successRate).toBeGreaterThanOrEqual(0);
      expect(summary.successRate).toBeLessThanOrEqual(100);
    });

    it('should calculate correct success rate', () => {
      const config: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 40000,
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const summary = runHistoricalBacktest(config);
      const calculatedRate = (summary.successCount / summary.totalPeriods) * 100;

      expect(Math.abs(summary.successRate - calculatedRate)).toBeLessThan(1);
    });

    it('should identify best and worst cases', () => {
      const config: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 40000,
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const summary = runHistoricalBacktest(config);

      expect(summary.bestCase).toBeDefined();
      expect(summary.worstCase).toBeDefined();
      expect(summary.bestCase.finalBalance).toBeGreaterThanOrEqual(summary.worstCase.finalBalance);
    });

    it('should find notable periods', () => {
      const config: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 40000,
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const summary = runHistoricalBacktest(config);

      expect(summary.notablePeriods.length).toBeGreaterThan(0);
      summary.notablePeriods.forEach(notable => {
        expect(notable.result).toBeDefined();
        expect(notable.description).toBeDefined();
        expect(notable.description.length).toBeGreaterThan(0);
      });
    });

    it('should verify 1966 is a challenging start year', () => {
      const config: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 50000, // 5% withdrawal rate
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const summary = runHistoricalBacktest(config);
      const period1966 = summary.results.find(r => r.startYear === 1966);

      expect(period1966).toBeDefined();
      // 1966 is known as one of the worst start years due to stagflation
      // With 5% withdrawal, it should fail or have low final balance
      if (period1966!.succeeded) {
        expect(period1966!.finalBalance).toBeLessThan(summary.bestCase.finalBalance * 0.5);
      }
    });
  });

  describe('stock allocation impact', () => {
    it('should show different outcomes for different allocations', () => {
      const baseConfig: BacktestConfig = {
        retirementYears: 30,
        startingBalance: 1000000,
        annualWithdrawal: 40000,
        stockAllocation: 0.6,
        inflationAdjustedWithdrawals: true,
      };

      const allStocks = runHistoricalBacktest({ ...baseConfig, stockAllocation: 1.0 });
      const balanced = runHistoricalBacktest({ ...baseConfig, stockAllocation: 0.6 });
      const allBonds = runHistoricalBacktest({ ...baseConfig, stockAllocation: 0.0 });

      // All three should produce valid results
      expect(allStocks.results.length).toBeGreaterThan(0);
      expect(balanced.results.length).toBeGreaterThan(0);
      expect(allBonds.results.length).toBeGreaterThan(0);

      // Volatility should differ (all stocks has higher best case typically)
      // This isn't guaranteed for all periods but should hold generally
      expect(allStocks.bestCase.finalBalance).not.toBe(allBonds.bestCase.finalBalance);
    });
  });
});
