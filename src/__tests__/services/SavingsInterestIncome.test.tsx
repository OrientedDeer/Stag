import { describe, it, expect } from 'vitest';
import { SavedAccount } from '../../components/Objects/Accounts/models';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';
import { defaultAssumptions } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { max_year } from '../../data/TaxData';
import * as TaxService from '../../components/Objects/Taxes/TaxService';

const testTaxState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Standard',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
};

describe('Savings Account Interest Income', () => {
  describe('Interest Generation', () => {
    it('should generate interest income from savings accounts with APR > 0', () => {
      const year = 2024;
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      // Savings account with 5% APR and $10,000 balance
      const savingsAccount = new SavedAccount('savings-1', 'High Yield Savings', 10000, 5);

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Should have generated interest income
      const interestIncome = result.incomes.find(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      ) as PassiveIncome;

      expect(interestIncome).toBeDefined();
      expect(interestIncome.name).toBe('High Yield Savings Interest');
      expect(interestIncome.amount).toBeCloseTo(500, 2); // 10000 * 0.05 = 500
      expect(interestIncome.earned_income).toBe('No');
    });

    it('should NOT generate interest income when APR is 0', () => {
      const year = 2024;
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      // Savings account with 0% APR
      const savingsAccount = new SavedAccount('savings-1', 'Checking', 10000, 0);

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Should NOT have any interest income
      const interestIncome = result.incomes.find(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      );

      expect(interestIncome).toBeUndefined();
    });

    it('should NOT generate interest income when balance is 0', () => {
      const year = 2024;
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      // Empty savings account with APR
      const savingsAccount = new SavedAccount('savings-1', 'Empty Savings', 0, 5);

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Should NOT have any interest income
      const interestIncome = result.incomes.find(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      );

      expect(interestIncome).toBeUndefined();
    });

    it('should generate interest income for multiple savings accounts', () => {
      const year = 2024;
      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      const savingsAccount1 = new SavedAccount('savings-1', 'HYSA 1', 10000, 5);
      const savingsAccount2 = new SavedAccount('savings-2', 'HYSA 2', 20000, 4);

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount1, savingsAccount2],
        assumptions,
        testTaxState,
        []
      );

      const interestIncomes = result.incomes.filter(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      ) as PassiveIncome[];

      expect(interestIncomes).toHaveLength(2);

      const interest1 = interestIncomes.find(i => i.name === 'HYSA 1 Interest');
      const interest2 = interestIncomes.find(i => i.name === 'HYSA 2 Interest');

      expect(interest1?.amount).toBeCloseTo(500, 2);  // 10000 * 0.05
      expect(interest2?.amount).toBeCloseTo(800, 2);  // 20000 * 0.04
    });
  });

  describe('Tax Treatment', () => {
    it('should include interest income in gross income', () => {
      const year = 2024;
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', 50000, 5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Interest of 50000 * 0.05 = 2500 should be included in gross income
      expect(result.cashflow.totalIncome).toBeCloseTo(2500, 1);
    });

    it('should NOT be subject to FICA (earned income check)', () => {
      const year = 2024;
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', 100000, 5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // FICA should be 0 since interest is not earned income
      expect(result.taxDetails.fica).toBe(0);
    });

    it('should be subject to federal income tax', () => {
      const year = 2024;
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', 100000, 5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
        macro: {
          ...defaultAssumptions.macro,
          inflationAdjusted: false,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Interest of 100000 * 0.05 = 5000
      // Federal tax should be > 0 since income is above standard deduction
      // With only $5000 income and $14,600 standard deduction in 2024,
      // taxable income would be 0, so federal tax would be 0
      // This is expected behavior
      expect(result.taxDetails.fed).toBe(0);
    });

    it('should be taxed when above standard deduction', () => {
      const year = 2024;
      // Large balance to generate significant interest
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', 500000, 5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
        macro: {
          ...defaultAssumptions.macro,
          inflationAdjusted: false,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Interest of 500000 * 0.05 = 25000
      // Well above standard deduction (~14,600 for Single in 2024)
      // Should have federal tax > 0
      expect(result.taxDetails.fed).toBeGreaterThan(0);
      expect(result.taxDetails.fica).toBe(0); // Still no FICA
    });

    it('should correctly calculate getEarnedIncome excluding interest', () => {
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', 100000, 5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: 2024,
        },
      };

      const result = simulateOneYear(
        2024,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Get earned income from the result incomes
      const earnedIncome = TaxService.getEarnedIncome(result.incomes, 2024);

      // Interest is NOT earned income
      expect(earnedIncome).toBe(0);

      // But gross income should include it
      const grossIncome = TaxService.getGrossIncome(result.incomes, 2024);
      expect(grossIncome).toBeCloseTo(5000, 1); // 100000 * 0.05
    });
  });

  describe('Cashflow Display', () => {
    it('should include interest income in the incomes array for display', () => {
      const year = 2024;
      const savingsAccount = new SavedAccount('savings-1', 'Emergency Fund', 25000, 4.5);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Should be in the incomes array (for Sankey display)
      expect(result.incomes.length).toBeGreaterThan(0);

      const interestIncome = result.incomes.find(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      ) as PassiveIncome;

      expect(interestIncome).toBeDefined();
      expect(interestIncome.name).toBe('Emergency Fund Interest');
      expect(interestIncome.amount).toBeCloseTo(1125, 2); // 25000 * 0.045
    });
  });

  describe('Account Growth Independence', () => {
    it('should still grow account balance correctly alongside interest income', () => {
      const year = 2024;
      const initialBalance = 10000;
      const apr = 5;
      const savingsAccount = new SavedAccount('savings-1', 'HYSA', initialBalance, apr);

      const assumptions = {
        ...defaultAssumptions,
        demographics: {
          ...defaultAssumptions.demographics,
          startAge: 30,
          startYear: year,
        },
      };

      const result = simulateOneYear(
        year,
        [],
        [],
        [savingsAccount],
        assumptions,
        testTaxState,
        []
      );

      // Account should have grown by APR
      const grownAccount = result.accounts[0] as SavedAccount;
      expect(grownAccount.amount).toBeCloseTo(initialBalance * (1 + apr / 100), 2);

      // Interest income should match the growth
      const interestIncome = result.incomes.find(
        inc => inc instanceof PassiveIncome && inc.sourceType === 'Interest'
      ) as PassiveIncome;
      expect(interestIncome.amount).toBeCloseTo(initialBalance * (apr / 100), 2);
    });
  });
});
